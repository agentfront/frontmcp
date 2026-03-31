---
name: bundle-presets-scaffolding
reference: frontmcp-skills-usage
level: intermediate
description: 'Use `--skills` flag during project creation to install a skill bundle preset.'
tags: [setup, skills, usage, bundle, presets, scaffolding]
features:
  - '`--skills` flag accepts `recommended`, `minimal`, `full`, or `none` presets'
  - 'Static installs are snapshots; re-run `install` to update to the latest catalog version'
  - 'Hybrid approach: install core skills statically, search the rest on demand'
  - 'Fewer static installs reduce token usage in AI agent context'
---

# Bundle Presets During Scaffolding

Use `--skills` flag during project creation to install a skill bundle preset.

## Code

```bash
# Recommended bundle (core skills for the deployment target)
npx frontmcp create my-app --skills recommended --yes

# Minimal bundle (just project setup + create-tool)
npx frontmcp create my-app --skills minimal --yes

# Full bundle (all skills)
npx frontmcp create my-app --skills full --yes

# No skills
npx frontmcp create my-app --skills none --yes
```

```bash
# After scaffolding, update installed skills to the latest version
frontmcp skills install frontmcp-development --provider claude
frontmcp skills install frontmcp-config --provider claude
```

```bash
# Recommended hybrid strategy:
# 1. Install 2-4 core skills statically for daily use
frontmcp skills install frontmcp-setup --provider claude
frontmcp skills install frontmcp-development --provider claude

# 2. Search everything else on demand (saves tokens)
frontmcp skills search "deploy to vercel"
frontmcp skills search "rate limiting"
frontmcp skills read frontmcp-deployment
```

## What This Demonstrates

- `--skills` flag accepts `recommended`, `minimal`, `full`, or `none` presets
- Static installs are snapshots; re-run `install` to update to the latest catalog version
- Hybrid approach: install core skills statically, search the rest on demand
- Fewer static installs reduce token usage in AI agent context

## Related

- See `frontmcp-skills-usage` for the full skill catalog, provider directories, and CLI command reference
