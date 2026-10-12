# @frontmcp/skills

FrontMCP's skills catalog: folders of instructions (`SKILL.md`, references and examples) that teach a coding agent,
such as Claude Code or Codex, how to build, test and deploy a FrontMCP server. The `frontmcp` CLI reads it to install
skills into your project; you rarely install this package yourself.

[![npm](https://img.shields.io/npm/v/@frontmcp/skills.svg)](https://www.npmjs.com/package/@frontmcp/skills)
[![License](https://img.shields.io/npm/l/@frontmcp/skills.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Installing skills

Use the CLI, which depends on this package:

```bash
npx frontmcp skills list                            # the catalog, by category
npx frontmcp skills search "openapi"                # rank skills by a query
npx frontmcp skills install create-tool             # copy one skill into .claude/skills/
npx frontmcp skills install --all --provider codex  # every skill, into .codex/skills/
npx frontmcp skills read create-tool quick-start    # print a skill or one of its references
```

`frontmcp create` copies the `recommended` bundle into a new project (`--skills recommended|minimal|full|none`), and
`nx g @frontmcp/nx:server` takes the same `--skills` option. See [Skills](https://frontmcp.dev/reference/cli#skills)
in the CLI reference for every option.

## The catalog

| Skill                           | Covers                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `create-tool`                   | Building, changing or reviewing a `@Tool`                                     |
| `frontmcp-setup`                | Creating and organizing a project: the scaffold, Nx, several apps in one      |
| `frontmcp-development`          | Resources, prompts, agents, providers, jobs, workflows, skills                |
| `frontmcp-config`               | `frontmcp.config` and `@FrontMcp` options: auth, transport, HTTP, sessions    |
| `frontmcp-authorities`          | Authorization and access control for tools, resources, prompts and skills     |
| `frontmcp-auth-ui`              | Replacing the built-in OAuth login and consent pages with your own components |
| `frontmcp-channels`             | Pushing notifications and events into client sessions                         |
| `frontmcp-extensibility`        | Bringing third-party packages and services into providers and tools           |
| `frontmcp-observability`        | Tracing, structured logging, metrics and monitoring                           |
| `frontmcp-testing`              | Unit, integration and E2E tests with `@frontmcp/testing`                      |
| `frontmcp-deployment`           | Build targets and deploying to Node, Vercel, Lambda and Cloudflare            |
| `frontmcp-production-readiness` | Pre-production audits and go-live checklists                                  |
| `frontmcp-guides`               | End-to-end walkthroughs and reference projects                                |

## Reading the catalog from code

```bash
npm install @frontmcp/skills
```

```ts
import { getSkillsByBundle, loadManifest, resolveSkillPath } from '@frontmcp/skills';

const manifest = loadManifest();
for (const skill of getSkillsByBundle(manifest.skills, 'minimal')) {
  console.log(skill.name, resolveSkillPath(skill));
}
```

`loadManifest()` reads `catalog/skills-manifest.json` from the installed package. `getSkillsByTarget`,
`getSkillsByCategory`, `getInstructionOnlySkills` and `getResourceSkills` filter its `skills`, and `resolveSkillPath`
returns the absolute path of a skill's folder.

## Docs

- [Skills commands](https://frontmcp.dev/reference/cli#skills) in the CLI reference
- [Docs for your agent](https://frontmcp.dev/learn/docs-for-your-agent): FrontMCP's docs over MCP, for the release you
  use
- [Skills in your own server](https://frontmcp.dev/reference/sdk/skill): `@Skill`, which serves skills to MCP clients

## Related packages

- [`frontmcp`](https://www.npmjs.com/package/frontmcp) — the CLI behind `frontmcp skills` and `frontmcp create --skills`
- [`@frontmcp/nx`](https://www.npmjs.com/package/@frontmcp/nx) — the Nx server generator, which installs skills too
- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk) — the framework the skills describe

## Contributing

Source: [`libs/skills`](https://github.com/agentfront/frontmcp/tree/main/libs/skills). Issues and pull requests are
welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md). A change to FrontMCP's
behavior updates the matching skills in the same pull request.

### Structure

Most skills are **router skills**: a `SKILL.md` with a routing table, a `references/` directory of topic guides, and
optional `examples/<reference-name>/` directories. `create-tool` is a **component skill** (`layout: component`): flat
`examples/` and DO/DON'T `rules/`.

```text
catalog/
├── skills-manifest.json       # Machine-readable index, generated from the SKILL.md files
├── TEMPLATE.md                # Starting point for a new SKILL.md
├── create-tool/               # Component skill: references/, examples/, rules/
├── frontmcp-setup/            # Router skills: SKILL.md, references/, examples/
├── frontmcp-development/
├── ...                        # One directory per skill in the table above
└── frontmcp-guides/
```

Each router skill directory follows this format:

```text
frontmcp-development/
├── SKILL.md          # Required: frontmatter + routing table + instructions
└── references/       # Reference files with detailed per-topic guides
    ├── create-resource.md
    ├── create-agent.md
    └── ...
```

Example files live under `examples/<reference-name>/` and are the canonical source of example metadata used by `skills-manifest.json` and the reference `## Examples` tables.

### SKILL.md Frontmatter

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
compatibility: Node.js 24+ # Optional: environment requirements
license: MIT # Optional: license
allowed-tools: Read Edit # Optional: pre-approved tools
rating: 4.5 # Optional (v1.2): 0..5 quality rating, surfaced via Skills HTTP API min-rating filter
category: development # Optional (v1.2): catalog category override (defaults to the directory's parent category)
requires: [frontmcp-setup] # Optional (v1.2): other skill names this depends on; resolver registers deps first
---
# Skill Instructions

Step-by-step markdown instructions here...
```

### Adding a New Skill

Prefer adding a reference to an existing skill over creating a new top-level skill directory.

1. Identify the skill your content belongs to (see [The catalog](#the-catalog))
2. Create a new `.md` reference file in that skill's `references/` directory
3. Add a routing entry in the skill's `SKILL.md` routing table
4. Regenerate the manifest with `node libs/skills/scripts/generate-manifest.mjs` (`nx build skills` runs it too)
5. Run `nx test skills` to validate

For a new top-level skill, start from `catalog/TEMPLATE.md`.

### Adding Example Files

Each reference may have a matching `examples/<reference-name>/` directory with standalone example files.

```yaml
---
name: example-name
reference: parent-reference-name
level: basic
description: One sentence describing the exact scenario this example covers.
tags: [keyword1, keyword2, keyword3]
features:
  - Concrete API or pattern this example demonstrates
  - Another concrete behavior shown in the code
---
```

Rules:

- `name` must match the filename without `.md`
- `reference` must match the parent examples directory
- `description` is the canonical one-line summary reused by the manifest and reference table
- `tags` are searchable keywords for the example
- `features` are the concrete APIs or patterns demonstrated by the code
- The first paragraph under the H1 should semantically match `description`

### Manifest Entry

Each skill has a corresponding entry in `skills-manifest.json`, generated from its `SKILL.md`:

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

#### Target Values

- `all` — applies to all deployment targets
- `node` — Node.js / Docker deployments
- `vercel` — Vercel serverless
- `lambda` — AWS Lambda
- `cloudflare` — Cloudflare Workers

#### Bundle Values

- `recommended` — included in default scaffold
- `minimal` — included in minimal scaffold
- `full` — only in full scaffold

### Validation

```bash
node libs/skills/scripts/generate-manifest.mjs --check   # the manifest matches the catalog
nx test skills
```

Tests verify:

- All SKILL.md files parse correctly
- Manifest entries match filesystem (no orphans)
- Names match between manifest and frontmatter
- `hasResources` flags are accurate
- Targets, categories, and bundles use valid values
- Example metadata stays in sync across example files, reference tables, and the manifest

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
