# @frontmcp/skills

Curated skills catalog for FrontMCP projects. Skills are SKILL.md-based instructional packages that teach AI agents how to perform multi-step tasks with FrontMCP.

## Structure

The catalog uses a **router skill model** — 6 domain-scoped router skills, each containing a SKILL.md with a routing table and a `references/` directory with detailed reference files.

```
catalog/
├── skills-manifest.json       # Machine-readable index of all skills
├── frontmcp-setup/            # Project setup, scaffolding, Nx, storage backends
├── frontmcp-development/      # Tools, resources, prompts, agents, providers, jobs, workflows, skills
├── frontmcp-deployment/       # Deploy to Node, Vercel, Lambda, Cloudflare; build for CLI, browser, SDK
├── frontmcp-testing/          # Testing with Jest and @frontmcp/testing
├── frontmcp-config/           # Transport, HTTP, throttle, elicitation, auth, sessions, storage
└── frontmcp-guides/           # End-to-end examples and best practices
```

Each router skill directory follows this format:

```
frontmcp-development/
├── SKILL.md          # Required: frontmatter + routing table + instructions
└── references/       # Reference files with detailed per-topic guides
    ├── create-tool.md
    ├── create-resource.md
    ├── create-agent.md
    └── ...
```

## SKILL.md Frontmatter

```yaml
---
name: my-skill # Required: kebab-case, max 64 chars
description: What the skill does # Required: short description
tags: [setup, redis] # Optional: categorization tags
tools: # Optional: tool references
  - tool_name
  - name: detailed_tool
    purpose: Why this tool is used
    required: true
parameters: # Optional: input parameters
  - name: param_name
    description: What it controls
    type: string
    default: value
examples: # Optional: usage examples
  - scenario: When to use this
    expected-outcome: What happens
priority: 5 # Optional: search ranking weight
visibility: both # Optional: mcp | http | both
compatibility: Node.js 18+ # Optional: environment requirements
license: MIT # Optional: license
allowed-tools: Read Edit # Optional: pre-approved tools
---
# Skill Instructions

Step-by-step markdown instructions here...
```

## Adding a New Skill

> **Important:** The canonical catalog model is 6 router skills with reference markdown. Do not create new top-level skill directories — add new content as reference files within the appropriate router skill.

1. Identify which router skill your content belongs to (setup, development, deployment, testing, config, or guides)
2. Create a new `.md` reference file in that router's `references/` directory
3. Add a routing entry in the router's `SKILL.md` routing table
4. Run `nx test skills` to validate

## Manifest Entry

Each router skill has a corresponding entry in `skills-manifest.json`:

```json
{
  "name": "frontmcp-development",
  "category": "development",
  "description": "Domain router for building MCP components",
  "path": "frontmcp-development",
  "targets": ["all"],
  "hasResources": true,
  "tags": ["router", "development", "tools", "resources"],
  "bundle": ["recommended", "minimal", "full"]
}
```

### Target Values

- `all` — applies to all deployment targets
- `node` — Node.js / Docker deployments
- `vercel` — Vercel serverless
- `lambda` — AWS Lambda
- `cloudflare` — Cloudflare Workers

### Bundle Values

- `recommended` — included in default scaffold
- `minimal` — included in minimal scaffold
- `full` — only in full scaffold

## Scaffold Integration

Skills are automatically included when scaffolding projects:

```bash
# CLI (default: recommended bundle)
frontmcp create my-app --skills recommended

# Nx server generator
nx g @frontmcp/nx:server my-server --skills recommended
```

## Validation

```bash
nx test skills
```

Tests verify:

- All SKILL.md files parse correctly
- Manifest entries match filesystem (no orphans)
- Names match between manifest and frontmatter
- `hasResources` flags are accurate
- Targets, categories, and bundles use valid values
