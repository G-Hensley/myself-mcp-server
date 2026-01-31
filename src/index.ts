import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type {
  SkillsData,
  SkillResult,
  ExperienceData,
  ProjectsData,
  ProjectResult,
  GoalsData,
  GoalResult,
  ContactData,
  AboutMeData,
  ProfileResult,
  ResumeManifest,
  JobOpportunitiesData,
  BusinessStrategy,
  PersonasData,
  MarketingData,
  LearningRoadmapData,
  CompletedLearningData,
  IdeasData,
  Idea,
} from "./types.js";

// Get the repo root from cwd (set via Claude Desktop config)
const REPO_ROOT = process.cwd();

// Helper to read JSON files from the repo
async function readJsonFile<T>(relativePath: string): Promise<T> {
  const fullPath = path.join(REPO_ROOT, relativePath);
  const content = await fs.readFile(fullPath, "utf-8");
  return JSON.parse(content) as T;
}

// Helper to read markdown files
async function readMarkdownFile(relativePath: string): Promise<string> {
  const fullPath = path.join(REPO_ROOT, relativePath);
  return await fs.readFile(fullPath, "utf-8");
}

// Helper to write JSON files to the repo
async function writeJsonFile(relativePath: string, data: unknown): Promise<void> {
  const fullPath = path.join(REPO_ROOT, relativePath);
  const content = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(fullPath, content, "utf-8");
}

// Helper to write any file to the repo (creates directories if needed)
async function writeFile(relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(REPO_ROOT, relativePath);
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

// Helper to list directory contents
async function listDirectory(relativePath: string): Promise<Array<{ name: string; type: "file" | "dir"; path: string }>> {
  const fullPath = path.join(REPO_ROOT, relativePath);
  try {
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
      path: path.join(relativePath, entry.name),
    }));
  } catch {
    return []; // Directory doesn't exist
  }
}

// Helper to check if file exists
async function fileExists(relativePath: string): Promise<boolean> {
  const fullPath = path.join(REPO_ROOT, relativePath);
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

// Common output schema for all tools (MCP text content format)
const textContentOutputSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    })
  ),
});

// Create the MCP server
const server = new McpServer({
  name: "myself-knowledge-base",
  version: "1.0.0",
  description: "Knowledge base about myself including skills, experience, projects, goals, profile information, business info, resumes, job opportunities, automations, and more.",
});

// Tool: Get Skills
server.registerTool(
  "get_skills",
  {
    title: "Get Skills",
    description: "Get all skills with proficiency levels, optionally filtered by category or level",
    inputSchema: {
      category: z.string().optional().describe("Filter by category (e.g., 'programming_languages', 'frameworks_and_libraries', 'databases')"),
      min_level: z.enum(["none", "novice", "apprentice", "adept", "expert", "master"]).optional().describe("Minimum proficiency level"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ category, min_level }) => {
    const skills = await readJsonFile<Record<string, unknown>>("profile/skills.json");

    // Level order for comparison
    const levelOrder = ["none", "novice", "apprentice", "adept", "expert", "master"];
    const minLevelIndex = min_level ? levelOrder.indexOf(min_level) : 0;

    const result: Array<{ category: string; name: string; level: string }> = [];

    // Iterate over all categories (skip skill_levels which is metadata)
    for (const [cat, skillsInCategory] of Object.entries(skills)) {
      if (cat === "skill_levels") continue;
      if (category && cat.toLowerCase() !== category.toLowerCase()) continue;
      if (typeof skillsInCategory !== "object" || skillsInCategory === null) continue;

      for (const [skillName, level] of Object.entries(skillsInCategory as Record<string, string>)) {
        const skillLevelIndex = levelOrder.indexOf(level);
        if (skillLevelIndex >= minLevelIndex) {
          result.push({
            category: cat,
            name: skillName,
            level: level,
          });
        }
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool: Get Experience
server.registerTool(
  "get_experience",
  {
    title: "Get Experience",
    description: "Get work experience history with roles, responsibilities, and achievements",
    inputSchema: {
      current_only: z.boolean().optional().describe("Only return current positions"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ current_only }) => {
    const experience = await readJsonFile<Record<string, unknown>>("profile/experience.json");

    // Convert object format { "Company": {...} } to array format
    const positions = Object.entries(experience).map(([company, data]) => ({
      company,
      ...(data as Record<string, unknown>),
    }));

    let filtered = positions;
    if (current_only) {
      filtered = positions.filter(p => (p as { end_date?: string }).end_date === "Present");
    }

    return {
      content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
    };
  }
);

// Tool: Get Projects
server.registerTool(
  "get_projects",
  {
    title: "Get Projects",
    description: "Get projects (active, planned, or completed)",
    inputSchema: {
      status: z.enum(["active", "planned", "completed"]).optional().describe("Filter by project status"),
      tech: z.string().optional().describe("Filter by technology used"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ status, tech }) => {
    const files: Record<string, string> = {
      active: "projects/active.json",
      planned: "projects/planned.json",
      completed: "projects/completed.json",
    };

    let allProjects: Array<Record<string, unknown>> = [];

    const statusesToCheck = status ? [status] : ["active", "planned", "completed"];

    for (const s of statusesToCheck) {
      try {
        const data = await readJsonFile<Record<string, unknown>>(files[s]);
        // Convert object format { "ProjectName": {...} } to array format
        const projects = Object.entries(data).map(([name, projectData]) => ({
          id: name,
          ...(projectData as Record<string, unknown>),
          status: s,
        }));
        allProjects.push(...projects);
      } catch {
        // File may not exist
      }
    }

    if (tech) {
      const techLower = tech.toLowerCase();
      allProjects = allProjects.filter(p => {
        const technologies = p.technologies as string[] | undefined;
        return technologies?.some(t => t.toLowerCase().includes(techLower));
      });
    }

    return {
      content: [{ type: "text", text: JSON.stringify(allProjects, null, 2) }],
    };
  }
);

// Tool: Get Goals
server.registerTool(
  "get_goals",
  {
    title: "Get Goals",
    description: "Get current goals and their progress",
    inputSchema: {
      category: z.string().optional().describe("Filter by category (business, technical, community, content)"),
      status: z.enum(["in_progress", "not_started", "completed"]).optional().describe("Filter by goal status"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ category, status }) => {
    const goals = await readJsonFile<GoalsData>("profile/goals/2026-goals.json");

    const result: GoalResult[] = [];

    for (const [cat, data] of Object.entries(goals.categories)) {
      if (category && cat !== category) continue;

      for (const goal of data.goals) {
        if (status && goal.status !== status) continue;

        result.push({
          category: cat,
          categoryTitle: data.title,
          goal: goal.goal,
          status: goal.status,
          target_date: goal.target_date,
          metrics: goal.metrics,
        });
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool: Get Profile Summary
server.registerTool(
  "get_profile",
  {
    title: "Get Profile Summary",
    description: "Get a complete profile summary including contact info, about myself, summary, and key stats",
    outputSchema: textContentOutputSchema,
  },
  async () => {
    const contact = await readJsonFile<ContactData>("profile/contact.json");
    const resume = await readMarkdownFile("profile/resume.md");
    const aboutMe = await readJsonFile<AboutMeData>("profile/about-me.json");

    // Extract summary from resume (between ## Summary and next ##)
    const summaryMatch = resume.match(/## Summary\n\n([\s\S]*?)(?=\n##|$)/);
    const summary = summaryMatch ? summaryMatch[1].trim() : "";

    const profile: ProfileResult = {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      location: contact.location,
      links: contact.links,
      summary,
      about_me: aboutMe,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
    };
  }
);

// Tool: Get Resume
server.registerTool(
  "get_resume",
  {
    title: "Get Resume",
    description: "Get the full resume in markdown format, or a specific generated resume variant",
    inputSchema: {
      variant: z.string().optional().describe("Resume variant (e.g., 'full-stack-react', 'frontend-react', 'nextjs-focused', 'general-swe'). Leave empty for base resume."),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ variant }) => {
    let resumePath = "profile/resume.md";

    if (variant) {
      try {
        const manifest = await readJsonFile<ResumeManifest>("profile/resumes/latest-manifest.json");
        const found = manifest.resumes.find(r => r.cluster === variant);
        if (found) {
          resumePath = `profile/resumes/${found.file}`;
        }
      } catch {
        // No manifest, fall back to base resume
      }
    }

    const resume = await readMarkdownFile(resumePath);

    return {
      content: [{ type: "text", text: resume }],
    };
  }
);

// Tool: Query Knowledge Base
server.registerTool(
  "query_knowledge_base",
  {
    title: "Query Knowledge Base",
    description: "Search and query the knowledge base with natural language. Returns relevant context for the query.",
    inputSchema: {
      query: z.string().describe("Natural language query about profile, projects, goals, or skills"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ query }) => {
    const queryLower = query.toLowerCase();
    const context: string[] = [];

    if (queryLower.includes("skill") || queryLower.includes("tech") || queryLower.includes("know") || queryLower.includes("can")) {
      const skills = await readJsonFile<SkillsData>("profile/skills.json");
      context.push(`## Skills\n${JSON.stringify(skills, null, 2)}`);
    }

    if (queryLower.includes("experience") || queryLower.includes("work") || queryLower.includes("job") || queryLower.includes("role")) {
      const experience = await readJsonFile<ExperienceData>("profile/experience.json");
      context.push(`## Experience\n${JSON.stringify(experience, null, 2)}`);
    }

    if (queryLower.includes("project") || queryLower.includes("build") || queryLower.includes("built") || queryLower.includes("portfolio")) {
      try {
        const active = await readJsonFile<ProjectsData>("projects/active.json");
        const completed = await readJsonFile<ProjectsData>("projects/completed.json");
        context.push(`## Active Projects\n${JSON.stringify(active, null, 2)}`);
        context.push(`## Completed Projects\n${JSON.stringify(completed, null, 2)}`);
      } catch {
        // Files may not exist
      }
    }

    if (queryLower.includes("goal") || queryLower.includes("plan") || queryLower.includes("objective") || queryLower.includes("target")) {
      try {
        const goals = await readJsonFile<GoalsData>("profile/goals/2026-goals.json");
        context.push(`## Goals\n${JSON.stringify(goals, null, 2)}`);
      } catch {
        // File may not exist
      }
    }

    if (queryLower.includes("contact") || queryLower.includes("email") || queryLower.includes("phone") || queryLower.includes("linkedin")) {
      const contact = await readJsonFile<ContactData>("profile/contact.json");
      context.push(`## Contact\n${JSON.stringify(contact, null, 2)}`);
    }

    if (queryLower.includes("education") || queryLower.includes("degree") || queryLower.includes("cert") || queryLower.includes("school")) {
      const education = await readJsonFile<unknown>("profile/education.json");
      context.push(`## Education\n${JSON.stringify(education, null, 2)}`);
    }

    if (context.length === 0) {
      const contact = await readJsonFile<ContactData>("profile/contact.json");
      const resume = await readMarkdownFile("profile/resume.md");
      context.push(`## Profile Overview\n${JSON.stringify(contact, null, 2)}`);
      context.push(`## Resume\n${resume}`);
    }

    return {
      content: [{ type: "text", text: context.join("\n\n---\n\n") }],
    };
  }
);

// Tool: Get Job Opportunities
server.registerTool(
  "get_job_opportunities",
  {
    title: "Get Job Opportunities",
    description: "Get recently discovered job opportunities from automated monitoring",
    inputSchema: {
      cluster: z.string().optional().describe("Filter by resume cluster (full-stack-react, frontend-react, nextjs-focused, general-swe)"),
      limit: z.number().optional().describe("Maximum number of jobs to return"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ cluster, limit }) => {
    try {
      const opportunities = await readJsonFile<Record<string, unknown>>("job-applications/opportunities/latest.json");

      // Use top_jobs array from the actual file structure
      let jobs = (opportunities.top_jobs as Array<Record<string, unknown>>) || [];

      if (cluster) {
        jobs = jobs.filter(j => j.cluster === cluster);
      }

      if (limit) {
        jobs = jobs.slice(0, limit);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }],
      };
    } catch {
      return {
        content: [{ type: "text", text: "No job opportunities file found." }],
      };
    }
  }
);

// Tool: Get Business Info
server.registerTool(
  "get_business_info",
  {
    title: "Get Business Info",
    description: "Get business information for Codaissance or TamperTantrum Labs including strategy, personas, and marketing",
    inputSchema: {
      business: z.enum(["codaissance", "tampertantrum-labs"]).describe("Which business to get info for"),
      include: z.array(z.enum(["strategy", "personas", "marketing"])).optional().describe("Which data to include (defaults to all)"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ business, include }) => {
    const includeAll = !include || include.length === 0;
    const result: Record<string, unknown> = { business };

    if (includeAll || include?.includes("strategy")) {
      try {
        const strategy = await readJsonFile<BusinessStrategy>(`business/${business}/strategy.json`);
        result.strategy = strategy;
      } catch {
        // File may not exist
      }
    }

    if (includeAll || include?.includes("personas")) {
      try {
        const personas = await readJsonFile<PersonasData>(`business/${business}/personas.json`);
        result.personas = personas;
      } catch {
        // File may not exist
      }
    }

    if (includeAll || include?.includes("marketing")) {
      try {
        const marketing = await readJsonFile<MarketingData>(`business/${business}/marketing.json`);
        result.marketing = marketing;
      } catch {
        // File may not exist
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool: Get Learning Roadmap
server.registerTool(
  "get_learning_roadmap",
  {
    title: "Get Learning Roadmap",
    description: "Get learning roadmap with current focus, queue, and completed learning",
    inputSchema: {
      section: z.enum(["current_focus", "queue", "backlog", "on_hold", "completed"]).optional().describe("Specific section to retrieve (defaults to all)"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ section }) => {
    const result: Record<string, unknown> = {};

    if (!section || section !== "completed") {
      try {
        const roadmap = await readJsonFile<LearningRoadmapData>("learning/roadmap.json");
        if (section) {
          result[section] = roadmap[section as keyof LearningRoadmapData];
        } else {
          result.roadmap = roadmap;
        }
      } catch {
        // File may not exist
      }
    }

    if (!section || section === "completed") {
      try {
        const completed = await readJsonFile<CompletedLearningData>("learning/completed.json");
        result.completed = completed.entries;
      } catch {
        // File may not exist
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool: Get Ideas
server.registerTool(
  "get_ideas",
  {
    title: "Get Ideas",
    description: "Get ideas from personal, Codaissance, or TamperTantrum Labs idea banks",
    inputSchema: {
      source: z.enum(["personal", "codaissance", "tampertantrum-labs", "all"]).optional().describe("Which idea source to retrieve (defaults to all)"),
      status: z.enum(["raw", "validating", "validated", "rejected", "moved_to_projects"]).optional().describe("Filter by idea status"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ source, status }) => {
    const sources: Record<string, string> = {
      personal: "ideas/personal/ideas.json",
      codaissance: "ideas/business/codaissance/ideas.json",
      "tampertantrum-labs": "ideas/business/tampertantrum-labs/ideas.json",
    };

    const sourcesToCheck = source && source !== "all" ? [source] : ["personal", "codaissance", "tampertantrum-labs"];
    const allIdeas: Array<{ source: string; ideas: Idea[] }> = [];

    for (const s of sourcesToCheck) {
      try {
        const data = await readJsonFile<IdeasData>(sources[s]);
        let ideas = data.ideas || [];

        if (status) {
          ideas = ideas.filter(i => i.status === status);
        }

        if (ideas.length > 0) {
          allIdeas.push({ source: s, ideas });
        }
      } catch {
        // File may not exist
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(allIdeas, null, 2) }],
    };
  }
);

// Tool: Get Education
server.registerTool(
  "get_education",
  {
    title: "Get Education",
    description: "Get education history including degrees, certifications, and self-taught learning",
    inputSchema: {
      include: z.array(z.enum(["degrees", "certifications", "self_taught"])).optional().describe("What to include (defaults to all)"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ include }) => {
    const education = await readJsonFile<Record<string, unknown>>("profile/education.json");
    const includeAll = !include || include.length === 0;

    const result: Record<string, unknown> = {};

    if (includeAll || include?.includes("degrees")) {
      // Extract degree entries (not certifications or certificates arrays)
      const degrees: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(education)) {
        if (key !== "certifications" && key !== "certificates" && typeof value === "object") {
          degrees[key] = value;
        }
      }
      result.degrees = degrees;
    }

    if (includeAll || include?.includes("certifications")) {
      result.certifications = education.certifications || [];
      result.certificates = education.certificates || [];
    }

    if (includeAll || include?.includes("self_taught")) {
      result.self_taught = education.self_taught_learning || null;
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool: Get Preferences
server.registerTool(
  "get_preferences",
  {
    title: "Get Preferences",
    description: "Get work preferences including learning style, work environment, schedule, coding style, and tools",
    inputSchema: {
      category: z.enum(["learning", "work_environment", "schedule", "coding_style", "tools"]).optional().describe("Specific preference category (defaults to all)"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ category }) => {
    const preferences = await readJsonFile<Record<string, unknown>>("profile/preferences.json");

    if (category) {
      return {
        content: [{ type: "text", text: JSON.stringify({ [category]: preferences[category] }, null, 2) }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(preferences, null, 2) }],
    };
  }
);

// Tool: Get LinkedIn Metrics
server.registerTool(
  "get_linkedin_metrics",
  {
    title: "Get LinkedIn Metrics",
    description: "Get LinkedIn metrics for personal account, Codaissance page, or TamperTantrum Labs page",
    inputSchema: {
      account: z.enum(["personal", "codaissance", "tampertantrum"]).optional().describe("Which account to get metrics for (defaults to all)"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ account }) => {
    const accounts: Record<string, string> = {
      personal: "linkedin/personal-metrics.json",
      codaissance: "linkedin/codaissance-metrics.json",
      tampertantrum: "linkedin/tampertantrum-metrics.json",
    };

    const accountsToCheck = account ? [account] : ["personal", "codaissance", "tampertantrum"];
    const result: Record<string, unknown> = {};

    for (const acc of accountsToCheck) {
      try {
        const metrics = await readJsonFile<Record<string, unknown>>(accounts[acc]);
        result[acc] = metrics;
      } catch {
        result[acc] = { error: "No metrics data available" };
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool: Get Assessments
server.registerTool(
  "get_assessments",
  {
    title: "Get Assessments",
    description: "Get self-assessments. Note: Returns list of available assessments or content of a specific one.",
    inputSchema: {
      date: z.string().optional().describe("Specific assessment date (YYYY-MM format, e.g., '2025-12'). Leave empty to get list of available assessments."),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ date }) => {
    if (date) {
      try {
        const assessment = await readMarkdownFile(`assessments/${date}-assessment.md`);
        return {
          content: [{ type: "text", text: assessment }],
        };
      } catch {
        return {
          content: [{ type: "text", text: `Assessment for ${date} not found.` }],
        };
      }
    }

    // For local server, we could list directory, but keeping consistent with http-server
    return {
      content: [{ type: "text", text: "To get a specific assessment, provide a date in YYYY-MM format (e.g., '2025-12'). Assessments are stored as {date}-assessment.md files." }],
    };
  }
);

// Tool: Get Business Roadmap
server.registerTool(
  "get_business_roadmap",
  {
    title: "Get Business Roadmap",
    description: "Get the product/consulting roadmap for Codaissance or TamperTantrum Labs",
    inputSchema: {
      business: z.enum(["codaissance", "tampertantrum-labs"]).describe("Which business roadmap to get"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ business }) => {
    try {
      const roadmap = await readMarkdownFile(`business/${business}/roadmap.md`);
      return {
        content: [{ type: "text", text: roadmap }],
      };
    } catch {
      return {
        content: [{ type: "text", text: `Roadmap for ${business} not found.` }],
      };
    }
  }
);

// Tool: Get Job Applications
server.registerTool(
  "get_job_applications",
  {
    title: "Get Job Applications",
    description: "Get job applications tracking data with status, companies, and outcomes",
    inputSchema: {
      status: z.enum(["applied", "screening", "interviewing", "offer", "rejected", "withdrawn", "ghosted"]).optional().describe("Filter by application status"),
      limit: z.number().optional().describe("Maximum number of applications to return"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ status, limit }) => {
    try {
      const data = await readJsonFile<{ applications: Array<Record<string, unknown>> }>("job-applications/applications.json");
      let applications = data.applications || [];

      // Filter out template entries (empty id or company)
      applications = applications.filter(app => app.id && app.company);

      if (status) {
        applications = applications.filter(app => app.status === status);
      }

      if (limit) {
        applications = applications.slice(0, limit);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(applications, null, 2) }],
      };
    } catch {
      return {
        content: [{ type: "text", text: "No job applications data found." }],
      };
    }
  }
);

// Tool: Get Interviews
server.registerTool(
  "get_interviews",
  {
    title: "Get Interviews",
    description: "Get interview tracking data including prep notes, questions asked, and outcomes",
    inputSchema: {
      company: z.string().optional().describe("Filter by company name"),
      outcome: z.enum(["passed", "rejected", "pending", "unknown"]).optional().describe("Filter by interview outcome"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ company, outcome }) => {
    try {
      const data = await readJsonFile<{ interviews: Array<Record<string, unknown>> }>("job-applications/interviews.json");
      let interviews = data.interviews || [];

      // Filter out template entries (empty id or company)
      interviews = interviews.filter(int => int.id && int.company);

      if (company) {
        const companyLower = company.toLowerCase();
        interviews = interviews.filter(int =>
          (int.company as string)?.toLowerCase().includes(companyLower)
        );
      }

      if (outcome) {
        interviews = interviews.filter(int => int.outcome === outcome);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(interviews, null, 2) }],
      };
    } catch {
      return {
        content: [{ type: "text", text: "No interview data found." }],
      };
    }
  }
);

// Tool: Get Career Roadmap
server.registerTool(
  "get_career_roadmap",
  {
    title: "Get Career Roadmap",
    description: "Get career roadmap with milestones, parallel tracks, success metrics, and risk mitigation",
    inputSchema: {
      section: z.enum(["milestones", "parallel_tracks", "success_metrics", "risk_mitigation", "all"]).optional().describe("Specific section to retrieve (defaults to all)"),
      milestone_status: z.enum(["in_progress", "not_started", "completed"]).optional().describe("Filter milestones by status"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ section, milestone_status }) => {
    try {
      const roadmap = await readJsonFile<Record<string, unknown>>("career/roadmap.json");
      const careerRoadmap = roadmap.career_roadmap as Record<string, unknown>;

      if (!section || section === "all") {
        if (milestone_status) {
          const milestones = (careerRoadmap.milestones as Array<Record<string, unknown>>) || [];
          const filtered = milestones.filter(m => m.status === milestone_status);
          return {
            content: [{ type: "text", text: JSON.stringify({ ...careerRoadmap, milestones: filtered }, null, 2) }],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(careerRoadmap, null, 2) }],
        };
      }

      const sectionData = careerRoadmap[section];
      if (section === "milestones" && milestone_status) {
        const milestones = (sectionData as Array<Record<string, unknown>>) || [];
        const filtered = milestones.filter(m => m.status === milestone_status);
        return {
          content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(sectionData, null, 2) }],
      };
    } catch {
      return {
        content: [{ type: "text", text: "Career roadmap not found." }],
      };
    }
  }
);

// Tool: Get Chief Aim
server.registerTool(
  "get_chief_aim",
  {
    title: "Get Chief Aim",
    description: "Get Napoleon Hill success principles framework including definite purpose, mastermind alliance, and career vision",
    inputSchema: {
      principle: z.string().optional().describe("Specific principle to retrieve (e.g., 'definiteness_of_purpose', 'master_mind_alliance', 'self_discipline'). Leave empty for all."),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ principle }) => {
    try {
      const chiefAim = await readJsonFile<Record<string, unknown>>("career/chief-aim.json");
      const principles = chiefAim.napoleon_hill_principles as Record<string, unknown>;

      if (principle) {
        const data = principles[principle];
        if (data) {
          return {
            content: [{ type: "text", text: JSON.stringify({ [principle]: data }, null, 2) }],
          };
        }
        // Also check career_vision_questions
        if (principle === "career_vision_questions" && chiefAim.career_vision_questions) {
          return {
            content: [{ type: "text", text: JSON.stringify({ career_vision_questions: chiefAim.career_vision_questions }, null, 2) }],
          };
        }
        return {
          content: [{ type: "text", text: `Principle '${principle}' not found. Available: ${Object.keys(principles).join(", ")}, career_vision_questions` }],
        };
      }

      // Return summary instead of full document (29KB is too large for output)
      const summary = {
        available_principles: Object.keys(principles),
        career_vision_questions: chiefAim.career_vision_questions,
        definite_chief_aim: (principles.definiteness_of_purpose as Record<string, unknown>)?.my_definite_chief_aim,
        usage: "Call with principle parameter to get details (e.g., principle: 'definiteness_of_purpose')",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    } catch {
      return {
        content: [{ type: "text", text: "Chief aim document not found." }],
      };
    }
  }
);

// Tool: Get Financials
server.registerTool(
  "get_financials",
  {
    title: "Get Financials",
    description: "Get financial data for Codaissance or TamperTantrum Labs including revenue, expenses, and milestones",
    inputSchema: {
      business: z.enum(["codaissance", "tampertantrum-labs"]).describe("Which business financials to get"),
      section: z.enum(["revenue", "expenses", "metrics", "milestones", "all"]).optional().describe("Specific section (defaults to all)"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ business, section }) => {
    try {
      const financials = await readJsonFile<Record<string, unknown>>(`business/${business}/financials.json`);

      if (!section || section === "all") {
        return {
          content: [{ type: "text", text: JSON.stringify({ business, ...financials }, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ business, [section]: financials[section] }, null, 2) }],
      };
    } catch {
      return {
        content: [{ type: "text", text: `Financials for ${business} not found.` }],
      };
    }
  }
);

// Tool: Get LinkedIn Profile
server.registerTool(
  "get_linkedin_profile",
  {
    title: "Get LinkedIn Profile",
    description: "Get LinkedIn profile data (not metrics) including headlines, bios, and follower counts",
    inputSchema: {
      account: z.enum(["personal", "codaissance", "tampertantrum_labs", "all"]).optional().describe("Which account profile to get (defaults to all)"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ account }) => {
    try {
      const profile = await readJsonFile<Record<string, unknown>>("linkedin/profile.json");

      if (account && account !== "all") {
        return {
          content: [{ type: "text", text: JSON.stringify({ [account]: profile[account] }, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
      };
    } catch {
      return {
        content: [{ type: "text", text: "LinkedIn profile data not found." }],
      };
    }
  }
);

// Tool: Get Content Ideas
server.registerTool(
  "get_content_ideas",
  {
    title: "Get Content Ideas",
    description: "Get LinkedIn content strategy including pillars, calendar, post structure, and content bank",
    inputSchema: {
      account: z.enum(["personal", "codaissance", "tampertantrum"]).optional().describe("Filter content ideas by account"),
      section: z.enum(["pillars", "calendar", "post_structure", "content_bank", "all"]).optional().describe("Specific section (defaults to all)"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ account, section }) => {
    try {
      const contentIdeas = await readJsonFile<Record<string, unknown>>("linkedin/content-ideas.json");

      const result: Record<string, unknown> = {};

      if (!section || section === "all") {
        if (account) {
          // Return account-specific data
          const accounts = contentIdeas.accounts as Record<string, unknown>;
          result.account_info = accounts[account];

          const contentBank = contentIdeas.content_bank as Record<string, unknown>;
          result.content_bank = contentBank[account];

          result.post_structure = contentIdeas.post_structure;
          result.calendar = contentIdeas.calendar;
        } else {
          return {
            content: [{ type: "text", text: JSON.stringify(contentIdeas, null, 2) }],
          };
        }
      } else {
        if (section === "pillars" && account) {
          const accounts = contentIdeas.accounts as Record<string, Record<string, unknown>>;
          result.pillars = accounts[account]?.pillars;
        } else if (section === "content_bank" && account) {
          const contentBank = contentIdeas.content_bank as Record<string, unknown>;
          result.content_bank = contentBank[account];
        } else {
          result[section] = contentIdeas[section];
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch {
      return {
        content: [{ type: "text", text: "Content ideas data not found." }],
      };
    }
  }
);

// ============================================================
// UPDATE TOOLS - Write operations for the knowledge base
// ============================================================

// Tool: Update Skill
server.registerTool(
  "update_skill",
  {
    title: "Update Skill",
    description: "Update a skill's proficiency level",
    inputSchema: {
      category: z.string().describe("Skill category (e.g., 'programming_languages', 'frameworks_and_libraries')"),
      skill_name: z.string().describe("Name of the skill to update"),
      new_level: z.enum(["none", "novice", "apprentice", "adept", "expert", "master"]).describe("New proficiency level"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ category, skill_name, new_level }) => {
    try {
      const skills = await readJsonFile<Record<string, Record<string, string>>>("profile/skills.json");

      if (!skills[category]) {
        return {
          content: [{ type: "text", text: `Category '${category}' not found. Available: ${Object.keys(skills).filter(k => k !== "skill_levels").join(", ")}` }],
        };
      }

      const oldLevel = skills[category][skill_name];
      skills[category][skill_name] = new_level;

      await writeJsonFile("profile/skills.json", skills);

      return {
        content: [{ type: "text", text: `Updated skill '${skill_name}' in '${category}': ${oldLevel || "new"} → ${new_level}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update skill: ${error}` }],
      };
    }
  }
);

// Tool: Add Experience
server.registerTool(
  "add_experience",
  {
    title: "Add Experience",
    description: "Add a new work experience entry",
    inputSchema: {
      company: z.string().describe("Company name"),
      title: z.string().describe("Job title"),
      start_date: z.string().describe("Start date (YYYY-MM-DD)"),
      end_date: z.string().optional().describe("End date (YYYY-MM-DD or 'Present')"),
      description: z.string().describe("Role description"),
      responsibilities: z.array(z.string()).optional().describe("List of responsibilities"),
      technologies: z.array(z.string()).optional().describe("Technologies used"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ company, title, start_date, end_date, description, responsibilities, technologies }) => {
    try {
      const experience = await readJsonFile<Record<string, unknown>>("profile/experience.json");

      experience[company] = {
        title,
        start_date,
        end_date: end_date || "Present",
        description,
        responsibilities: responsibilities || [],
        technologies: technologies || [],
      };

      await writeJsonFile("profile/experience.json", experience);

      return {
        content: [{ type: "text", text: `Added experience: ${title} at ${company}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to add experience: ${error}` }],
      };
    }
  }
);

// Tool: Add Certification
server.registerTool(
  "add_certification",
  {
    title: "Add Certification",
    description: "Add a new certification to education profile",
    inputSchema: {
      name: z.string().describe("Certification name"),
      issuer: z.string().describe("Issuing organization"),
      date_earned: z.string().describe("Date earned (YYYY-MM-DD)"),
      expiration_date: z.string().optional().describe("Expiration date if applicable"),
      credential_id: z.string().optional().describe("Credential ID"),
      url: z.string().optional().describe("Verification URL"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ name, issuer, date_earned, expiration_date, credential_id, url }) => {
    try {
      const education = await readJsonFile<Record<string, unknown>>("profile/education.json");

      if (!education.certifications) {
        education.certifications = [];
      }

      const certifications = education.certifications as Array<Record<string, unknown>>;
      certifications.push({
        name,
        issuer,
        date_earned,
        expiration_date: expiration_date || null,
        credential_id: credential_id || null,
        url: url || null,
      });

      await writeJsonFile("profile/education.json", education);

      return {
        content: [{ type: "text", text: `Added certification: ${name} from ${issuer}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to add certification: ${error}` }],
      };
    }
  }
);

// Tool: Update Project Status
server.registerTool(
  "update_project_status",
  {
    title: "Update Project Status",
    description: "Update a project's status or move it between active/planned/completed",
    inputSchema: {
      project_id: z.string().describe("Project identifier (key in the JSON file)"),
      current_status: z.enum(["active", "planned", "completed"]).describe("Current status file where project is located"),
      new_status: z.enum(["active", "planned", "completed"]).describe("New status to move project to"),
      completion_percentage: z.number().optional().describe("Update completion percentage (0-100)"),
      notes: z.string().optional().describe("Add status notes"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ project_id, current_status, new_status, completion_percentage, notes }) => {
    try {
      const files: Record<string, string> = {
        active: "projects/active.json",
        planned: "projects/planned.json",
        completed: "projects/completed.json",
      };

      const sourceData = await readJsonFile<Record<string, Record<string, unknown>>>(files[current_status]);

      if (!sourceData[project_id]) {
        return {
          content: [{ type: "text", text: `Project '${project_id}' not found in ${current_status} projects.` }],
        };
      }

      const project = sourceData[project_id];

      if (completion_percentage !== undefined) {
        project.completion = completion_percentage;
      }

      if (notes) {
        project.status_notes = notes;
      }

      if (current_status !== new_status) {
        delete sourceData[project_id];
        await writeJsonFile(files[current_status], sourceData);

        const destData = await readJsonFile<Record<string, Record<string, unknown>>>(files[new_status]);
        destData[project_id] = project;
        await writeJsonFile(files[new_status], destData);

        return {
          content: [{ type: "text", text: `Moved project '${project_id}' from ${current_status} to ${new_status}` }],
        };
      } else {
        await writeJsonFile(files[current_status], sourceData);
        return {
          content: [{ type: "text", text: `Updated project '${project_id}' in ${current_status}` }],
        };
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update project: ${error}` }],
      };
    }
  }
);

// Tool: Add Project
server.registerTool(
  "add_project",
  {
    title: "Add Project",
    description: "Add a new project to the planned projects list",
    inputSchema: {
      id: z.string().describe("Project identifier (will be key in JSON)"),
      name: z.string().describe("Project display name"),
      description: z.string().describe("Project description"),
      type: z.enum(["saas", "open_source", "consulting", "internal_tool", "side_project"]).describe("Project type"),
      technologies: z.array(z.string()).describe("Technologies to be used"),
      monetization_strategy: z.string().optional().describe("How this project will make money"),
      target_audience: z.string().optional().describe("Who this project is for"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Project priority"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ id, name, description, type, technologies, monetization_strategy, target_audience, priority }) => {
    try {
      const planned = await readJsonFile<Record<string, unknown>>("projects/planned.json");

      if (planned[id]) {
        return {
          content: [{ type: "text", text: `Project '${id}' already exists in planned projects.` }],
        };
      }

      planned[id] = {
        name,
        description,
        type,
        technologies,
        monetization_strategy: monetization_strategy || "TBD",
        target_audience: target_audience || "TBD",
        priority: priority || "medium",
        status: "planned",
        created_date: new Date().toISOString().split("T")[0],
      };

      await writeJsonFile("projects/planned.json", planned);

      return {
        content: [{ type: "text", text: `Added new project: ${name} (${id})` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to add project: ${error}` }],
      };
    }
  }
);

// Tool: Log Job Application
server.registerTool(
  "log_job_application",
  {
    title: "Log Job Application",
    description: "Log a new job application",
    inputSchema: {
      company: z.string().describe("Company name"),
      role: z.string().describe("Job title/role"),
      url: z.string().optional().describe("Job posting URL"),
      salary_range: z.string().optional().describe("Salary range if known"),
      status: z.enum(["applied", "screening", "interviewing", "offer", "rejected", "withdrawn", "ghosted"]).optional().describe("Application status (default: applied)"),
      resume_variant: z.string().optional().describe("Which resume variant was used"),
      notes: z.string().optional().describe("Additional notes"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ company, role, url, salary_range, status, resume_variant, notes }) => {
    try {
      const data = await readJsonFile<{ applications: Array<Record<string, unknown>> }>("job-applications/applications.json");

      const newId = `app-${Date.now()}`;
      const application = {
        id: newId,
        company,
        role,
        url: url || null,
        salary_range: salary_range || null,
        status: status || "applied",
        resume_variant: resume_variant || null,
        notes: notes || null,
        applied_date: new Date().toISOString().split("T")[0],
        last_updated: new Date().toISOString().split("T")[0],
      };

      data.applications.push(application);

      await writeJsonFile("job-applications/applications.json", data);

      return {
        content: [{ type: "text", text: `Logged application: ${role} at ${company} (ID: ${newId})` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to log application: ${error}` }],
      };
    }
  }
);

// Tool: Log Interview
server.registerTool(
  "log_interview",
  {
    title: "Log Interview",
    description: "Log a job interview with prep notes and questions",
    inputSchema: {
      application_id: z.string().describe("Associated job application ID"),
      company: z.string().describe("Company name"),
      interview_type: z.enum(["phone_screen", "technical", "behavioral", "system_design", "final_round", "other"]).describe("Type of interview"),
      date: z.string().describe("Interview date (YYYY-MM-DD)"),
      interviewer: z.string().optional().describe("Interviewer name/role"),
      questions_asked: z.array(z.string()).optional().describe("Questions that were asked"),
      prep_notes: z.string().optional().describe("Preparation notes"),
      outcome: z.enum(["passed", "rejected", "pending", "unknown"]).optional().describe("Interview outcome"),
      feedback: z.string().optional().describe("Feedback received"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ application_id, company, interview_type, date, interviewer, questions_asked, prep_notes, outcome, feedback }) => {
    try {
      const data = await readJsonFile<{ interviews: Array<Record<string, unknown>> }>("job-applications/interviews.json");

      const newId = `int-${Date.now()}`;
      const interview = {
        id: newId,
        application_id,
        company,
        interview_type,
        date,
        interviewer: interviewer || null,
        questions_asked: questions_asked || [],
        prep_notes: prep_notes || null,
        outcome: outcome || "pending",
        feedback: feedback || null,
        logged_date: new Date().toISOString().split("T")[0],
      };

      data.interviews.push(interview);

      await writeJsonFile("job-applications/interviews.json", data);

      return {
        content: [{ type: "text", text: `Logged interview: ${interview_type} at ${company} (ID: ${newId})` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to log interview: ${error}` }],
      };
    }
  }
);

// Tool: Update Financials
server.registerTool(
  "update_financials",
  {
    title: "Update Financials",
    description: "Update financial data for a business (revenue, expenses, metrics)",
    inputSchema: {
      business: z.enum(["codaissance", "tampertantrum-labs"]).describe("Which business to update"),
      mrr: z.number().optional().describe("Update Monthly Recurring Revenue"),
      arr: z.number().optional().describe("Update Annual Recurring Revenue"),
      total_revenue: z.number().optional().describe("Update total revenue"),
      customers: z.number().optional().describe("Update customer count"),
      free_users: z.number().optional().describe("Update free user count"),
      monthly_expense: z.object({
        name: z.string(),
        cost: z.number(),
        purpose: z.string(),
      }).optional().describe("Add a monthly recurring expense"),
      one_time_expense: z.object({
        name: z.string(),
        cost: z.number(),
        date: z.string(),
        purpose: z.string(),
      }).optional().describe("Add a one-time expense"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ business, mrr, arr, total_revenue, customers, free_users, monthly_expense, one_time_expense }) => {
    try {
      const financials = await readJsonFile<Record<string, unknown>>(`business/${business}/financials.json`);
      const updates: string[] = [];

      if (mrr !== undefined) {
        (financials.revenue as Record<string, unknown>).mrr = mrr;
        updates.push(`MRR: $${mrr}`);
      }

      if (arr !== undefined) {
        (financials.revenue as Record<string, unknown>).arr = arr;
        updates.push(`ARR: $${arr}`);
      }

      if (total_revenue !== undefined) {
        (financials.revenue as Record<string, unknown>).total_revenue = total_revenue;
        updates.push(`Total Revenue: $${total_revenue}`);
      }

      if (customers !== undefined) {
        (financials.metrics as Record<string, unknown>).customers = customers;
        updates.push(`Customers: ${customers}`);
      }

      if (free_users !== undefined) {
        (financials.metrics as Record<string, unknown>).free_users = free_users;
        updates.push(`Free Users: ${free_users}`);
      }

      if (monthly_expense) {
        const expenses = financials.expenses as Record<string, unknown>;
        const monthly = (expenses.monthly_recurring || []) as Array<Record<string, unknown>>;
        monthly.push({ ...monthly_expense, status: "active" });
        expenses.monthly_recurring = monthly;
        expenses.total_monthly = monthly.reduce((sum, e) => sum + (e.cost as number), 0);
        updates.push(`Added monthly expense: ${monthly_expense.name} ($${monthly_expense.cost})`);
      }

      if (one_time_expense) {
        const expenses = financials.expenses as Record<string, unknown>;
        const oneTime = (expenses.one_time || []) as Array<Record<string, unknown>>;
        oneTime.push(one_time_expense);
        expenses.one_time = oneTime;
        updates.push(`Added one-time expense: ${one_time_expense.name} ($${one_time_expense.cost})`);
      }

      await writeJsonFile(`business/${business}/financials.json`, financials);

      return {
        content: [{ type: "text", text: `Updated ${business} financials:\n${updates.join("\n")}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update financials: ${error}` }],
      };
    }
  }
);

// Tool: Update LinkedIn Metrics
server.registerTool(
  "update_linkedin_metrics",
  {
    title: "Update LinkedIn Metrics",
    description: "Update LinkedIn metrics for an account",
    inputSchema: {
      account: z.enum(["personal", "codaissance", "tampertantrum"]).describe("Which account to update"),
      followers: z.number().optional().describe("Update follower count"),
      connections: z.number().optional().describe("Update connection count (personal only)"),
      profile_views: z.number().optional().describe("Update profile views (last 90 days)"),
      post_impressions: z.number().optional().describe("Update post impressions"),
      engagement_rate: z.number().optional().describe("Update engagement rate (as percentage)"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ account, followers, connections, profile_views, post_impressions, engagement_rate }) => {
    try {
      const files: Record<string, string> = {
        personal: "linkedin/personal-metrics.json",
        codaissance: "linkedin/codaissance-metrics.json",
        tampertantrum: "linkedin/tampertantrum-metrics.json",
      };

      const metrics = await readJsonFile<Record<string, unknown>>(files[account]);
      const updates: string[] = [];
      const today = new Date().toISOString().split("T")[0];

      if (followers !== undefined) {
        metrics.followers = followers;
        updates.push(`Followers: ${followers}`);
      }

      if (connections !== undefined && account === "personal") {
        metrics.connections = connections;
        updates.push(`Connections: ${connections}`);
      }

      if (profile_views !== undefined) {
        metrics.profile_views_90d = profile_views;
        updates.push(`Profile Views (90d): ${profile_views}`);
      }

      if (post_impressions !== undefined) {
        metrics.post_impressions = post_impressions;
        updates.push(`Post Impressions: ${post_impressions}`);
      }

      if (engagement_rate !== undefined) {
        metrics.engagement_rate = engagement_rate;
        updates.push(`Engagement Rate: ${engagement_rate}%`);
      }

      metrics.last_updated = today;

      await writeJsonFile(files[account], metrics);

      return {
        content: [{ type: "text", text: `Updated ${account} LinkedIn metrics:\n${updates.join("\n")}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update metrics: ${error}` }],
      };
    }
  }
);

// Tool: Add Idea
server.registerTool(
  "add_idea",
  {
    title: "Add Idea",
    description: "Add a new idea to the idea bank",
    inputSchema: {
      source: z.enum(["personal", "codaissance", "tampertantrum-labs"]).describe("Which idea bank to add to"),
      title: z.string().describe("Idea title"),
      description: z.string().describe("Idea description"),
      problem: z.string().optional().describe("Problem this solves"),
      target_audience: z.string().optional().describe("Who this is for"),
      potential_revenue: z.string().optional().describe("Revenue potential estimate"),
      complexity: z.enum(["low", "medium", "high"]).optional().describe("Implementation complexity"),
      tags: z.array(z.string()).optional().describe("Tags/categories"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ source, title, description, problem, target_audience, potential_revenue, complexity, tags }) => {
    try {
      const paths: Record<string, string> = {
        personal: "ideas/personal/ideas.json",
        codaissance: "ideas/business/codaissance/ideas.json",
        "tampertantrum-labs": "ideas/business/tampertantrum-labs/ideas.json",
      };

      const data = await readJsonFile<{ ideas: Array<Record<string, unknown>> }>(paths[source]);

      const newId = `idea-${Date.now()}`;
      const idea = {
        id: newId,
        title,
        description,
        problem: problem || null,
        target_audience: target_audience || null,
        potential_revenue: potential_revenue || null,
        complexity: complexity || "medium",
        tags: tags || [],
        status: "raw",
        created_date: new Date().toISOString().split("T")[0],
      };

      data.ideas.push(idea);

      await writeJsonFile(paths[source], data);

      return {
        content: [{ type: "text", text: `Added idea to ${source}: ${title} (ID: ${newId})` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to add idea: ${error}` }],
      };
    }
  }
);

// Tool: Update Milestone
server.registerTool(
  "update_milestone",
  {
    title: "Update Milestone",
    description: "Update a career roadmap milestone's status or completion percentage",
    inputSchema: {
      milestone_id: z.string().describe("Milestone ID (e.g., 'm1', 'm2')"),
      status: z.enum(["in_progress", "not_started", "completed"]).optional().describe("New status"),
      completion: z.number().optional().describe("Completion percentage (0-100)"),
      notes: z.string().optional().describe("Add notes about progress"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ milestone_id, status, completion, notes }) => {
    try {
      const roadmap = await readJsonFile<{ career_roadmap: { milestones: Array<Record<string, unknown>>; last_updated?: string; [key: string]: unknown } }>("career/roadmap.json");
      const milestones = roadmap.career_roadmap.milestones;

      const milestone = milestones.find(m => m.id === milestone_id);
      if (!milestone) {
        return {
          content: [{ type: "text", text: `Milestone '${milestone_id}' not found. Available: ${milestones.map(m => m.id).join(", ")}` }],
        };
      }

      const updates: string[] = [];

      if (status !== undefined) {
        milestone.status = status;
        updates.push(`Status: ${status}`);
      }

      if (completion !== undefined) {
        milestone.completion = completion;
        updates.push(`Completion: ${completion}%`);
      }

      if (notes) {
        milestone.progress_notes = notes;
        updates.push(`Notes: ${notes}`);
      }

      roadmap.career_roadmap.last_updated = new Date().toISOString().split("T")[0];

      await writeJsonFile("career/roadmap.json", roadmap);

      return {
        content: [{ type: "text", text: `Updated milestone ${milestone_id} (${milestone.title}):\n${updates.join("\n")}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update milestone: ${error}` }],
      };
    }
  }
);

// Tool: Update Learning Progress
server.registerTool(
  "update_learning_progress",
  {
    title: "Update Learning Progress",
    description: "Update learning progress or mark items as completed",
    inputSchema: {
      skill_name: z.string().describe("Name of the skill/topic being learned"),
      action: z.enum(["update_progress", "mark_completed", "add_to_queue"]).describe("What action to take"),
      progress_percentage: z.number().optional().describe("Update progress percentage (for update_progress)"),
      completion_notes: z.string().optional().describe("Notes on completion (for mark_completed)"),
      resource_url: z.string().optional().describe("Resource URL (for add_to_queue)"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Priority (for add_to_queue)"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ skill_name, action, progress_percentage, completion_notes, resource_url, priority }) => {
    try {
      if (action === "mark_completed") {
        const completed = await readJsonFile<{ entries: Array<Record<string, unknown>> }>("learning/completed.json");

        completed.entries.push({
          skill: skill_name,
          completed_date: new Date().toISOString().split("T")[0],
          notes: completion_notes || null,
        });

        await writeJsonFile("learning/completed.json", completed);

        return {
          content: [{ type: "text", text: `Marked '${skill_name}' as completed in learning log` }],
        };
      }

      const roadmap = await readJsonFile<Record<string, unknown>>("learning/roadmap.json");

      if (action === "update_progress") {
        const currentFocus = roadmap.current_focus as Array<Record<string, unknown>>;
        const item = currentFocus.find(i => (i.skill as string)?.toLowerCase().includes(skill_name.toLowerCase()));

        if (item && progress_percentage !== undefined) {
          item.progress = progress_percentage;
          item.last_updated = new Date().toISOString().split("T")[0];
          await writeJsonFile("learning/roadmap.json", roadmap);
          return {
            content: [{ type: "text", text: `Updated '${skill_name}' progress to ${progress_percentage}%` }],
          };
        }
        return {
          content: [{ type: "text", text: `Skill '${skill_name}' not found in current focus` }],
        };
      }

      if (action === "add_to_queue") {
        const queue = (roadmap.queue || []) as Array<Record<string, unknown>>;
        queue.push({
          skill: skill_name,
          resource_url: resource_url || null,
          priority: priority || "medium",
          added_date: new Date().toISOString().split("T")[0],
        });
        roadmap.queue = queue;
        await writeJsonFile("learning/roadmap.json", roadmap);
        return {
          content: [{ type: "text", text: `Added '${skill_name}' to learning queue` }],
        };
      }

      return {
        content: [{ type: "text", text: "Invalid action specified" }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update learning progress: ${error}` }],
      };
    }
  }
);

// ===== UPDATE LINKEDIN PROFILE =====
server.tool(
  "update_linkedin_profile",
  "Update LinkedIn profile data (personal, codaissance, or tampertantrum_labs account)",
  {
    account: z.enum(["personal", "codaissance", "tampertantrum_labs"]).describe("Which LinkedIn account to update"),
    headline: z.string().optional().describe("Profile headline (personal only)"),
    bio: z.string().optional().describe("Profile bio/about section (personal only)"),
    tagline: z.string().optional().describe("Company tagline (company pages only)"),
    description: z.string().optional().describe("Company description (company pages only)"),
    followers: z.number().optional().describe("Current follower count"),
    connections: z.number().optional().describe("Current connections count (personal only)"),
    profile_views_last_90_days: z.number().optional().describe("Profile views in last 90 days (personal only)"),
    search_appearances_last_week: z.number().optional().describe("Search appearances last week (personal only)"),
    post_impressions_last_7_days: z.number().optional().describe("Post impressions last 7 days"),
    engagement_rate: z.number().optional().describe("Engagement rate (company pages only)"),
    open_to_work: z.boolean().optional().describe("Open to work status (personal only)"),
    creator_mode: z.boolean().optional().describe("Creator mode enabled (personal only)"),
  },
  async ({
    account,
    headline,
    bio,
    tagline,
    description,
    followers,
    connections,
    profile_views_last_90_days,
    search_appearances_last_week,
    post_impressions_last_7_days,
    engagement_rate,
    open_to_work,
    creator_mode,
  }) => {
    try {
      const profile = await readJsonFile<Record<string, Record<string, unknown>>>("linkedin/profile.json");
      const accountData = profile[account];

      if (!accountData) {
        return { content: [{ type: "text", text: `Account '${account}' not found in profile.json` }] };
      }

      const updates: string[] = [];

      if (account === "personal") {
        if (headline !== undefined) { accountData.headline = headline; updates.push("headline"); }
        if (bio !== undefined) { accountData.bio = bio; updates.push("bio"); }
        if (connections !== undefined) { accountData.connections = connections; updates.push("connections"); }
        if (profile_views_last_90_days !== undefined) { accountData.profile_views_last_90_days = profile_views_last_90_days; updates.push("profile_views_last_90_days"); }
        if (search_appearances_last_week !== undefined) { accountData.search_appearances_last_week = search_appearances_last_week; updates.push("search_appearances_last_week"); }
        if (open_to_work !== undefined) { accountData.open_to_work = open_to_work; updates.push("open_to_work"); }
        if (creator_mode !== undefined) { accountData.creator_mode = creator_mode; updates.push("creator_mode"); }
      } else {
        // Company pages
        if (tagline !== undefined) { accountData.tagline = tagline; updates.push("tagline"); }
        if (description !== undefined) { accountData.description = description; updates.push("description"); }
        if (engagement_rate !== undefined) { accountData.engagement_rate = engagement_rate; updates.push("engagement_rate"); }
      }

      // Common fields
      if (followers !== undefined) { accountData.followers = followers; updates.push("followers"); }
      if (post_impressions_last_7_days !== undefined) { accountData.post_impressions_last_7_days = post_impressions_last_7_days; updates.push("post_impressions_last_7_days"); }

      accountData.last_updated = new Date().toISOString().split("T")[0];

      await writeJsonFile("linkedin/profile.json", profile);

      return {
        content: [{ type: "text", text: `Updated LinkedIn ${account} profile: ${updates.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update LinkedIn profile: ${error}` }] };
    }
  }
);

// ===== SCAFFOLD PROJECT =====
server.tool(
  "scaffold_project",
  "Create folder structure for a new project in projects/specs/{project_key}/ with README.md template",
  {
    project_key: z.string().describe("Project key/identifier (lowercase, hyphenated, e.g., 'my-new-project')"),
    project_name: z.string().describe("Human-readable project name"),
    project_type: z.string().describe("Project type (e.g., 'SaaS Web Application', 'CLI Tool', 'Component Library')"),
    tagline: z.string().optional().describe("One-sentence tagline capturing the value"),
    include_style_guide: z.boolean().optional().default(false).describe("Include a style-guide.md template"),
    include_architecture: z.boolean().optional().default(false).describe("Include an architecture.md template"),
  },
  async ({ project_key, project_name, project_type, tagline, include_style_guide, include_architecture }) => {
    try {
      const specsDir = path.join(REPO_ROOT, "projects", "specs", project_key);

      // Create directory
      await fs.mkdir(specsDir, { recursive: true });

      // Create README.md from template
      const readmeContent = `# ${project_name}

## Project Identity

**Name**: ${project_name}
**Type**: ${project_type}
**Tagline**: ${tagline || "<!-- One sentence that captures the value -->"}

---

## The Problem

**Problem Statement**:
<!-- What specific pain exists? Who feels it? How often? Be concrete. -->

**Current Solutions**:
<!-- What do people do today? Why is it inadequate? -->

**Cost of Inaction**:
<!-- What happens if this problem isn't solved? -->

---

## The Solution

**Solution Statement**:
<!-- How does this project solve the problem? Be specific about the mechanism. -->

**What This Is NOT**:
<!-- Explicitly state what's out of scope. Helps prevent scope creep. -->

---

## Target Audience

**Primary User**:
<!-- Describe the ideal first user. Be specific: role, company size, technical level. -->

**User Personas**:
1.
2.

**Anti-Personas** (who is this NOT for):
1.

---

## MVP Spec

**MVP Goal**:
<!-- What does the MVP prove? What question does it answer? -->

**MVP Features** (3-5 max):
1.
2.
3.

**MVP Technologies**:
-

**MVP Success Criteria**:
<!-- How do you know MVP worked? Be specific and measurable. -->

---

## Post-MVP Spec

**Post-MVP Features**:
1.
2.
3.

**Post-MVP Technologies**:
-

---

## Technical Architecture

**Architecture Overview**:
<!-- Brief description. Monolith? Microservices? Serverless? -->

**Key Technical Decisions**:
-

**Security Considerations**:
<!-- Auth, data protection, common vulnerabilities to address -->

---

## Success Criteria

**Success Milestone**:
<!-- Specific, measurable outcome that proves the project works. -->

**Key Metrics**:
1.
2.
3.

---

## Business Model

**Monetization Strategy**:
<!-- Open-source, Freemium, SaaS Subscription, One-time Purchase, etc. -->

**Revenue Goal** (first 12 months):
<!-- Realistic target. $0 is fine for open-source. -->

---

## Mission Statement

**Mission**:
<!-- Why does this project exist? What change does it create in the world? -->

---

_Created: ${new Date().toISOString().split("T")[0]}_
`;

      await fs.writeFile(path.join(specsDir, "README.md"), readmeContent, "utf-8");
      const createdFiles = ["README.md"];

      // Optional: style-guide.md
      if (include_style_guide) {
        const styleGuideContent = `# ${project_name} - Style Guide

## Brand Colors

**Primary**:
**Secondary**:
**Accent**:
**Background**:
**Text**:

---

## Typography

**Headings**:
**Body**:
**Code**:

---

## Voice & Tone

**Voice Characteristics**:
-

**Writing Guidelines**:
-

---

## UI Components

<!-- Document component patterns, spacing, etc. -->

---

_Created: ${new Date().toISOString().split("T")[0]}_
`;
        await fs.writeFile(path.join(specsDir, "style-guide.md"), styleGuideContent, "utf-8");
        createdFiles.push("style-guide.md");
      }

      // Optional: architecture.md
      if (include_architecture) {
        const architectureContent = `# ${project_name} - Architecture

## System Overview

<!-- High-level architecture diagram or description -->

---

## Components

### Frontend
<!-- Frontend architecture details -->

### Backend
<!-- Backend architecture details -->

### Database
<!-- Database schema and design decisions -->

---

## Data Flow

<!-- How data moves through the system -->

---

## External Integrations

<!-- Third-party services, APIs, etc. -->

---

## Security Architecture

<!-- Authentication, authorization, data protection -->

---

## Deployment

<!-- Infrastructure, CI/CD, environments -->

---

_Created: ${new Date().toISOString().split("T")[0]}_
`;
        await fs.writeFile(path.join(specsDir, "architecture.md"), architectureContent, "utf-8");
        createdFiles.push("architecture.md");
      }

      return {
        content: [{ type: "text", text: `Created project scaffold at projects/specs/${project_key}/\nFiles created: ${createdFiles.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to scaffold project: ${error}` }] };
    }
  }
);

// ===== UPDATE GOAL PROGRESS =====
server.tool(
  "update_goal_progress",
  "Update progress on a 2026 goal by ID",
  {
    goal_id: z.string().describe("Goal ID (e.g., 'saas-launch', 'income-300k')"),
    status: z.enum(["not_started", "in_progress", "completed", "blocked"]).optional().describe("Goal status"),
    current_metric: z.string().optional().describe("Current metric value (e.g., '1 product launched')"),
    notes: z.string().optional().describe("Progress notes or updates"),
  },
  async ({ goal_id, status, current_metric, notes }) => {
    try {
      const goals = await readJsonFile<{
        year: number;
        last_updated: string;
        categories: Record<string, {
          title: string;
          goals: Array<{
            id: string;
            goal: string;
            status: string;
            target_date: string;
            metrics: { target: string; current: string };
            notes?: string;
          }>;
        }>;
      }>("profile/goals/2026-goals.json");

      let found = false;
      let goalName = "";

      for (const category of Object.values(goals.categories)) {
        for (const goal of category.goals) {
          if (goal.id === goal_id) {
            found = true;
            goalName = goal.goal;
            if (status) goal.status = status;
            if (current_metric) goal.metrics.current = current_metric;
            if (notes) goal.notes = notes;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        return { content: [{ type: "text", text: `Goal with ID '${goal_id}' not found` }] };
      }

      goals.last_updated = new Date().toISOString().split("T")[0];
      await writeJsonFile("profile/goals/2026-goals.json", goals);

      const updates = [];
      if (status) updates.push(`status: ${status}`);
      if (current_metric) updates.push(`current: ${current_metric}`);
      if (notes) updates.push("notes updated");

      return {
        content: [{ type: "text", text: `Updated goal '${goalName}' (${goal_id}): ${updates.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update goal progress: ${error}` }] };
    }
  }
);

// ===== ADD MASTERMIND MEMBER =====
server.tool(
  "add_mastermind_member",
  "Add a member to the mastermind alliance (or to needed members list)",
  {
    name: z.string().describe("Member name"),
    description: z.string().describe("Member description including role, relationship, and what they provide"),
    list: z.enum(["current", "needed"]).default("current").describe("Add to current_members or needed_members list"),
  },
  async ({ name, description, list }) => {
    try {
      const chiefAim = await readJsonFile<{
        napoleon_hill_principles: {
          master_mind_alliance: {
            description: string;
            my_mastermind: string;
            current_members: string[];
            needed_members: string[];
          };
          [key: string]: unknown;
        };
        [key: string]: unknown;
      }>("career/chief-aim.json");

      const mastermind = chiefAim.napoleon_hill_principles.master_mind_alliance;
      const memberEntry = `${name} - ${description}`;

      if (list === "current") {
        mastermind.current_members.push(memberEntry);
      } else {
        mastermind.needed_members.push(memberEntry);
      }

      await writeJsonFile("career/chief-aim.json", chiefAim);

      return {
        content: [{ type: "text", text: `Added '${name}' to mastermind ${list}_members list` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to add mastermind member: ${error}` }] };
    }
  }
);

// ===== LOG WEEKLY ACTION =====
server.tool(
  "log_weekly_action",
  "Log a weekly action item for tracking Napoleon Hill-style consistent effort",
  {
    action: z.string().describe("Description of the action taken"),
    category: z.enum(["business", "learning", "networking", "health", "family", "career"]).describe("Action category"),
    principle: z.string().optional().describe("Napoleon Hill principle this relates to (e.g., 'going_extra_mile')"),
    impact: z.string().optional().describe("Impact or result of the action"),
  },
  async ({ action, category, principle, impact }) => {
    try {
      let weeklyActions: {
        weeks: Array<{
          week_start: string;
          actions: Array<{
            date: string;
            action: string;
            category: string;
            principle?: string;
            impact?: string;
          }>;
        }>;
      };

      try {
        weeklyActions = await readJsonFile("career/weekly-actions.json");
      } catch {
        // Initialize if file doesn't exist or is empty
        weeklyActions = { weeks: [] };
      }

      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay()); // Sunday
      const weekStartStr = weekStart.toISOString().split("T")[0];

      // Find or create current week
      let currentWeek = weeklyActions.weeks.find(w => w.week_start === weekStartStr);
      if (!currentWeek) {
        currentWeek = { week_start: weekStartStr, actions: [] };
        weeklyActions.weeks.unshift(currentWeek); // Add to beginning
      }

      currentWeek.actions.push({
        date: today.toISOString().split("T")[0],
        action,
        category,
        principle: principle || undefined,
        impact: impact || undefined,
      });

      await writeJsonFile("career/weekly-actions.json", weeklyActions);

      return {
        content: [{ type: "text", text: `Logged weekly action: "${action}" (${category})` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to log weekly action: ${error}` }] };
    }
  }
);

// ===== UPDATE CHIEF AIM =====
server.tool(
  "update_chief_aim",
  "Update Napoleon Hill principle content or career vision in chief-aim.json",
  {
    section: z.enum(["definiteness_of_purpose", "applied_faith", "going_extra_mile", "career_vision_questions"]).describe("Which section to update"),
    field: z.string().describe("Field name to update within the section"),
    value: z.union([z.string(), z.array(z.string())]).describe("New value (string or array of strings)"),
  },
  async ({ section, field, value }) => {
    try {
      const chiefAim = await readJsonFile<Record<string, unknown>>("career/chief-aim.json");

      if (section === "career_vision_questions") {
        const careerVision = chiefAim.career_vision_questions as Record<string, unknown>;
        if (careerVision) {
          careerVision[field] = value;
        }
      } else {
        const principles = chiefAim.napoleon_hill_principles as Record<string, Record<string, unknown>>;
        if (principles && principles[section]) {
          principles[section][field] = value;
          if (section === "definiteness_of_purpose") {
            principles[section].last_reviewed = new Date().toISOString().split("T")[0];
          }
        }
      }

      await writeJsonFile("career/chief-aim.json", chiefAim);

      return {
        content: [{ type: "text", text: `Updated chief-aim.json: ${section}.${field}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update chief aim: ${error}` }] };
    }
  }
);

// ===== UPDATE APPLICATION STATUS =====
server.tool(
  "update_application_status",
  "Update the status of an existing job application",
  {
    company: z.string().describe("Company name to find the application"),
    status: z.enum(["applied", "screening", "interviewing", "offer", "rejected", "withdrawn", "ghosted"]).describe("New application status"),
    notes: z.string().optional().describe("Additional notes about the status change"),
    follow_up_date: z.string().optional().describe("Next follow-up date (YYYY-MM-DD)"),
    outcome: z.string().optional().describe("Final outcome if status is offer/rejected/withdrawn"),
  },
  async ({ company, status, notes, follow_up_date, outcome }) => {
    try {
      const applications = await readJsonFile<{
        applications: Array<{
          id: string;
          company: string;
          role: string;
          status: string;
          notes: string;
          follow_up_date: string | null;
          outcome: string | null;
          last_updated: string;
          [key: string]: unknown;
        }>;
      }>("job-applications/applications.json");

      const app = applications.applications.find(
        a => a.company.toLowerCase().includes(company.toLowerCase())
      );

      if (!app) {
        return { content: [{ type: "text", text: `No application found for company matching '${company}'` }] };
      }

      const previousStatus = app.status;
      app.status = status;
      app.last_updated = new Date().toISOString().split("T")[0];

      if (notes) {
        app.notes = app.notes ? `${app.notes}\n\n[${app.last_updated}] ${notes}` : notes;
      }
      if (follow_up_date) app.follow_up_date = follow_up_date;
      if (outcome) app.outcome = outcome;

      await writeJsonFile("job-applications/applications.json", applications);

      return {
        content: [{ type: "text", text: `Updated ${app.company} (${app.role}): ${previousStatus} → ${status}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update application status: ${error}` }] };
    }
  }
);

// ============================================
// JOURNAL TOOLS
// ============================================

// Helper to get month name
function getMonthName(month: number): string {
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];
  return months[month - 1];
}

// Helper to get day of week
function getDayOfWeek(date: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[date.getDay()];
}

// Helper to parse YAML frontmatter from markdown
function parseJournalEntry(content: string): { metadata: Record<string, unknown>; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { metadata: {}, body: content };
  }

  const yamlContent = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // Simple YAML parser for our known structure
  const metadata: Record<string, unknown> = {};
  const lines = yamlContent.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  for (const line of lines) {
    if (line.startsWith("  - ")) {
      currentArray.push(line.substring(4));
    } else if (line.includes(": ")) {
      if (currentKey && currentArray.length > 0) {
        metadata[currentKey] = currentArray;
        currentArray = [];
      }

      const colonIndex = line.indexOf(": ");
      const key = line.substring(0, colonIndex);
      const value = line.substring(colonIndex + 2);
      currentKey = key;

      if (value.startsWith("[") && value.endsWith("]")) {
        metadata[key] = value.slice(1, -1).split(", ").map(s => s.trim());
      } else if (value === "") {
        currentArray = [];
      } else {
        const numValue = Number(value);
        metadata[key] = isNaN(numValue) ? value : numValue;
      }
    }
  }

  if (currentKey && currentArray.length > 0) {
    metadata[currentKey] = currentArray;
  }

  return { metadata, body };
}

// ===== ADD JOURNAL ENTRY =====
server.tool(
  "add_journal_entry",
  "Create a new daily journal entry with structured metadata",
  {
    date: z.string().describe("Date for the entry (YYYY-MM-DD)"),
    content: z.string().describe("Markdown content for the entry body"),
    mood: z.string().optional().describe("Descriptive mood"),
    energy_level: z.number().min(1).max(10).optional().describe("Energy level 1-10"),
    tags: z.array(z.string()).optional().describe("Array of tags"),
    wins: z.array(z.string()).optional().describe("Array of wins"),
    struggles: z.array(z.string()).optional().describe("Array of struggles"),
    kids_moments: z.array(z.string()).optional().describe("Array of kid moments"),
    napoleon_hill_principle: z.string().optional().describe("Which Napoleon Hill principle applied"),
  },
  async ({ date, content, mood, energy_level, tags, wins, struggles, kids_moments, napoleon_hill_principle }) => {
    try {
      const [year, month, day] = date.split("-").map(Number);
      const dateObj = new Date(year, month - 1, day);
      const monthName = getMonthName(month);
      const dayOfWeek = getDayOfWeek(dateObj);
      const monthFolder = `${month.toString().padStart(2, "0")}-${monthName}`;

      const filePath = `journal/entries/${year}/${monthFolder}/${date}.md`;

      // Check if entry exists
      try {
        await readJsonFile(filePath);
        return { content: [{ type: "text", text: `Journal entry for ${date} already exists.` }] };
      } catch {
        // File doesn't exist, continue
      }

      // Build YAML frontmatter
      let frontmatter = `---\ndate: ${date}\nday_of_week: ${dayOfWeek}\n`;
      if (mood) frontmatter += `mood: ${mood}\n`;
      if (energy_level) frontmatter += `energy_level: ${energy_level}\n`;
      if (tags && tags.length > 0) frontmatter += `tags: [${tags.join(", ")}]\n`;
      if (wins && wins.length > 0) {
        frontmatter += `wins:\n`;
        for (const win of wins) frontmatter += `  - ${win}\n`;
      }
      if (struggles && struggles.length > 0) {
        frontmatter += `struggles:\n`;
        for (const struggle of struggles) frontmatter += `  - ${struggle}\n`;
      }
      if (kids_moments && kids_moments.length > 0) {
        frontmatter += `kids_moments:\n`;
        for (const moment of kids_moments) frontmatter += `  - ${moment}\n`;
      }
      if (napoleon_hill_principle) frontmatter += `napoleon_hill_principle: ${napoleon_hill_principle}\n`;
      frontmatter += `---\n\n`;

      const fullContent = frontmatter + content;

      // Ensure directories exist and write file
      const dirPath = path.join(REPO_ROOT, `journal/entries/${year}/${monthFolder}`);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(REPO_ROOT, filePath), fullContent, "utf-8");

      return { content: [{ type: "text", text: `Journal entry created: ${filePath}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to add journal entry: ${error}` }] };
    }
  }
);

// ===== GET TODAY'S JOURNAL =====
server.tool(
  "get_todays_journal",
  "Check if a journal entry exists for today and return its content",
  {
    date: z.string().optional().describe("Date to check (YYYY-MM-DD). Defaults to today."),
  },
  async ({ date }) => {
    try {
      const targetDate = date || new Date().toISOString().split("T")[0];
      const [year, month] = targetDate.split("-").map(Number);
      const monthName = getMonthName(month);
      const monthFolder = `${month.toString().padStart(2, "0")}-${monthName}`;

      const filePath = `journal/entries/${year}/${monthFolder}/${targetDate}.md`;

      try {
        const content = await fs.readFile(path.join(REPO_ROOT, filePath), "utf-8");
        const { metadata } = parseJournalEntry(content);

        return {
          content: [{ type: "text", text: JSON.stringify({
            exists: true,
            path: filePath,
            content: content,
            metadata: metadata,
          }, null, 2) }],
        };
      } catch {
        return {
          content: [{ type: "text", text: JSON.stringify({
            exists: false,
            path: filePath,
            content: null,
            metadata: null,
          }, null, 2) }],
        };
      }
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to get journal: ${error}` }] };
    }
  }
);

// ===== LIST RECENT JOURNAL ENTRIES =====
server.tool(
  "list_recent_journal_entries",
  "Get recent journal entries for pattern recognition",
  {
    days: z.number().min(1).max(30).optional().describe("How many days back (default: 7)"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
  },
  async ({ days, tags }) => {
    try {
      const numDays = days || 7;
      const entries: Array<{
        date: string;
        mood?: string;
        energy_level?: number;
        tags?: string[];
        wins?: string[];
        struggles?: string[];
        path: string;
      }> = [];

      const today = new Date();

      for (let i = 0; i < numDays; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split("T")[0];
        const [year, month] = dateStr.split("-").map(Number);
        const monthName = getMonthName(month);
        const monthFolder = `${month.toString().padStart(2, "0")}-${monthName}`;
        const filePath = `journal/entries/${year}/${monthFolder}/${dateStr}.md`;

        try {
          const content = await fs.readFile(path.join(REPO_ROOT, filePath), "utf-8");
          const { metadata } = parseJournalEntry(content);

          if (tags && tags.length > 0) {
            const entryTags = metadata.tags as string[] | undefined;
            if (!entryTags || !tags.some(t => entryTags.includes(t))) {
              continue;
            }
          }

          entries.push({
            date: dateStr,
            mood: metadata.mood as string | undefined,
            energy_level: metadata.energy_level as number | undefined,
            tags: metadata.tags as string[] | undefined,
            wins: metadata.wins as string[] | undefined,
            struggles: metadata.struggles as string[] | undefined,
            path: filePath,
          });
        } catch {
          // Entry doesn't exist for this day
        }
      }

      const fromDate = new Date(today);
      fromDate.setDate(fromDate.getDate() - numDays + 1);

      return {
        content: [{ type: "text", text: JSON.stringify({
          entries,
          count: entries.length,
          date_range: {
            from: fromDate.toISOString().split("T")[0],
            to: today.toISOString().split("T")[0],
          },
        }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to list journal entries: ${error}` }] };
    }
  }
);

// ===== SEARCH JOURNAL =====
server.tool(
  "search_journal",
  "Search journal entries by keyword, tags, or date range",
  {
    query: z.string().optional().describe("Search term"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
    from_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    to_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
    limit: z.number().min(1).max(100).optional().describe("Max results (default: 20)"),
  },
  async ({ query, tags, from_date, to_date, limit }) => {
    try {
      const maxResults = limit || 20;
      const results: Array<{
        date: string;
        excerpt: string;
        tags?: string[];
        path: string;
        relevance_score: number;
      }> = [];

      const endDate = to_date ? new Date(to_date) : new Date();
      const startDate = from_date ? new Date(from_date) : new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);

      const currentDate = new Date(endDate);

      while (currentDate >= startDate && results.length < maxResults) {
        const dateStr = currentDate.toISOString().split("T")[0];
        const [year, month] = dateStr.split("-").map(Number);
        const monthName = getMonthName(month);
        const monthFolder = `${month.toString().padStart(2, "0")}-${monthName}`;
        const filePath = `journal/entries/${year}/${monthFolder}/${dateStr}.md`;

        try {
          const content = await fs.readFile(path.join(REPO_ROOT, filePath), "utf-8");
          const { metadata, body } = parseJournalEntry(content);

          if (tags && tags.length > 0) {
            const entryTags = metadata.tags as string[] | undefined;
            if (!entryTags || !tags.some(t => entryTags.includes(t))) {
              currentDate.setDate(currentDate.getDate() - 1);
              continue;
            }
          }

          let relevanceScore = 1;
          if (query) {
            const queryLower = query.toLowerCase();
            const contentLower = content.toLowerCase();
            if (!contentLower.includes(queryLower)) {
              currentDate.setDate(currentDate.getDate() - 1);
              continue;
            }
            const matches = contentLower.split(queryLower).length - 1;
            relevanceScore = Math.min(1, matches / 5);
          }

          let excerpt = body.substring(0, 200);
          if (query) {
            const queryIndex = body.toLowerCase().indexOf(query.toLowerCase());
            if (queryIndex >= 0) {
              const start = Math.max(0, queryIndex - 50);
              const end = Math.min(body.length, queryIndex + query.length + 100);
              excerpt = "..." + body.substring(start, end) + "...";
            }
          }

          results.push({
            date: dateStr,
            excerpt: excerpt.trim(),
            tags: metadata.tags as string[] | undefined,
            path: filePath,
            relevance_score: relevanceScore,
          });
        } catch {
          // Entry doesn't exist
        }

        currentDate.setDate(currentDate.getDate() - 1);
      }

      if (query) {
        results.sort((a, b) => b.relevance_score - a.relevance_score);
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          results,
          count: results.length,
          query: query || null,
        }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to search journal: ${error}` }] };
    }
  }
);

// ===== EXTRACT STORY IDEAS =====
server.tool(
  "extract_story_ideas",
  "Identify story-worthy moments from journal entries for LinkedIn Personal Stories",
  {
    from_date: z.string().optional().describe("Start date (YYYY-MM-DD). Default: 30 days ago"),
    to_date: z.string().optional().describe("End date (YYYY-MM-DD). Default: today"),
  },
  async ({ from_date, to_date }) => {
    try {
      const endDate = to_date ? new Date(to_date) : new Date();
      const startDate = from_date ? new Date(from_date) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const entriesData: Array<{
        date: string;
        content: string;
        metadata: Record<string, unknown>;
      }> = [];

      const currentDate = new Date(endDate);

      while (currentDate >= startDate) {
        const dateStr = currentDate.toISOString().split("T")[0];
        const [year, month] = dateStr.split("-").map(Number);
        const monthName = getMonthName(month);
        const monthFolder = `${month.toString().padStart(2, "0")}-${monthName}`;
        const filePath = `journal/entries/${year}/${monthFolder}/${dateStr}.md`;

        try {
          const content = await fs.readFile(path.join(REPO_ROOT, filePath), "utf-8");
          const { metadata, body } = parseJournalEntry(content);
          entriesData.push({ date: dateStr, content: body, metadata });
        } catch {
          // Entry doesn't exist
        }

        currentDate.setDate(currentDate.getDate() - 1);
      }

      if (entriesData.length === 0) {
        return {
          content: [{ type: "text", text: JSON.stringify({
            story_ideas: [],
            count: 0,
            message: "No journal entries found in the specified date range.",
          }, null, 2) }],
        };
      }

      const storyIdeas: Array<{
        id: string;
        theme: string;
        title: string;
        source_entries: string[];
        excerpt: string;
        suggested_tags: string[];
      }> = [];

      // Theme: Working Dad moments
      const kidsEntries = entriesData.filter(e =>
        (e.metadata.kids_moments as string[] | undefined)?.length ?? 0 > 0
      );
      if (kidsEntries.length >= 2) {
        const moments = kidsEntries.flatMap(e => e.metadata.kids_moments as string[] || []);
        storyIdeas.push({
          id: `story-${endDate.toISOString().split("T")[0]}-working-dad`,
          theme: "working-dad-reality",
          title: "Building While Parenting",
          source_entries: kidsEntries.map(e => e.date),
          excerpt: moments.slice(0, 3).join(" | "),
          suggested_tags: ["working-dad", "build-in-public", "work-life-balance"],
        });
      }

      // Theme: Struggles and lessons
      const struggleEntries = entriesData.filter(e =>
        (e.metadata.struggles as string[] | undefined)?.length ?? 0 > 0
      );
      if (struggleEntries.length >= 1) {
        const struggles = struggleEntries.flatMap(e => e.metadata.struggles as string[] || []);
        storyIdeas.push({
          id: `story-${endDate.toISOString().split("T")[0]}-lessons`,
          theme: "failures-and-lessons",
          title: "What Went Wrong (And What I Learned)",
          source_entries: struggleEntries.map(e => e.date),
          excerpt: struggles.slice(0, 3).join(" | "),
          suggested_tags: ["lessons-learned", "transparency", "growth"],
        });
      }

      // Theme: Wins and progress
      const winEntries = entriesData.filter(e =>
        (e.metadata.wins as string[] | undefined)?.length ?? 0 > 0
      );
      if (winEntries.length >= 2) {
        const wins = winEntries.flatMap(e => e.metadata.wins as string[] || []);
        storyIdeas.push({
          id: `story-${endDate.toISOString().split("T")[0]}-progress`,
          theme: "build-in-public-progress",
          title: "Small Wins Add Up",
          source_entries: winEntries.map(e => e.date),
          excerpt: wins.slice(0, 3).join(" | "),
          suggested_tags: ["build-in-public", "progress", "wins"],
        });
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          story_ideas: storyIdeas,
          count: storyIdeas.length,
          entries_analyzed: entriesData.length,
          date_range: {
            from: startDate.toISOString().split("T")[0],
            to: endDate.toISOString().split("T")[0],
          },
        }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to extract story ideas: ${error}` }] };
    }
  }
);

// ===== CLAUDE PROJECTS TOOLS =====

// Tool: Get Claude Projects
server.registerTool(
  "get_claude_projects",
  {
    title: "Get Claude Projects",
    description: "List all Claude.ai projects with their PURPOSE.md summaries. Projects are stored in .claude/claude-projects/",
    outputSchema: textContentOutputSchema,
  },
  async () => {
    try {
      const projectsDir = ".claude/claude-projects";
      const projects = await listDirectory(projectsDir);

      const projectList: Array<{
        name: string;
        path: string;
        purpose_summary: string | null;
        has_instructions: boolean;
      }> = [];

      for (const item of projects) {
        if (item.type !== "dir") continue;

        let purposeSummary: string | null = null;
        let hasInstructions = false;

        try {
          const purposeContent = await readMarkdownFile(`${projectsDir}/${item.name}/PURPOSE.md`);
          // Extract first paragraph after the title as summary
          const lines = purposeContent.split("\n").filter(l => l.trim() && !l.startsWith("#"));
          purposeSummary = lines.slice(0, 3).join(" ").substring(0, 300);
        } catch {
          // PURPOSE.md doesn't exist
        }

        try {
          await readMarkdownFile(`${projectsDir}/${item.name}/INSTRUCTIONS.xml`);
          hasInstructions = true;
        } catch {
          // INSTRUCTIONS.xml doesn't exist
        }

        projectList.push({
          name: item.name,
          path: `${projectsDir}/${item.name}`,
          purpose_summary: purposeSummary,
          has_instructions: hasInstructions,
        });
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          projects: projectList,
          count: projectList.length,
          base_path: projectsDir,
        }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to list Claude projects: ${error}` }] };
    }
  }
);

// Tool: Get Claude Project Details
server.registerTool(
  "get_claude_project",
  {
    title: "Get Claude Project",
    description: "Get details of a specific Claude.ai project including INSTRUCTIONS.xml and PURPOSE.md content",
    inputSchema: {
      name: z.string().describe("Project folder name (e.g., 'home-base', 'nexus', 'daily-check-in')"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ name }) => {
    try {
      const projectPath = `.claude/claude-projects/${name}`;

      let instructions: string | null = null;
      let purpose: string | null = null;
      const otherFiles: string[] = [];

      try {
        instructions = await readMarkdownFile(`${projectPath}/INSTRUCTIONS.xml`);
      } catch {
        // File doesn't exist
      }

      try {
        purpose = await readMarkdownFile(`${projectPath}/PURPOSE.md`);
      } catch {
        // File doesn't exist
      }

      // List other files in the project
      try {
        const files = await listDirectory(projectPath);
        for (const file of files) {
          if (file.name !== "INSTRUCTIONS.xml" && file.name !== "PURPOSE.md") {
            otherFiles.push(file.name);
          }
        }
      } catch {
        // Directory might not exist
      }

      if (!instructions && !purpose) {
        return { content: [{ type: "text", text: `Project '${name}' not found or has no content` }] };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          name,
          path: projectPath,
          instructions: instructions ? { exists: true, content: instructions } : { exists: false },
          purpose: purpose ? { exists: true, content: purpose } : { exists: false },
          other_files: otherFiles,
        }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to get Claude project: ${error}` }] };
    }
  }
);

// Tool: Create Claude Project
server.registerTool(
  "create_claude_project",
  {
    title: "Create Claude Project",
    description: "Create a new Claude.ai project folder with INSTRUCTIONS.xml and PURPOSE.md templates",
    inputSchema: {
      name: z.string().describe("Project folder name (lowercase, hyphenated, e.g., 'my-new-project')"),
      display_name: z.string().describe("Human-readable project name (e.g., 'My New Project')"),
      summary: z.string().describe("One-sentence summary of the project's purpose"),
      scope: z.array(z.string()).optional().describe("List of in-scope responsibilities"),
      out_of_scope: z.array(z.string()).optional().describe("List of out-of-scope items"),
      tone: z.string().optional().describe("Personality/tone description (e.g., 'Casual, direct, and supportive')"),
      mcp_tools: z.array(z.string()).optional().describe("MCP tools this project should use"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ name, display_name, summary, scope, out_of_scope, tone, mcp_tools }) => {
    try {
      const projectPath = `.claude/claude-projects/${name}`;
      const today = new Date().toISOString().split("T")[0];

      // Create PURPOSE.md
      const purposeContent = `# ${display_name}

## Purpose
${summary}

## Key Responsibilities
${scope?.map(s => `- ${s}`).join("\n") || "- (To be defined)"}

## MCP Tools Used
${mcp_tools?.map(t => `- \`${t}\``).join("\n") || "- (To be defined)"}

## Out of Scope
${out_of_scope?.map(s => `- ${s}`).join("\n") || "- (To be defined)"}

---
_Created: ${today}_
`;

      await writeFile(`${projectPath}/PURPOSE.md`, purposeContent);

      // Create INSTRUCTIONS.xml template
      const instructionsContent = `<?xml version="1.0" encoding="UTF-8"?>
<claude_project>
  <name>${display_name}</name>

  <summary>
    ${summary}
  </summary>

  <personality>
    <tone>
      ${tone || "Casual, direct, and helpful."}
    </tone>

    <approach>
      You're a thought partner AND executor. That means:
      - Ask clarifying questions before diving in (don't assume)
      - Present multiple options with your recommendation highlighted
      - Actually do the work, don't just talk about it
      - Be proactive - spot opportunities and mention them
    </approach>

    <honesty_policy>
      If you don't know something, say "I don't know" or "I couldn't find that."
      If you're uncertain, say so. Don't hallucinate data, metrics, or facts.
      It's always better to be honest than to bullshit.
    </honesty_policy>
  </personality>

  <myself_mcp_tools>
    <description>
      The Myself MCP contains relevant data. Here are the tools to use:
    </description>

    <tools>
${mcp_tools?.map(t => `      <tool name="${t}">Description here</tool>`).join("\n") || "      <!-- Add relevant tools -->"}
    </tools>
  </myself_mcp_tools>

  <scope>
    <in_scope>
${scope?.map(s => `      <item>${s}</item>`).join("\n") || "      <!-- Define in-scope items -->"}
    </in_scope>

    <out_of_scope>
${out_of_scope?.map(s => `      <item>${s}</item>`).join("\n") || "      <!-- Define out-of-scope items -->"}
    </out_of_scope>
  </scope>

  <key_reminders>
    <reminder>Auto-fetch relevant context at conversation start</reminder>
    <reminder>Be honest - say "I don't know" when you don't know</reminder>
    <reminder>Never use em dashes</reminder>
  </key_reminders>
</claude_project>
`;

      await writeFile(`${projectPath}/INSTRUCTIONS.xml`, instructionsContent);

      return {
        content: [{ type: "text", text: JSON.stringify({
          success: true,
          project: {
            name,
            display_name,
            path: projectPath,
            files_created: ["PURPOSE.md", "INSTRUCTIONS.xml"],
          },
          message: `Created Claude project '${display_name}' at ${projectPath}`,
        }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to create Claude project: ${error}` }] };
    }
  }
);

// Tool: Update Claude Project File
server.registerTool(
  "update_claude_project_file",
  {
    title: "Update Claude Project File",
    description: "Create or update a file in a Claude.ai project folder. Can update INSTRUCTIONS.xml, PURPOSE.md, or create new files.",
    inputSchema: {
      project: z.string().describe("Project folder name (e.g., 'home-base', 'nexus')"),
      filename: z.string().describe("File to create/update (e.g., 'PURPOSE.md', 'INSTRUCTIONS.xml', 'custom-file.md')"),
      content: z.string().describe("Full file content"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ project, filename, content }) => {
    try {
      const filePath = `.claude/claude-projects/${project}/${filename}`;
      const isUpdate = await fileExists(filePath);

      await writeFile(filePath, content);

      return {
        content: [{ type: "text", text: JSON.stringify({
          success: true,
          action: isUpdate ? "updated" : "created",
          project,
          filename,
          path: filePath,
        }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update Claude project file: ${error}` }] };
    }
  }
);

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Myself Knowledge Base MCP Server running on stdio");
}

main().catch(console.error);
