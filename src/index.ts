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

      return {
        content: [{ type: "text", text: JSON.stringify(chiefAim, null, 2) }],
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

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Myself Knowledge Base MCP Server running on stdio");
}

main().catch(console.error);
