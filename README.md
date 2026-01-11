# Myself MCP Server

MCP (Model Context Protocol) server for the personal knowledge base. Provides tools to query profile data, skills, projects, goals, business info, learning roadmap, ideas, and more.

## Tools Available

| Tool | Description |
|------|-------------|
| `get_skills` | Get skills with proficiency levels, filter by category or min level |
| `get_experience` | Get work experience, optionally current positions only |
| `get_projects` | Get projects by status (active/planned/completed) or technology |
| `get_goals` | Get 2026 goals with progress metrics |
| `get_profile` | Get profile summary with contact info |
| `get_resume` | Get full resume or specific variant |
| `query_knowledge_base` | Natural language search across all data |
| `get_job_opportunities` | Get monitored job postings |
| `get_business_info` | Get Codaissance or TamperTantrum Labs strategy, personas, marketing |
| `get_learning_roadmap` | Get learning roadmap and completed learning |
| `get_ideas` | Get ideas from personal or business idea banks |

## Usage

### Local (stdio transport - for Claude Desktop)

```bash
npm install
npm run build
npm start
```

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "myself": {
      "command": "node",
      "args": ["/path/to/myself-mcp-server/dist/index.js"]
    }
  }
}
```

### Vercel Deployment

Deploy to Vercel and the serverless function will be available at:
- `GET /api/mcp` - Health check
- `POST /api/mcp` - MCP protocol endpoint

The Vercel function fetches data directly from the `G-Hensley/myself` GitHub repo.

### Local HTTP Server (alternative)

```bash
npm run dev:http
# or
npm run build && npm run start:http
```

Endpoints:
- `GET /health` - Health check
- `POST /mcp` - MCP protocol endpoint

### Testing with MCP Inspector

```bash
npm run inspect
```

## Development

```bash
npm run dev      # Run stdio server with tsx
npm run dev:http # Run HTTP server with tsx
```

## Architecture

- `src/index.ts` - Stdio transport server (reads local files)
- `src/http-server.ts` - HTTP transport server (fetches from GitHub)
- `api/mcp.ts` - Vercel serverless function (fetches from GitHub)

All remote servers read data directly from the GitHub repo, so they're always up-to-date with the latest data.
