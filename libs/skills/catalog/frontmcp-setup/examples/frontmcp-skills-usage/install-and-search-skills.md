---
name: install-and-search-skills
reference: frontmcp-skills-usage
level: basic
description: 'Install skills statically for Claude Code and use dynamic CLI search for on-demand discovery.'
tags: [setup, cli, anthropic, skills, usage, install]
features:
  - '`frontmcp skills list` and `search` for discovering available skills'
  - '`frontmcp skills read` for viewing skill content and references on demand'
  - '`frontmcp skills install --provider claude` for static installation to `.claude/skills/`'
  - 'Installed skills are auto-loaded by Claude Code in its system prompt context'
---

# Install and Search Skills

Install skills statically for Claude Code and use dynamic CLI search for on-demand discovery.

## Code

```bash
# List all available skills
frontmcp skills list

# List skills by category
frontmcp skills list --category development
frontmcp skills list --category deployment
frontmcp skills list --category config

# Search skills by keywords
frontmcp skills search "authentication oauth"
frontmcp skills search "deploy vercel"
frontmcp skills search "plugin hooks" --tag middleware --limit 5

# Read a skill's full content
frontmcp skills read frontmcp-development

# List references for a skill
frontmcp skills read frontmcp-development --refs

# Read a specific reference
frontmcp skills read frontmcp-development create-tool
```

```bash
# Install core skills for Claude Code
frontmcp skills install frontmcp-setup --provider claude
frontmcp skills install frontmcp-development --provider claude
frontmcp skills install frontmcp-config --provider claude

# Install for Codex
frontmcp skills install frontmcp-development --provider codex

# Install to a custom directory
frontmcp skills install frontmcp-guides --dir ./my-skills
```

After installation, the directory structure:

```text
my-project/
  .claude/
    skills/
      frontmcp-setup/
        SKILL.md
        references/
      frontmcp-development/
        SKILL.md
        references/
      frontmcp-config/
        SKILL.md
        references/
```

## What This Demonstrates

- `frontmcp skills list` and `search` for discovering available skills
- `frontmcp skills read` for viewing skill content and references on demand
- `frontmcp skills install --provider claude` for static installation to `.claude/skills/`
- Installed skills are auto-loaded by Claude Code in its system prompt context

## Related

- See `frontmcp-skills-usage` for static vs dynamic comparison, bundle presets, and token optimization
