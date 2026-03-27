---
name: frontmcp-skills-usage
description: Search, install, and manage FrontMCP development skills for Claude Code and Codex. Use when setting up skills for AI-assisted development, choosing between static and dynamic skill delivery, or configuring skill providers.
tags: [skills, cli, install, claude, codex, search, catalog]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/servers/skills
---

# FrontMCP Skills — Search, Install, and Usage

FrontMCP ships with a catalog of development skills that teach AI agents (Claude Code, Codex) how to build FrontMCP servers. You can deliver these skills **statically** (copy to disk) or **dynamically** (search on demand via CLI).

## When to Use This Skill

### Must Use

- Setting up a new FrontMCP project and need to discover which skills to install for your workflow
- Configuring AI-assisted development (Claude Code or Codex) with FrontMCP skill files for the first time
- Deciding between static skill installation and dynamic on-demand search for your team

### Recommended

- Exploring the FrontMCP skill catalog to find skills for a specific topic (auth, deployment, plugins, etc.)
- Onboarding a new team member who needs to understand how FrontMCP skills are delivered and consumed
- Optimizing token usage by switching from fully-static to a hybrid static/dynamic skill strategy

### Skip When

- You already know which specific skill you need and want to learn its content (use that skill directly, e.g., `create-tool` or `configure-auth`)
- You are scaffolding a brand-new FrontMCP project from scratch (use `setup-project` instead)
- You need to create a custom skill for your own organization (use `create-skill` instead)

> **Decision:** Use this skill when you need to understand the skills system itself -- how to browse, install, manage, and deliver FrontMCP skills to AI agents.

## Quick Start

```bash
# Search for skills about tools
frontmcp skills search "create tool"

# List all skills
frontmcp skills list

# Show full skill content
frontmcp skills show create-tool

# Install a skill for Claude Code
frontmcp skills install create-tool --provider claude

# Install a skill for Codex
frontmcp skills install create-tool --provider codex
```

## CLI Commands

### `frontmcp skills search <query>`

Semantic search through the catalog using weighted text matching (description 3x, tags 2x, name 1x):

```bash
frontmcp skills search "authentication oauth"
frontmcp skills search "deploy vercel" --category deployment
frontmcp skills search "plugin hooks" --tag middleware --limit 5
```

### `frontmcp skills list`

List all skills, optionally filtered:

```bash
frontmcp skills list                          # All skills
frontmcp skills list --category development   # Development skills only
frontmcp skills list --tag redis              # Skills tagged with redis
frontmcp skills list --bundle recommended     # Recommended bundle
```

### `frontmcp skills show <name>`

Print the full SKILL.md content to stdout — useful for piping to AI context:

```bash
frontmcp skills show create-tool              # Print full skill
frontmcp skills show configure-auth           # Print auth skill
```

### `frontmcp skills install <name>`

Copy a skill to a provider-specific directory:

```bash
# Claude Code — installs to .claude/skills/<name>/SKILL.md
frontmcp skills install create-tool --provider claude

# Codex — installs to .codex/skills/<name>/SKILL.md
frontmcp skills install decorators-guide --provider codex

# Custom directory
frontmcp skills install setup-project --dir ./my-skills
```

## Two Approaches: Static vs Dynamic

### Static Installation (Copy to Disk)

Install skills once — they live in your project and are always available:

```bash
# Install for Claude Code
frontmcp skills install create-tool --provider claude
frontmcp skills install create-resource --provider claude
frontmcp skills install configure-auth --provider claude

# Install for Codex
frontmcp skills install decorators-guide --provider codex
```

**Directory structure after install:**

```
my-project/
├── .claude/
│   └── skills/
│       ├── create-tool/
│       │   ├── SKILL.md
│       │   └── references/
│       ├── create-resource/
│       │   └── SKILL.md
│       └── configure-auth/
│           ├── SKILL.md
│           └── references/
├── .codex/
│   └── skills/
│       └── decorators-guide/
│           └── SKILL.md
└── src/
    └── ...
```

### Dynamic Search (On-Demand via CLI)

Use the CLI to search and show skills on demand — no installation needed:

```bash
# Search for what you need
frontmcp skills search "how to create a tool with zod"

# Pipe skill content directly into context
frontmcp skills show create-tool
```

This works because `frontmcp skills show` outputs the full SKILL.md content to stdout.

## Comparison: Static vs Dynamic

| Aspect            | Static Install                        | Dynamic CLI Search                           |
| ----------------- | ------------------------------------- | -------------------------------------------- |
| **Setup**         | `frontmcp skills install <name>` once | No setup — just use `frontmcp skills search` |
| **Availability**  | Always loaded by AI agent             | On-demand, requires CLI invocation           |
| **Context usage** | Skills in system prompt (uses tokens) | Only loaded when searched (saves tokens)     |
| **Updates**       | Re-install to update                  | Always uses latest catalog                   |
| **Offline**       | Works offline after install           | Needs catalog available                      |
| **Best for**      | Core skills you use daily             | Occasional reference, exploration            |
| **Token cost**    | Higher (all installed skills loaded)  | Lower (only searched skills loaded)          |

### Recommended Approach

**Install 5-10 core skills statically** for your most common workflows, and use dynamic search for everything else:

```bash
# Core skills — install statically
frontmcp skills install setup-project --provider claude
frontmcp skills install create-tool --provider claude
frontmcp skills install decorators-guide --provider claude
frontmcp skills install configure-auth --provider claude
frontmcp skills install project-structure-standalone --provider claude

# Everything else — search on demand
frontmcp skills search "deploy to vercel"
frontmcp skills search "rate limiting"
frontmcp skills show configure-throttle
```

## Provider Directories

| Provider    | Install directory                | Auto-loaded by            |
| ----------- | -------------------------------- | ------------------------- |
| Claude Code | `.claude/skills/<name>/SKILL.md` | Claude Code system prompt |
| Codex       | `.codex/skills/<name>/SKILL.md`  | Codex agent context       |

## Bundle Presets

When scaffolding a project, use `--skills` to install a preset bundle:

```bash
# Recommended bundle (core skills for the deployment target)
frontmcp create my-app --skills recommended

# Minimal bundle (just project setup + create-tool)
frontmcp create my-app --skills minimal

# Full bundle (all skills)
frontmcp create my-app --skills full

# No skills
frontmcp create my-app --skills none
```

## Available Categories

```bash
frontmcp skills list --category setup        # Project setup and configuration
frontmcp skills list --category config       # Server configuration (transport, HTTP, throttle, elicitation)
frontmcp skills list --category development  # Creating tools, resources, prompts, agents, skills, providers
frontmcp skills list --category deployment   # Build and deploy (node, vercel, lambda, cli, browser, sdk)
frontmcp skills list --category auth         # Authentication and session management
frontmcp skills list --category plugins      # Official and custom plugins
frontmcp skills list --category adapters     # OpenAPI and custom adapters
frontmcp skills list --category testing      # Testing with Jest and @frontmcp/testing
```

## Common Patterns

| Pattern                     | Correct                                                          | Incorrect                                       | Why                                                                               |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Installing a skill          | `frontmcp skills install create-tool --provider claude`          | `cp node_modules/.../SKILL.md .claude/skills/`  | The CLI handles directory creation, naming, and reference files automatically     |
| Searching skills            | `frontmcp skills search "oauth authentication"`                  | `frontmcp skills list \| grep oauth`            | Search uses weighted text matching (description 3x, tags 2x) for better relevance |
| Choosing delivery mode      | Install 5-10 core skills statically; search the rest on demand   | Install every skill statically into the project | Static skills consume tokens on every agent invocation; keep the set small        |
| Updating an installed skill | `frontmcp skills install create-tool --provider claude` (re-run) | Manually editing the installed SKILL.md file    | Re-installing overwrites with the latest catalog version and preserves structure  |
| Filtering by category       | `frontmcp skills list --category deployment`                     | `frontmcp skills search "deployment"`           | `--category` uses the manifest taxonomy; search is for free-text queries          |

## Verification Checklist

### Configuration

- [ ] FrontMCP CLI is installed and available on PATH (`frontmcp --version`)
- [ ] Target provider directory exists or will be created (`.claude/skills/` or `.codex/skills/`)
- [ ] Desired skills are listed in `frontmcp skills list` output
- [ ] Bundle preset matches project needs (`minimal`, `recommended`, or `full`)

### Runtime

- [ ] Installed skills appear in the correct provider directory after `frontmcp skills install`
- [ ] `frontmcp skills show <name>` outputs the full SKILL.md content to stdout
- [ ] `frontmcp skills search <query>` returns relevant results ranked by relevance
- [ ] AI agent (Claude Code or Codex) loads installed skills in its system prompt context

## Troubleshooting

| Problem                                               | Cause                                                               | Solution                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `frontmcp skills search` returns no results           | Query terms do not match any skill name, description, or tags       | Broaden the query, try synonyms, or use `frontmcp skills list` to browse all available skills             |
| Installed skill not picked up by Claude Code          | Skill was installed to wrong directory or provider flag was omitted | Re-install with `--provider claude` and verify the file exists at `.claude/skills/<name>/SKILL.md`        |
| `frontmcp skills install` fails with permission error | Target directory is read-only or owned by a different user          | Check directory permissions; use `--dir` flag to specify an alternative writable path                     |
| Skill content is outdated after a CLI upgrade         | Static installs are point-in-time snapshots of the catalog          | Re-run `frontmcp skills install <name> --provider claude` to fetch the latest version                     |
| Too many tokens consumed by agent context             | All skills installed statically, inflating the system prompt        | Uninstall rarely-used skills and switch to dynamic search (`frontmcp skills search`) for occasional needs |

## Reference

- **Docs:** <https://docs.agentfront.dev/frontmcp/servers/skills>
- **Related skills:** `setup-project`, `create-tool`, `create-resource`, `create-skill`, `decorators-guide`
