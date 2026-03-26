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
