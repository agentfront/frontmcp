# @frontmcp/skills

Curated skills catalog for FrontMCP projects. Skills are SKILL.md-based instructional packages that teach AI agents how to perform multi-step tasks with FrontMCP.

## Structure

```
catalog/
├── skills-manifest.json    # Machine-readable index of all skills
├── setup/                  # Project setup and configuration
├── deployment/             # Target-specific deployment guides
├── development/            # MCP tool/resource/prompt creation
├── auth/                   # Authentication and session management
├── plugins/                # Plugin development
└── testing/                # Testing setup
```

## Skill Directory Format

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter and optional resource directories:

```
skill-name/
├── SKILL.md          # Required: frontmatter + instructions
├── scripts/          # Optional: automation scripts
├── references/       # Optional: reference files (Dockerfile, config examples)
└── assets/           # Optional: images, diagrams
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

1. Create a directory under the appropriate category in `catalog/`
2. Add a `SKILL.md` file using the template at `catalog/TEMPLATE.md`
3. Add an entry to `catalog/skills-manifest.json`
4. Run `nx test skills` to validate

## Manifest Entry

Each skill must have a corresponding entry in `skills-manifest.json`:

```json
{
  "name": "my-skill",
  "category": "development",
  "description": "What the skill does",
  "path": "development/my-skill",
  "targets": ["all"],
  "hasResources": false,
  "tags": ["development"],
  "bundle": ["recommended"],
  "install": {
    "destinations": ["project-local"],
    "mergeStrategy": "skip-existing"
  }
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
