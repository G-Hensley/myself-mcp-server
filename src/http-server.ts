import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as http from "http";
import type {
  SkillsData,
  SkillResult,
  ExperienceData,
  ProjectsData,
  ProjectResult,
  GoalsData,
  GoalResult,
  ContactData,
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

// Helper to fetch files from GitHub (supports private repos with PAT)
async function fetchFromGitHub(relativePath: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${relativePath}`;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.raw+json",
  };

  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
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
});

// Tool: Get Skills
server.registerTool(
  "get_skills",
  {
    title: "Get Skills",
    description: "Get all skills with proficiency levels, optionally filtered by category or level",
    inputSchema: {
      category: z.string().optional().describe("Filter by category (e.g., 'Frontend', 'Backend', 'DevOps')"),
      min_level: z.enum(["none", "novice", "apprentice", "adept", "expert", "master"]).optional().describe("Minimum proficiency level"),
    },
    outputSchema: textContentOutputSchema,
  },
  async ({ category, min_level }) => {
    const skills = await readJsonFile<SkillsData>("profile/skills.json");

    const levelOrder = skills.skill_levels;
    const minLevelIndex = min_level ? levelOrder.indexOf(min_level) : 0;

    const result: SkillResult[] = [];

    for (const [cat, data] of Object.entries(skills.categories)) {
      if (category && cat.toLowerCase() !== category.toLowerCase()) continue;

      for (const skill of data.skills) {
        const skillLevelIndex = levelOrder.indexOf(skill.level);
        if (skillLevelIndex >= minLevelIndex) {
          result.push({
            category: cat,
            name: skill.name,
            level: skill.level,
            notes: skill.notes,
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
    const experience = await readJsonFile<ExperienceData>("profile/experience.json");

    let positions = experience.positions;
    if (current_only) {
      positions = positions.filter(p => p.end_date === "Present");
    }

    return {
      content: [{ type: "text", text: JSON.stringify(positions, null, 2) }],
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

    let allProjects: ProjectResult[] = [];

    const statusesToCheck = status ? [status] : ["active", "planned", "completed"];

    for (const s of statusesToCheck) {
      try {
        const data = await readJsonFile<ProjectsData>(files[s]);
        const projects = data.projects.map(p => ({ ...p, status: s }));
        allProjects.push(...projects);
      } catch {
        // File may not exist
      }
    }

    if (tech) {
      const techLower = tech.toLowerCase();
      allProjects = allProjects.filter(p =>
        p.technologies.some(t => t.toLowerCase().includes(techLower))
      );
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
    description: "Get a complete profile summary including contact info, summary, and key stats",
    outputSchema: textContentOutputSchema,
  },
  async () => {
    const contact = await readJsonFile<ContactData>("profile/contact.json");
    const resume = await readMarkdownFile("profile/resume.md");

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
      const opportunities = await readJsonFile<JobOpportunitiesData>("job-applications/opportunities/latest.json");

      let jobs = opportunities.jobs || [];

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
