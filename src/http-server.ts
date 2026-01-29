import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as http from "http";
import type {
  SkillsData,
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

// For Vercel/remote deployment: fetches from GitHub API instead of local files
const GITHUB_OWNER = "G-Hensley";
const GITHUB_REPO = "myself";
const GITHUB_BRANCH = "main";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // PAT for private repo access

// Log token status on startup
console.log(`GITHUB_TOKEN configured: ${GITHUB_TOKEN ? "yes (length: " + GITHUB_TOKEN.length + ")" : "no"}`);

// Helper to fetch files from GitHub API (supports private repos with PAT)
async function fetchFromGitHub(relativePath: string): Promise<string> {
  // Use GitHub Contents API for private repo support
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${relativePath}?ref=${GITHUB_BRANCH}`;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.raw+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "myself-mcp-server",
  };

  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`GitHub API error for ${relativePath}: ${response.status} - ${errorBody}`);
    throw new Error(`Failed to fetch ${relativePath}: ${response.status}`);
  }
  return response.text();
}

async function readJsonFile<T>(relativePath: string): Promise<T> {
  const content = await fetchFromGitHub(relativePath);
  return JSON.parse(content) as T;
}

async function readMarkdownFile(relativePath: string): Promise<string> {
  return fetchFromGitHub(relativePath);
}

// Helper to get file SHA (required for updates via GitHub API)
// Returns undefined if file doesn't exist (allows creating new files)
async function getFileSha(relativePath: string): Promise<string | undefined> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${relativePath}?ref=${GITHUB_BRANCH}`;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "myself-mcp-server",
  };

  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    // 404 means file doesn't exist - that's OK for creating new files
    if (response.status === 404) {
      return undefined;
    }
    throw new Error(`Failed to get SHA for ${relativePath}: ${response.status}`);
  }
  const data = await response.json() as { sha: string };
  return data.sha;
}

// Helper to write files to GitHub via Contents API
// Supports both creating new files and updating existing files
async function writeToGitHub(relativePath: string, content: string, message: string): Promise<void> {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN not configured - cannot write to repository");
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${relativePath}`;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "myself-mcp-server",
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "Content-Type": "application/json",
  };

  // Try to get current file SHA (undefined if file doesn't exist)
  const sha = await getFileSha(relativePath);

  // Base64 encode the content
  const contentBase64 = Buffer.from(content, "utf-8").toString("base64");

  // Build request body - only include SHA if updating existing file
  const requestBody: Record<string, string> = {
    message,
    content: contentBase64,
    branch: GITHUB_BRANCH,
  };

  if (sha) {
    // File exists - include SHA for update
    requestBody.sha = sha;
  }
  // If no SHA, this is a new file creation - omit SHA

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`GitHub API write error for ${relativePath}: ${response.status} - ${errorBody}`);
    throw new Error(`Failed to write ${relativePath}: ${response.status}`);
  }

  console.log(`Successfully ${sha ? "updated" : "created"} ${relativePath}`);
}

// Helper to write JSON files with proper formatting
async function writeJsonFile(relativePath: string, data: unknown, message: string): Promise<void> {
  const content = JSON.stringify(data, null, 2) + "\n";
  await writeToGitHub(relativePath, content, message);
}

// Note: We don't use outputSchema because it requires structuredContent responses.
// Our tools return plain text content which doesn't need schema validation.

// Create the MCP server
const server = new McpServer({
  name: "myself-knowledge-base",
  version: "1.0.0",
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

    // Return info about available assessments (we can't list directory via GitHub API easily)
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

// ============================================
// UPDATE/WRITE TOOLS
// ============================================

// Tool: Update Skill
server.registerTool(
  "update_skill",
  {
    title: "Update Skill",
    description: "Add a new skill or update the proficiency level of an existing skill",
    inputSchema: {
      category: z.string().describe("Skill category (e.g., 'programming_languages', 'frameworks_and_libraries', 'databases', 'cloud_and_devops', 'tools', 'AI', 'other')"),
      skill_name: z.string().describe("Name of the skill"),
      level: z.enum(["none", "novice", "apprentice", "adept", "expert", "master"]).describe("Proficiency level"),
    },
  },
  async ({ category, skill_name, level }) => {
    try {
      const skills = await readJsonFile<Record<string, Record<string, string>>>("profile/skills.json");

      // Ensure category exists
      if (!skills[category]) {
        skills[category] = {};
      }

      const previousLevel = skills[category][skill_name];
      skills[category][skill_name] = level;

      await writeJsonFile(
        "profile/skills.json",
        skills,
        `Update skill: ${skill_name} (${previousLevel || "new"} → ${level})`
      );

      return {
        content: [{ type: "text", text: `Successfully ${previousLevel ? "updated" : "added"} skill "${skill_name}" in ${category} to level "${level}"` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update skill: ${error instanceof Error ? error.message : "Unknown error"}` }],
      };
    }
  }
);

// Tool: Add Experience
server.registerTool(
  "add_experience",
  {
    title: "Add Experience",
    description: "Add a new work experience/job entry",
    inputSchema: {
      company: z.string().describe("Company name"),
      role: z.string().describe("Job title/role"),
      start_date: z.string().describe("Start date (YYYY-MM-DD format)"),
      end_date: z.string().optional().describe("End date (YYYY-MM-DD format) or 'Present' for current role"),
      location: z.string().optional().describe("Job location"),
      job_type: z.enum(["remote", "hybrid", "onsite"]).optional().describe("Type of work arrangement"),
      responsibilities: z.array(z.string()).optional().describe("List of key responsibilities"),
      technologies: z.array(z.string()).optional().describe("Technologies used in this role"),
    },
  },
  async ({ company, role, start_date, end_date, location, job_type, responsibilities, technologies }) => {
    try {
      const experience = await readJsonFile<Record<string, unknown>>("profile/experience.json");

      experience[company] = {
        role,
        start_date,
        end_date: end_date || "Present",
        ...(location && { location }),
        ...(job_type && { job_type }),
        ...(responsibilities && { responsibilities }),
        ...(technologies && { technologies }),
      };

      await writeJsonFile(
        "profile/experience.json",
        experience,
        `Add experience: ${role} at ${company}`
      );

      return {
        content: [{ type: "text", text: `Successfully added experience: ${role} at ${company}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to add experience: ${error instanceof Error ? error.message : "Unknown error"}` }],
      };
    }
  }
);

// Tool: Add Certification
server.registerTool(
  "add_certification",
  {
    title: "Add Certification",
    description: "Add a new certification or certificate to education",
    inputSchema: {
      type: z.enum(["certification", "certificate"]).describe("Type: 'certification' for professional certs, 'certificate' for course completions"),
      name: z.string().describe("Name of the certification/certificate"),
      issuer: z.string().describe("Issuing organization"),
      date: z.string().describe("Date earned (YYYY-MM-DD format)"),
      credential_id: z.string().optional().describe("Credential ID if applicable"),
      url: z.string().optional().describe("Verification URL"),
    },
  },
  async ({ type, name, issuer, date, credential_id, url }) => {
    try {
      const education = await readJsonFile<Record<string, unknown>>("profile/education.json");

      const arrayKey = type === "certification" ? "certifications" : "certificates";
      if (!education[arrayKey]) {
        education[arrayKey] = [];
      }

      const entry: Record<string, string> = { name, issuer, date };
      if (credential_id) entry.credential_id = credential_id;
      if (url) entry.url = url;

      (education[arrayKey] as Array<Record<string, string>>).push(entry);

      await writeJsonFile(
        "profile/education.json",
        education,
        `Add ${type}: ${name} from ${issuer}`
      );

      return {
        content: [{ type: "text", text: `Successfully added ${type}: ${name} from ${issuer}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to add certification: ${error instanceof Error ? error.message : "Unknown error"}` }],
      };
    }
  }
);

// Tool: Update Project Status
server.registerTool(
  "update_project_status",
  {
    title: "Update Project Status",
    description: "Update a project's status, completion percentage, or move between active/planned/completed",
    inputSchema: {
      project_id: z.string().describe("Project identifier (slug/key from the JSON)"),
      current_status: z.enum(["active", "planned", "completed"]).describe("Current status file where the project is"),
      new_status: z.enum(["active", "planned", "completed"]).optional().describe("Move project to a different status file"),
      completion: z.number().min(0).max(100).optional().describe("Update completion percentage (0-100)"),
      priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Update project priority"),
    },
  },
  async ({ project_id, current_status, new_status, completion, priority }) => {
    try {
      const currentFile = `projects/${current_status}.json`;
      const projects = await readJsonFile<Record<string, Record<string, unknown>>>(currentFile);

      if (!projects[project_id]) {
        return {
          content: [{ type: "text", text: `Project "${project_id}" not found in ${current_status}.json` }],
        };
      }

      const project = projects[project_id];

      // Update fields
      if (completion !== undefined) {
        project.completion_percentage = completion;
      }
      if (priority) {
        project.priority = priority;
      }

      // Move to different status file if requested
      if (new_status && new_status !== current_status) {
        // Remove from current file
        delete projects[project_id];
        await writeJsonFile(currentFile, projects, `Remove project ${project_id} (moving to ${new_status})`);

        // Add to new file
        const newFile = `projects/${new_status}.json`;
        const newProjects = await readJsonFile<Record<string, Record<string, unknown>>>(newFile);
        project.status = new_status;
        newProjects[project_id] = project;
        await writeJsonFile(newFile, newProjects, `Add project ${project_id} (moved from ${current_status})`);

        return {
          content: [{ type: "text", text: `Successfully moved project "${project_id}" from ${current_status} to ${new_status}` }],
        };
      } else {
        // Just update in place
        projects[project_id] = project;
        await writeJsonFile(currentFile, projects, `Update project ${project_id}: completion=${completion}, priority=${priority}`);

        return {
          content: [{ type: "text", text: `Successfully updated project "${project_id}"` }],
        };
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update project: ${error instanceof Error ? error.message : "Unknown error"}` }],
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
      id: z.string().describe("Project identifier (slug, e.g., 'my-new-project')"),
      name: z.string().describe("Project name"),
      description: z.string().describe("Project description"),
      type: z.enum(["saas", "open-source", "template", "tool", "library", "website"]).describe("Project type"),
      technologies: z.array(z.string()).describe("Technologies to be used"),
      problem: z.string().describe("Problem the project solves"),
      solution: z.string().describe("How the project solves the problem"),
      target_audience: z.array(z.string()).describe("Target audience"),
      priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Project priority"),
    },
  },
  async ({ id, name, description, type, technologies, problem, solution, target_audience, priority }) => {
    try {
      const projects = await readJsonFile<Record<string, Record<string, unknown>>>("projects/planned.json");

      if (projects[id]) {
        return {
          content: [{ type: "text", text: `Project "${id}" already exists in planned.json` }],
        };
      }

      projects[id] = {
        name,
        description,
        type,
        technologies,
        problem,
        solution,
        target_audience,
        status: "planned",
        completion_percentage: 0,
        priority: priority || "medium",
        date_added: new Date().toISOString().split("T")[0],
      };

      await writeJsonFile("projects/planned.json", projects, `Add planned project: ${name}`);

      return {
        content: [{ type: "text", text: `Successfully added project "${name}" to planned projects` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to add project: ${error instanceof Error ? error.message : "Unknown error"}` }],
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
      source: z.string().optional().describe("Where you found the job (LinkedIn, HN, etc.)"),
      salary_range: z.string().optional().describe("Salary range if known"),
      location: z.string().optional().describe("Job location"),
      status: z.enum(["applied", "screening", "interviewing", "offer", "rejected", "withdrawn", "ghosted"]).optional().describe("Application status"),
      notes: z.string().optional().describe("Additional notes"),
    },
  },
  async ({ company, role, url, source, salary_range, location, status, notes }) => {
    try {
      const data = await readJsonFile<{ applications: Array<Record<string, unknown>> }>("job-applications/applications.json");

      if (!data.applications) {
        data.applications = [];
      }

      // Generate ID
      const id = `app-${Date.now()}`;
      const date_applied = new Date().toISOString().split("T")[0];

      const application: Record<string, unknown> = {
        id,
        company,
        role,
        date_applied,
        status: status || "applied",
        last_updated: date_applied,
      };

      if (url) application.url = url;
      if (source) application.source = source;
      if (salary_range) application.salary_range = salary_range;
      if (location) application.location = location;
      if (notes) application.notes = notes;

      data.applications.push(application);

      await writeJsonFile(
        "job-applications/applications.json",
        data,
        `Log job application: ${role} at ${company}`
      );

      return {
        content: [{ type: "text", text: `Successfully logged application for ${role} at ${company} (ID: ${id})` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to log application: ${error instanceof Error ? error.message : "Unknown error"}` }],
      };
    }
  }
);

// Tool: Log Interview
server.registerTool(
  "log_interview",
  {
    title: "Log Interview",
    description: "Log an interview for a job application",
    inputSchema: {
      company: z.string().describe("Company name"),
      role: z.string().describe("Job title/role"),
      round: z.number().describe("Interview round number"),
      type: z.enum(["phone", "video", "onsite", "technical", "behavioral", "panel"]).describe("Interview type"),
      date: z.string().describe("Interview date (YYYY-MM-DD)"),
      interviewer: z.string().optional().describe("Interviewer name"),
      interviewer_role: z.string().optional().describe("Interviewer's role/title"),
      prep_notes: z.string().optional().describe("Preparation notes"),
      outcome: z.enum(["passed", "rejected", "pending", "unknown"]).optional().describe("Interview outcome"),
      notes: z.string().optional().describe("Post-interview notes"),
    },
  },
  async ({ company, role, round, type, date, interviewer, interviewer_role, prep_notes, outcome, notes }) => {
    try {
      const data = await readJsonFile<{ interviews: Array<Record<string, unknown>> }>("job-applications/interviews.json");

      if (!data.interviews) {
        data.interviews = [];
      }

      const id = `int-${Date.now()}`;

      const interview: Record<string, unknown> = {
        id,
        company,
        role,
        round,
        type,
        date,
        outcome: outcome || "pending",
      };

      if (interviewer) interview.interviewer = interviewer;
      if (interviewer_role) interview.interviewer_role = interviewer_role;
      if (prep_notes) interview.prep_notes = prep_notes;
      if (notes) interview.notes = notes;

      data.interviews.push(interview);

      await writeJsonFile(
        "job-applications/interviews.json",
        data,
        `Log interview: Round ${round} at ${company}`
      );

      return {
        content: [{ type: "text", text: `Successfully logged Round ${round} ${type} interview at ${company} (ID: ${id})` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to log interview: ${error instanceof Error ? error.message : "Unknown error"}` }],
      };
    }
  }
);

// Tool: Update Financials
server.registerTool(
  "update_financials",
  {
    title: "Update Financials",
    description: "Update financial data for Codaissance or TamperTantrum Labs",
    inputSchema: {
      business: z.enum(["codaissance", "tampertantrum-labs"]).describe("Which business to update"),
      mrr: z.number().optional().describe("Update Monthly Recurring Revenue"),
      customers: z.number().optional().describe("Update customer count"),
      expense_name: z.string().optional().describe("Name of expense to add"),
      expense_amount: z.number().optional().describe("Amount of expense to add"),
      expense_type: z.enum(["monthly_recurring", "one_time"]).optional().describe("Type of expense"),
    },
  },
  async ({ business, mrr, customers, expense_name, expense_amount, expense_type }) => {
    try {
      const financials = await readJsonFile<Record<string, unknown>>(`business/${business}/financials.json`);

      const updates: string[] = [];

      if (mrr !== undefined) {
        (financials.revenue as Record<string, unknown>).mrr = mrr;
        (financials.revenue as Record<string, unknown>).arr = mrr * 12;
        updates.push(`MRR: $${mrr}`);
      }

      if (customers !== undefined) {
        (financials.metrics as Record<string, unknown>).customers = customers;
        updates.push(`Customers: ${customers}`);
      }

      if (expense_name && expense_amount !== undefined && expense_type) {
        const expenses = financials.expenses as Record<string, unknown[]>;
        if (!expenses[expense_type]) {
          expenses[expense_type] = [];
        }
        expenses[expense_type].push({
          name: expense_name,
          amount: expense_amount,
          date: new Date().toISOString().split("T")[0],
        });
        updates.push(`Expense: ${expense_name} ($${expense_amount})`);
      }

      await writeJsonFile(
        `business/${business}/financials.json`,
        financials,
        `Update ${business} financials: ${updates.join(", ")}`
      );

      return {
        content: [{ type: "text", text: `Successfully updated ${business} financials: ${updates.join(", ")}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update financials: ${error instanceof Error ? error.message : "Unknown error"}` }],
      };
    }
  }
);

// Tool: Update LinkedIn Metrics
server.registerTool(
  "update_linkedin_metrics",
  {
    title: "Update LinkedIn Metrics",
    description: "Update LinkedIn metrics for personal or company pages",
    inputSchema: {
      account: z.enum(["personal", "codaissance", "tampertantrum"]).describe("Which account to update"),
      connections: z.number().optional().describe("Update connection/follower count"),
      profile_views: z.number().optional().describe("Update profile views"),
      post_impressions: z.number().optional().describe("Update post impressions"),
      search_appearances: z.number().optional().describe("Update search appearances"),
    },
  },
  async ({ account, connections, profile_views, post_impressions, search_appearances }) => {
    try {
      const filePath = `linkedin/${account}-metrics.json`;
      const metrics = await readJsonFile<Record<string, unknown>>(filePath);

      const updates: string[] = [];
      const today = new Date().toISOString().split("T")[0];

      if (connections !== undefined) {
        metrics.connections = connections;
        metrics.followers = connections;
        updates.push(`connections: ${connections}`);
      }

      if (profile_views !== undefined) {
        metrics.profile_views = profile_views;
        updates.push(`profile_views: ${profile_views}`);
      }

      if (post_impressions !== undefined) {
        metrics.post_impressions = post_impressions;
        updates.push(`post_impressions: ${post_impressions}`);
      }

      if (search_appearances !== undefined) {
        metrics.search_appearances = search_appearances;
        updates.push(`search_appearances: ${search_appearances}`);
      }

      metrics.last_updated = today;

      await writeJsonFile(filePath, metrics, `Update ${account} LinkedIn metrics: ${updates.join(", ")}`);

      return {
        content: [{ type: "text", text: `Successfully updated ${account} LinkedIn metrics: ${updates.join(", ")}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update LinkedIn metrics: ${error instanceof Error ? error.message : "Unknown error"}` }],
      };
    }
  }
);

// Tool: Add Idea
server.registerTool(
  "add_idea",
  {
    title: "Add Idea",
    description: "Add a new idea to personal or business idea banks",
    inputSchema: {
      source: z.enum(["personal", "codaissance", "tampertantrum-labs"]).describe("Which idea bank to add to"),
      name: z.string().describe("Idea name/title"),
      description: z.string().describe("Idea description"),
      problem: z.string().describe("Problem it solves"),
      solution: z.string().describe("Proposed solution"),
      target_audience: z.string().optional().describe("Target audience"),
      effort: z.enum(["low", "medium", "high"]).optional().describe("Estimated effort level"),
      potential_value: z.enum(["low", "medium", "high"]).optional().describe("Potential value/impact"),
    },
  },
  async ({ source, name, description, problem, solution, target_audience, effort, potential_value }) => {
    try {
      const filePath = source === "personal"
        ? "ideas/personal/ideas.json"
        : `ideas/business/${source}/ideas.json`;

      const data = await readJsonFile<{ ideas: Array<Record<string, unknown>> }>(filePath);

      if (!data.ideas) {
        data.ideas = [];
      }

      const today = new Date().toISOString().split("T")[0];

      data.ideas.push({
        name,
        description,
        problem,
        solution,
        target_audience: target_audience || "",
        effort: effort || "medium",
        potential_value: potential_value || "medium",
        status: "raw",
        date_added: today,
        date_updated: today,
      });

      await writeJsonFile(filePath, data, `Add idea: ${name}`);

      return {
        content: [{ type: "text", text: `Successfully added idea "${name}" to ${source} ideas` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to add idea: ${error instanceof Error ? error.message : "Unknown error"}` }],
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
      milestone_id: z.string().describe("Milestone ID (e.g., 'm1', 'm2', etc.)"),
      status: z.enum(["in_progress", "not_started", "completed"]).optional().describe("Update milestone status"),
      completion: z.number().min(0).max(100).optional().describe("Update completion percentage"),
    },
  },
  async ({ milestone_id, status, completion }) => {
    try {
      const roadmap = await readJsonFile<{ career_roadmap: { milestones: Array<Record<string, unknown>>; last_updated: string } }>("career/roadmap.json");

      const milestone = roadmap.career_roadmap.milestones.find(m => m.id === milestone_id);

      if (!milestone) {
        return {
          content: [{ type: "text", text: `Milestone "${milestone_id}" not found` }],
        };
      }

      const updates: string[] = [];

      if (status) {
        milestone.status = status;
        updates.push(`status: ${status}`);
      }

      if (completion !== undefined) {
        milestone.completion = completion;
        updates.push(`completion: ${completion}%`);
      }

      roadmap.career_roadmap.last_updated = new Date().toISOString().split("T")[0];

      await writeJsonFile("career/roadmap.json", roadmap, `Update milestone ${milestone_id}: ${updates.join(", ")}`);

      return {
        content: [{ type: "text", text: `Successfully updated milestone "${milestone_id}" (${milestone.title}): ${updates.join(", ")}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update milestone: ${error instanceof Error ? error.message : "Unknown error"}` }],
      };
    }
  }
);

// Tool: Update Learning Progress
server.registerTool(
  "update_learning_progress",
  {
    title: "Update Learning Progress",
    description: "Add or move items in the learning roadmap queue",
    inputSchema: {
      action: z.enum(["add", "move", "complete"]).describe("Action: add new item, move between queues, or mark complete"),
      skill: z.string().describe("Skill name"),
      from_queue: z.enum(["current_focus", "queue", "backlog", "on_hold"]).optional().describe("Source queue (for move action)"),
      to_queue: z.enum(["current_focus", "queue", "backlog", "on_hold"]).optional().describe("Destination queue (for add/move action)"),
      category: z.string().optional().describe("Skill category (for add action)"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Priority (for add action)"),
      why: z.string().optional().describe("Why learning this skill (for add action)"),
    },
  },
  async ({ action, skill, from_queue, to_queue, category, priority, why }) => {
    try {
      const roadmap = await readJsonFile<Record<string, Array<Record<string, unknown>>>>("learning/roadmap.json");

      if (action === "add" && to_queue) {
        if (!roadmap[to_queue]) {
          roadmap[to_queue] = [];
        }

        roadmap[to_queue].push({
          skill,
          category: category || "other",
          priority: priority || "medium",
          why: why || "",
          date_added: new Date().toISOString().split("T")[0],
        });

        await writeJsonFile("learning/roadmap.json", roadmap, `Add to learning ${to_queue}: ${skill}`);

        return {
          content: [{ type: "text", text: `Successfully added "${skill}" to ${to_queue}` }],
        };
      }

      if (action === "move" && from_queue && to_queue) {
        const fromArray = roadmap[from_queue] || [];
        const index = fromArray.findIndex(item => item.skill === skill);

        if (index === -1) {
          return {
            content: [{ type: "text", text: `Skill "${skill}" not found in ${from_queue}` }],
          };
        }

        const [item] = fromArray.splice(index, 1);
        if (!roadmap[to_queue]) {
          roadmap[to_queue] = [];
        }
        roadmap[to_queue].push(item);

        await writeJsonFile("learning/roadmap.json", roadmap, `Move learning item: ${skill} from ${from_queue} to ${to_queue}`);

        return {
          content: [{ type: "text", text: `Successfully moved "${skill}" from ${from_queue} to ${to_queue}` }],
        };
      }

      if (action === "complete" && from_queue) {
        const fromArray = roadmap[from_queue] || [];
        const index = fromArray.findIndex(item => item.skill === skill);

        if (index === -1) {
          return {
            content: [{ type: "text", text: `Skill "${skill}" not found in ${from_queue}` }],
          };
        }

        const [item] = fromArray.splice(index, 1);

        // Add to completed.json
        const completed = await readJsonFile<{ entries: Array<Record<string, unknown>> }>("learning/completed.json");
        if (!completed.entries) {
          completed.entries = [];
        }
        completed.entries.push({
          ...item,
          date_completed: new Date().toISOString().split("T")[0],
        });

        await writeJsonFile("learning/roadmap.json", roadmap, `Complete learning item: ${skill}`);
        await writeJsonFile("learning/completed.json", completed, `Add completed learning: ${skill}`);

        return {
          content: [{ type: "text", text: `Successfully marked "${skill}" as completed` }],
        };
      }

      return {
        content: [{ type: "text", text: "Invalid action or missing parameters" }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to update learning progress: ${error instanceof Error ? error.message : "Unknown error"}` }],
      };
    }
  }
);

// ===== UPDATE LINKEDIN PROFILE =====
server.registerTool(
  "update_linkedin_profile",
  {
    title: "Update LinkedIn Profile",
    description: "Update LinkedIn profile data (personal, codaissance, or tampertantrum_labs account)",
    inputSchema: {
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
        if (tagline !== undefined) { accountData.tagline = tagline; updates.push("tagline"); }
        if (description !== undefined) { accountData.description = description; updates.push("description"); }
        if (engagement_rate !== undefined) { accountData.engagement_rate = engagement_rate; updates.push("engagement_rate"); }
      }

      if (followers !== undefined) { accountData.followers = followers; updates.push("followers"); }
      if (post_impressions_last_7_days !== undefined) { accountData.post_impressions_last_7_days = post_impressions_last_7_days; updates.push("post_impressions"); }

      accountData.last_updated = new Date().toISOString().split("T")[0];

      await writeJsonFile("linkedin/profile.json", profile, `Update LinkedIn ${account}: ${updates.join(", ")}`);

      return {
        content: [{ type: "text", text: `Updated LinkedIn ${account} profile: ${updates.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update LinkedIn profile: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== SCAFFOLD PROJECT =====
server.registerTool(
  "scaffold_project",
  {
    title: "Scaffold Project",
    description: "Create folder structure for a new project in projects/specs/{project_key}/ with README.md template",
    inputSchema: {
      project_key: z.string().describe("Project key/identifier (lowercase, hyphenated)"),
      project_name: z.string().describe("Human-readable project name"),
      project_type: z.string().describe("Project type (e.g., 'SaaS Web Application', 'CLI Tool')"),
      tagline: z.string().optional().describe("One-sentence tagline"),
      include_style_guide: z.boolean().optional().default(false).describe("Include style-guide.md"),
      include_architecture: z.boolean().optional().default(false).describe("Include architecture.md"),
    },
  },
  async ({ project_key, project_name, project_type, tagline, include_style_guide, include_architecture }) => {
    try {
      const createdFiles: string[] = [];
      const today = new Date().toISOString().split("T")[0];

      // Create README.md
      const readmeContent = `# ${project_name}

## Project Identity

**Name**: ${project_name}
**Type**: ${project_type}
**Tagline**: ${tagline || "<!-- One sentence that captures the value -->"}

---

## The Problem

**Problem Statement**:
<!-- What specific pain exists? Who feels it? -->

**Current Solutions**:
<!-- What do people do today? Why is it inadequate? -->

---

## The Solution

**Solution Statement**:
<!-- How does this project solve the problem? -->

**What This Is NOT**:
<!-- Explicitly state what's out of scope. -->

---

## MVP Spec

**MVP Goal**:
<!-- What does the MVP prove? -->

**MVP Features** (3-5 max):
1.
2.
3.

**MVP Technologies**:
-

---

## Success Criteria

**Success Milestone**:
<!-- Specific, measurable outcome. -->

---

_Created: ${today}_
`;

      await writeToGitHub(`projects/specs/${project_key}/README.md`, readmeContent, `Scaffold project: ${project_name}`);
      createdFiles.push("README.md");

      if (include_style_guide) {
        const styleGuideContent = `# ${project_name} - Style Guide

## Brand Colors
**Primary**:
**Secondary**:

## Typography
**Headings**:
**Body**:

---
_Created: ${today}_
`;
        await writeToGitHub(`projects/specs/${project_key}/style-guide.md`, styleGuideContent, `Add style guide: ${project_name}`);
        createdFiles.push("style-guide.md");
      }

      if (include_architecture) {
        const architectureContent = `# ${project_name} - Architecture

## System Overview
<!-- High-level architecture -->

## Components
### Frontend
### Backend
### Database

---
_Created: ${today}_
`;
        await writeToGitHub(`projects/specs/${project_key}/architecture.md`, architectureContent, `Add architecture doc: ${project_name}`);
        createdFiles.push("architecture.md");
      }

      return {
        content: [{ type: "text", text: `Created project scaffold at projects/specs/${project_key}/\nFiles: ${createdFiles.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to scaffold project: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== UPDATE GOAL PROGRESS =====
server.registerTool(
  "update_goal_progress",
  {
    title: "Update Goal Progress",
    description: "Update progress on a 2026 goal by ID",
    inputSchema: {
      goal_id: z.string().describe("Goal ID (e.g., 'saas-launch', 'income-300k')"),
      status: z.enum(["not_started", "in_progress", "completed", "blocked"]).optional().describe("Goal status"),
      current_metric: z.string().optional().describe("Current metric value"),
      notes: z.string().optional().describe("Progress notes"),
    },
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
      await writeJsonFile("profile/goals/2026-goals.json", goals, `Update goal progress: ${goal_id}`);

      const updates = [];
      if (status) updates.push(`status: ${status}`);
      if (current_metric) updates.push(`current: ${current_metric}`);
      if (notes) updates.push("notes updated");

      return {
        content: [{ type: "text", text: `Updated goal '${goalName}': ${updates.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update goal progress: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== ADD MASTERMIND MEMBER =====
server.registerTool(
  "add_mastermind_member",
  {
    title: "Add Mastermind Member",
    description: "Add a member to the mastermind alliance",
    inputSchema: {
      name: z.string().describe("Member name"),
      description: z.string().describe("Member description including role and what they provide"),
      list: z.enum(["current", "needed"]).default("current").describe("Add to current_members or needed_members"),
    },
  },
  async ({ name, description, list }) => {
    try {
      const chiefAim = await readJsonFile<{
        napoleon_hill_principles: {
          master_mind_alliance: {
            current_members: string[];
            needed_members: string[];
          };
        };
      }>("career/chief-aim.json");

      const mastermind = chiefAim.napoleon_hill_principles.master_mind_alliance;
      const memberEntry = `${name} - ${description}`;

      if (list === "current") {
        mastermind.current_members.push(memberEntry);
      } else {
        mastermind.needed_members.push(memberEntry);
      }

      await writeJsonFile("career/chief-aim.json", chiefAim, `Add mastermind member: ${name}`);

      return {
        content: [{ type: "text", text: `Added '${name}' to mastermind ${list}_members list` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to add mastermind member: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== LOG WEEKLY ACTION =====
server.registerTool(
  "log_weekly_action",
  {
    title: "Log Weekly Action",
    description: "Log a weekly action item for tracking consistent effort",
    inputSchema: {
      action: z.string().describe("Description of the action taken"),
      category: z.enum(["business", "learning", "networking", "health", "family", "career"]).describe("Action category"),
      principle: z.string().optional().describe("Napoleon Hill principle this relates to"),
      impact: z.string().optional().describe("Impact or result of the action"),
    },
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
        weeklyActions = { weeks: [] };
      }

      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const weekStartStr = weekStart.toISOString().split("T")[0];

      let currentWeek = weeklyActions.weeks.find(w => w.week_start === weekStartStr);
      if (!currentWeek) {
        currentWeek = { week_start: weekStartStr, actions: [] };
        weeklyActions.weeks.unshift(currentWeek);
      }

      currentWeek.actions.push({
        date: today.toISOString().split("T")[0],
        action,
        category,
        principle: principle || undefined,
        impact: impact || undefined,
      });

      await writeJsonFile("career/weekly-actions.json", weeklyActions, `Log weekly action: ${category}`);

      return {
        content: [{ type: "text", text: `Logged weekly action: "${action}" (${category})` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to log weekly action: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== UPDATE CHIEF AIM =====
server.registerTool(
  "update_chief_aim",
  {
    title: "Update Chief Aim",
    description: "Update Napoleon Hill principle content or career vision",
    inputSchema: {
      section: z.enum(["definiteness_of_purpose", "applied_faith", "going_extra_mile", "career_vision_questions"]).describe("Section to update"),
      field: z.string().describe("Field name to update"),
      value: z.union([z.string(), z.array(z.string())]).describe("New value (string or array)"),
    },
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

      await writeJsonFile("career/chief-aim.json", chiefAim, `Update chief aim: ${section}.${field}`);

      return {
        content: [{ type: "text", text: `Updated chief-aim.json: ${section}.${field}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update chief aim: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== UPDATE APPLICATION STATUS =====
server.registerTool(
  "update_application_status",
  {
    title: "Update Application Status",
    description: "Update the status of an existing job application",
    inputSchema: {
      company: z.string().describe("Company name to find the application"),
      status: z.enum(["applied", "screening", "interviewing", "offer", "rejected", "withdrawn", "ghosted"]).describe("New status"),
      notes: z.string().optional().describe("Additional notes"),
      follow_up_date: z.string().optional().describe("Next follow-up date (YYYY-MM-DD)"),
      outcome: z.string().optional().describe("Final outcome"),
    },
  },
  async ({ company, status, notes, follow_up_date, outcome }) => {
    try {
      const applications = await readJsonFile<{
        applications: Array<{
          company: string;
          role: string;
          status: string;
          notes: string;
          follow_up_date: string | null;
          outcome: string | null;
          last_updated: string;
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

      await writeJsonFile("job-applications/applications.json", applications, `Update application: ${app.company} -> ${status}`);

      return {
        content: [{ type: "text", text: `Updated ${app.company} (${app.role}): ${previousStatus} → ${status}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update application status: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== UPDATE PROJECT (FULL) =====
server.registerTool(
  "update_project",
  {
    title: "Update Project",
    description: "Update any field of an existing project (name, description, technologies, problem, solution, target_audience, mission_statement, tagline, due_date, repo_url, monetization_strategy, blocked_by, etc.)",
    inputSchema: {
      project_id: z.string().describe("Project identifier (slug/key from the JSON)"),
      status_file: z.enum(["active", "planned", "completed"]).describe("Which status file the project is in"),
      name: z.string().optional().describe("Update project name"),
      description: z.string().optional().describe("Update project description"),
      type: z.string().optional().describe("Update project type"),
      technologies: z.array(z.string()).optional().describe("Update technologies array"),
      problem: z.string().optional().describe("Update problem statement"),
      solution: z.string().optional().describe("Update solution statement"),
      target_audience: z.array(z.string()).optional().describe("Update target audience array"),
      mission_statement: z.string().optional().describe("Update mission statement"),
      tagline: z.string().optional().describe("Update tagline"),
      due_date: z.string().optional().describe("Update due date (YYYY-MM-DD)"),
      repo_url: z.string().optional().describe("Update repository URL"),
      monetization_strategy: z.string().optional().describe("Update monetization strategy"),
      blocked_by: z.string().optional().describe("Update blocked_by dependency"),
      success_milestone: z.string().optional().describe("Update success milestone"),
      priority: z.number().optional().describe("Update priority (1-10)"),
      completion_percentage: z.number().min(0).max(100).optional().describe("Update completion percentage"),
      spec_folder: z.string().optional().describe("Update spec folder path"),
      stale: z.boolean().optional().describe("Mark project as stale"),
      paused_at: z.string().optional().describe("Set paused date (YYYY-MM-DD)"),
      private: z.boolean().optional().describe("Mark project as private"),
    },
  },
  async ({ project_id, status_file, ...updates }) => {
    try {
      const filePath = `projects/${status_file}.json`;
      const projects = await readJsonFile<Record<string, Record<string, unknown>>>(filePath);

      if (!projects[project_id]) {
        return { content: [{ type: "text", text: `Project "${project_id}" not found in ${status_file}.json` }] };
      }

      const project = projects[project_id];
      const updatedFields: string[] = [];

      // Apply all provided updates
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          project[key] = value;
          updatedFields.push(key);
        }
      }

      if (updatedFields.length === 0) {
        return { content: [{ type: "text", text: "No updates provided" }] };
      }

      projects[project_id] = project;
      await writeJsonFile(filePath, projects, `Update project ${project_id}: ${updatedFields.join(", ")}`);

      return {
        content: [{ type: "text", text: `Updated "${project_id}": ${updatedFields.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update project: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== UPDATE IDEA =====
server.registerTool(
  "update_idea",
  {
    title: "Update Idea",
    description: "Update an existing idea's status, validation notes, effort, potential value, or other fields",
    inputSchema: {
      source: z.enum(["personal", "codaissance", "tampertantrum-labs"]).describe("Which idea bank"),
      idea_name: z.string().describe("Name of the idea to update"),
      status: z.enum(["raw", "validating", "validated", "rejected", "moved_to_projects"]).optional().describe("Update idea status"),
      description: z.string().optional().describe("Update description"),
      problem: z.string().optional().describe("Update problem statement"),
      solution: z.string().optional().describe("Update solution statement"),
      target_audience: z.string().optional().describe("Update target audience"),
      effort: z.enum(["low", "medium", "high"]).optional().describe("Update effort estimate"),
      potential_value: z.enum(["low", "medium", "high"]).optional().describe("Update potential value"),
      validation_notes: z.string().optional().describe("Add validation notes"),
      rejection_reason: z.string().optional().describe("Add rejection reason if rejected"),
    },
  },
  async ({ source, idea_name, status, description, problem, solution, target_audience, effort, potential_value, validation_notes, rejection_reason }) => {
    try {
      const filePath = source === "personal"
        ? "ideas/personal/ideas.json"
        : `ideas/business/${source}/ideas.json`;

      const data = await readJsonFile<{ ideas: Array<Record<string, unknown>> }>(filePath);

      if (!data.ideas) {
        return { content: [{ type: "text", text: "No ideas found in file" }] };
      }

      const idea = data.ideas.find(i =>
        (i.name as string)?.toLowerCase() === idea_name.toLowerCase()
      );

      if (!idea) {
        return { content: [{ type: "text", text: `Idea "${idea_name}" not found in ${source} ideas` }] };
      }

      const updates: string[] = [];
      const today = new Date().toISOString().split("T")[0];

      if (status) { idea.status = status; updates.push(`status: ${status}`); }
      if (description) { idea.description = description; updates.push("description"); }
      if (problem) { idea.problem = problem; updates.push("problem"); }
      if (solution) { idea.solution = solution; updates.push("solution"); }
      if (target_audience) { idea.target_audience = target_audience; updates.push("target_audience"); }
      if (effort) { idea.effort = effort; updates.push(`effort: ${effort}`); }
      if (potential_value) { idea.potential_value = potential_value; updates.push(`potential_value: ${potential_value}`); }
      if (validation_notes) { idea.validation_notes = validation_notes; updates.push("validation_notes"); }
      if (rejection_reason) { idea.rejection_reason = rejection_reason; updates.push("rejection_reason"); }

      idea.date_updated = today;

      await writeJsonFile(filePath, data, `Update idea: ${idea_name}`);

      return {
        content: [{ type: "text", text: `Updated idea "${idea_name}": ${updates.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update idea: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== UPDATE GOAL (FULL) =====
server.registerTool(
  "update_goal",
  {
    title: "Update Goal",
    description: "Update any field of an existing goal (status, metrics, target_date, quarterly objectives, notes, etc.)",
    inputSchema: {
      goal_id: z.string().describe("Goal ID (e.g., 'saas-launch', 'income-300k')"),
      status: z.enum(["not_started", "in_progress", "completed", "blocked"]).optional().describe("Update goal status"),
      goal_text: z.string().optional().describe("Update goal description text"),
      target_date: z.string().optional().describe("Update target date (YYYY-MM-DD)"),
      target_metric: z.string().optional().describe("Update target metric value"),
      current_metric: z.string().optional().describe("Update current metric value"),
      notes: z.string().optional().describe("Update notes"),
      quarterly_objectives: z.array(z.string()).optional().describe("Update quarterly objectives array"),
    },
  },
  async ({ goal_id, status, goal_text, target_date, target_metric, current_metric, notes, quarterly_objectives }) => {
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
            quarterly_objectives?: string[];
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
            if (goal_text) goal.goal = goal_text;
            if (target_date) goal.target_date = target_date;
            if (target_metric) goal.metrics.target = target_metric;
            if (current_metric) goal.metrics.current = current_metric;
            if (notes) goal.notes = notes;
            if (quarterly_objectives) goal.quarterly_objectives = quarterly_objectives;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        return { content: [{ type: "text", text: `Goal with ID '${goal_id}' not found` }] };
      }

      goals.last_updated = new Date().toISOString().split("T")[0];
      await writeJsonFile("profile/goals/2026-goals.json", goals, `Update goal: ${goal_id}`);

      const updates = [];
      if (status) updates.push(`status: ${status}`);
      if (goal_text) updates.push("goal text");
      if (target_date) updates.push(`target_date: ${target_date}`);
      if (target_metric) updates.push(`target: ${target_metric}`);
      if (current_metric) updates.push(`current: ${current_metric}`);
      if (notes) updates.push("notes");
      if (quarterly_objectives) updates.push("quarterly_objectives");

      return {
        content: [{ type: "text", text: `Updated goal '${goalName}': ${updates.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update goal: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== UPDATE EXPERIENCE =====
server.registerTool(
  "update_experience",
  {
    title: "Update Experience",
    description: "Update an existing work experience entry (end_date, responsibilities, technologies, salary, performance metrics, etc.)",
    inputSchema: {
      company: z.string().describe("Company name to find and update"),
      role: z.string().optional().describe("Update role/title"),
      end_date: z.string().optional().describe("Update end date (YYYY-MM-DD or 'Present')"),
      location: z.string().optional().describe("Update location"),
      job_type: z.enum(["remote", "hybrid", "onsite"]).optional().describe("Update job type"),
      responsibilities: z.array(z.string()).optional().describe("Update responsibilities array"),
      technologies: z.array(z.string()).optional().describe("Update technologies array"),
      salary: z.string().optional().describe("Update salary"),
      performance_metrics: z.array(z.string()).optional().describe("Update performance metrics"),
      notes: z.string().optional().describe("Update notes"),
    },
  },
  async ({ company, role, end_date, location, job_type, responsibilities, technologies, salary, performance_metrics, notes }) => {
    try {
      const experience = await readJsonFile<Record<string, Record<string, unknown>>>("profile/experience.json");

      // Find company (case-insensitive partial match)
      const companyKey = Object.keys(experience).find(
        key => key.toLowerCase().includes(company.toLowerCase())
      );

      if (!companyKey) {
        return { content: [{ type: "text", text: `Experience at "${company}" not found` }] };
      }

      const exp = experience[companyKey];
      const updates: string[] = [];

      if (role) { exp.role = role; updates.push(`role: ${role}`); }
      if (end_date) { exp.end_date = end_date; updates.push(`end_date: ${end_date}`); }
      if (location) { exp.location = location; updates.push("location"); }
      if (job_type) { exp.job_type = job_type; updates.push(`job_type: ${job_type}`); }
      if (responsibilities) { exp.responsibilities = responsibilities; updates.push("responsibilities"); }
      if (technologies) { exp.technologies = technologies; updates.push("technologies"); }
      if (salary) { exp.salary = salary; updates.push("salary"); }
      if (performance_metrics) { exp.performance_metrics = performance_metrics; updates.push("performance_metrics"); }
      if (notes) { exp.notes = notes; updates.push("notes"); }

      await writeJsonFile("profile/experience.json", experience, `Update experience: ${companyKey}`);

      return {
        content: [{ type: "text", text: `Updated experience at "${companyKey}": ${updates.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update experience: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== DELETE ITEM =====
server.registerTool(
  "delete_item",
  {
    title: "Delete Item",
    description: "Delete an item from projects, ideas, applications, or interviews",
    inputSchema: {
      item_type: z.enum(["project", "idea", "application", "interview"]).describe("Type of item to delete"),
      identifier: z.string().describe("Item identifier (project_id, idea name, company name, or interview ID)"),
      status_file: z.enum(["active", "planned", "completed"]).optional().describe("For projects: which status file"),
      idea_source: z.enum(["personal", "codaissance", "tampertantrum-labs"]).optional().describe("For ideas: which idea bank"),
    },
  },
  async ({ item_type, identifier, status_file, idea_source }) => {
    try {
      if (item_type === "project") {
        if (!status_file) {
          return { content: [{ type: "text", text: "status_file required for deleting projects" }] };
        }
        const filePath = `projects/${status_file}.json`;
        const projects = await readJsonFile<Record<string, unknown>>(filePath);

        if (!projects[identifier]) {
          return { content: [{ type: "text", text: `Project "${identifier}" not found in ${status_file}.json` }] };
        }

        delete projects[identifier];
        await writeJsonFile(filePath, projects, `Delete project: ${identifier}`);
        return { content: [{ type: "text", text: `Deleted project "${identifier}" from ${status_file}.json` }] };
      }

      if (item_type === "idea") {
        if (!idea_source) {
          return { content: [{ type: "text", text: "idea_source required for deleting ideas" }] };
        }
        const filePath = idea_source === "personal"
          ? "ideas/personal/ideas.json"
          : `ideas/business/${idea_source}/ideas.json`;

        const data = await readJsonFile<{ ideas: Array<Record<string, unknown>> }>(filePath);
        const initialLength = data.ideas.length;
        data.ideas = data.ideas.filter(i =>
          (i.name as string)?.toLowerCase() !== identifier.toLowerCase()
        );

        if (data.ideas.length === initialLength) {
          return { content: [{ type: "text", text: `Idea "${identifier}" not found` }] };
        }

        await writeJsonFile(filePath, data, `Delete idea: ${identifier}`);
        return { content: [{ type: "text", text: `Deleted idea "${identifier}" from ${idea_source} ideas` }] };
      }

      if (item_type === "application") {
        const data = await readJsonFile<{ applications: Array<Record<string, unknown>> }>("job-applications/applications.json");
        const initialLength = data.applications.length;
        data.applications = data.applications.filter(a =>
          !(a.company as string)?.toLowerCase().includes(identifier.toLowerCase())
        );

        if (data.applications.length === initialLength) {
          return { content: [{ type: "text", text: `Application for "${identifier}" not found` }] };
        }

        await writeJsonFile("job-applications/applications.json", data, `Delete application: ${identifier}`);
        return { content: [{ type: "text", text: `Deleted application for "${identifier}"` }] };
      }

      if (item_type === "interview") {
        const data = await readJsonFile<{ interviews: Array<Record<string, unknown>> }>("job-applications/interviews.json");
        const initialLength = data.interviews.length;
        data.interviews = data.interviews.filter(i =>
          i.id !== identifier &&
          !(i.company as string)?.toLowerCase().includes(identifier.toLowerCase())
        );

        if (data.interviews.length === initialLength) {
          return { content: [{ type: "text", text: `Interview "${identifier}" not found` }] };
        }

        await writeJsonFile("job-applications/interviews.json", data, `Delete interview: ${identifier}`);
        return { content: [{ type: "text", text: `Deleted interview "${identifier}"` }] };
      }

      return { content: [{ type: "text", text: "Invalid item type" }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to delete item: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== UPDATE LEARNING ITEM =====
server.registerTool(
  "update_learning_item",
  {
    title: "Update Learning Item",
    description: "Update a learning roadmap item's details (priority, why, resources, notes, category)",
    inputSchema: {
      skill: z.string().describe("Skill name to update"),
      queue: z.enum(["current_focus", "queue", "backlog", "on_hold"]).describe("Which queue the skill is in"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Update priority"),
      why: z.string().optional().describe("Update reason for learning"),
      category: z.string().optional().describe("Update category"),
      resources: z.array(z.string()).optional().describe("Update resources array"),
      notes: z.string().optional().describe("Update notes"),
      target_date: z.string().optional().describe("Set target completion date"),
    },
  },
  async ({ skill, queue, priority, why, category, resources, notes, target_date }) => {
    try {
      const roadmap = await readJsonFile<Record<string, Array<Record<string, unknown>>>>("learning/roadmap.json");

      const queueArray = roadmap[queue] || [];
      const item = queueArray.find(i => (i.skill as string)?.toLowerCase() === skill.toLowerCase());

      if (!item) {
        return { content: [{ type: "text", text: `Skill "${skill}" not found in ${queue}` }] };
      }

      const updates: string[] = [];

      if (priority) { item.priority = priority; updates.push(`priority: ${priority}`); }
      if (why) { item.why = why; updates.push("why"); }
      if (category) { item.category = category; updates.push(`category: ${category}`); }
      if (resources) { item.resources = resources; updates.push("resources"); }
      if (notes) { item.notes = notes; updates.push("notes"); }
      if (target_date) { item.target_date = target_date; updates.push(`target_date: ${target_date}`); }

      item.date_updated = new Date().toISOString().split("T")[0];

      await writeJsonFile("learning/roadmap.json", roadmap, `Update learning item: ${skill}`);

      return {
        content: [{ type: "text", text: `Updated "${skill}" in ${queue}: ${updates.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update learning item: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== UPDATE CONTENT IDEA =====
server.registerTool(
  "update_content_idea",
  {
    title: "Update Content Idea",
    description: "Update a LinkedIn content idea's status, performance metrics, or other fields",
    inputSchema: {
      account: z.enum(["personal", "codaissance", "tampertantrum"]).describe("Which account's content bank"),
      idea_title: z.string().describe("Title/topic of the content idea to update"),
      status: z.enum(["idea", "drafting", "scheduled", "published", "archived"]).optional().describe("Update status"),
      published_date: z.string().optional().describe("Set published date (YYYY-MM-DD)"),
      published_url: z.string().optional().describe("Set URL of published post"),
      impressions: z.number().optional().describe("Update impressions count"),
      engagement: z.number().optional().describe("Update engagement count"),
      notes: z.string().optional().describe("Update notes"),
    },
  },
  async ({ account, idea_title, status, published_date, published_url, impressions, engagement, notes }) => {
    try {
      const contentIdeas = await readJsonFile<{
        content_bank: Record<string, Array<Record<string, unknown>>>;
      }>("linkedin/content-ideas.json");

      const bank = contentIdeas.content_bank[account];
      if (!bank) {
        return { content: [{ type: "text", text: `Content bank for ${account} not found` }] };
      }

      const idea = bank.find(i =>
        (i.title as string)?.toLowerCase().includes(idea_title.toLowerCase()) ||
        (i.topic as string)?.toLowerCase().includes(idea_title.toLowerCase())
      );

      if (!idea) {
        return { content: [{ type: "text", text: `Content idea "${idea_title}" not found in ${account} bank` }] };
      }

      const updates: string[] = [];

      if (status) { idea.status = status; updates.push(`status: ${status}`); }
      if (published_date) { idea.published_date = published_date; updates.push(`published_date: ${published_date}`); }
      if (published_url) { idea.published_url = published_url; updates.push("published_url"); }
      if (impressions !== undefined) { idea.impressions = impressions; updates.push(`impressions: ${impressions}`); }
      if (engagement !== undefined) { idea.engagement = engagement; updates.push(`engagement: ${engagement}`); }
      if (notes) { idea.notes = notes; updates.push("notes"); }

      await writeJsonFile("linkedin/content-ideas.json", contentIdeas, `Update content idea: ${idea_title}`);

      return {
        content: [{ type: "text", text: `Updated content idea "${idea_title}": ${updates.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update content idea: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// ===== UPDATE JOB OPPORTUNITY =====
server.registerTool(
  "update_job_opportunity",
  {
    title: "Update Job Opportunity",
    description: "Update a job opportunity from the monitor (mark as applied, passed, add notes)",
    inputSchema: {
      company: z.string().describe("Company name to find the opportunity"),
      status: z.enum(["new", "reviewing", "applied", "passed", "rejected"]).optional().describe("Update opportunity status"),
      notes: z.string().optional().describe("Add notes about the opportunity"),
      applied_date: z.string().optional().describe("Set applied date if applied"),
      reason: z.string().optional().describe("Reason for passing or rejection"),
    },
  },
  async ({ company, status, notes, applied_date, reason }) => {
    try {
      const opportunities = await readJsonFile<{
        top_jobs: Array<Record<string, unknown>>;
        last_updated: string;
      }>("job-applications/opportunities/latest.json");

      const job = opportunities.top_jobs.find(j =>
        (j.company as string)?.toLowerCase().includes(company.toLowerCase())
      );

      if (!job) {
        return { content: [{ type: "text", text: `Opportunity at "${company}" not found` }] };
      }

      const updates: string[] = [];

      if (status) { job.status = status; updates.push(`status: ${status}`); }
      if (notes) { job.notes = notes; updates.push("notes"); }
      if (applied_date) { job.applied_date = applied_date; updates.push(`applied_date: ${applied_date}`); }
      if (reason) { job.reason = reason; updates.push("reason"); }

      job.last_updated = new Date().toISOString().split("T")[0];

      await writeJsonFile("job-applications/opportunities/latest.json", opportunities, `Update opportunity: ${company}`);

      return {
        content: [{ type: "text", text: `Updated opportunity at "${company}": ${updates.join(", ")}` }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update job opportunity: ${error instanceof Error ? error.message : "Unknown error"}` }] };
    }
  }
);

// HTTP Server for Vercel/remote deployment
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const httpServer = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "myself-knowledge-base" }));
    return;
  }

  // MCP endpoint
  if (req.url === "/mcp" && req.method === "POST") {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless
    });

    await server.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res);
    return;
  }

  // Default 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, () => {
  console.log(`MCP HTTP Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
