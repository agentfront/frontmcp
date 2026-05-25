---
name: frontmcp-skills-usage
description: Search, install, and manage FrontMCP skill catalog for AI agents (Claude Code, Codex)
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

- You already know which specific skill you need and want to learn its content (use that skill directly, e.g., `frontmcp-development` or `frontmcp-config`)
- You are scaffolding a brand-new FrontMCP project from scratch (use `frontmcp-setup` instead)
- You need to create a custom skill for your own organization (use the `create-skill` reference in `frontmcp-development`)

> **Decision:** Use this skill when you need to understand the skills system itself -- how to browse, install, manage, and deliver FrontMCP skills to AI agents.

## Available Skills

The catalog contains 6 router skills, each covering a domain:

| Skill Name             | Category    | Description                                                                    |
| ---------------------- | ----------- | ------------------------------------------------------------------------------ |
| `frontmcp-setup`       | setup       | Project setup, scaffolding, Nx workspaces, storage backends                    |
| `frontmcp-development` | development | Creating tools, resources, prompts, agents, providers, jobs, workflows, skills |
| `frontmcp-deployment`  | deployment  | Build and deploy to Node, Vercel, Lambda, Cloudflare, CLI, browser, SDK        |
| `frontmcp-testing`     | testing     | Testing with Jest and @frontmcp/testing                                        |
| `frontmcp-config`      | config      | Transport, HTTP, throttle, elicitation, auth, sessions, storage                |
| `frontmcp-guides`      | guides      | End-to-end examples and best practices                                         |

Each router skill contains a SKILL.md with a routing table and a `references/` directory with detailed reference files.

## Quick Start

```bash
# List all skills
frontmcp skills list

# List skills by category
frontmcp skills list --category development

# Show full skill content
frontmcp skills read frontmcp-development

# Install a skill for Claude Code
frontmcp skills install frontmcp-development --provider claude

# Install a skill for Codex
frontmcp skills install frontmcp-setup --provider codex

# Bulk install — every skill in a category, all at once
frontmcp skills install --category development --provider claude

# Export a skill as a Cursor rule file (for skills-unaware IDEs)
frontmcp skills export --name frontmcp-development --target cursor

# Publish a skill to the Smithery marketplace
frontmcp skills publish frontmcp-development --target smithery --dry-run
```

## CLI Commands

The `frontmcp skills` command tree currently has six subcommands:
`search`, `list`, `install`, `read`, `export`, `publish`.

<!-- AUTOGEN:skills-cli:start -->

### `frontmcp skills search <query>`

Semantic search through the catalog using weighted text matching (description 3x, tags 2x, name 1x).

| Flag                  | Description               | Default |
| --------------------- | ------------------------- | ------- |
| `-n, --limit <count>` | Maximum results to return | `10`    |
| `-t, --tag <tag>`     | Filter by tag             | —       |
| `-c, --category <c>`  | Filter by category        | —       |

```bash
frontmcp skills search "authentication oauth"
frontmcp skills search "deploy vercel" --category deployment
frontmcp skills search "plugin hooks" --tag middleware --limit 5
```

### `frontmcp skills list`

List all skills, optionally filtered.

| Flag                  | Description                                                | Default |
| --------------------- | ---------------------------------------------------------- | ------- |
| `-c, --category <c>`  | Filter by category                                         | —       |
| `-t, --tag <tag>`     | Filter by tag                                              | —       |
| `-b, --bundle <name>` | Filter by bundle preset (`recommended`, `minimal`, `full`) | —       |

```bash
frontmcp skills list                          # All skills
frontmcp skills list --category development   # Development skills only
frontmcp skills list --tag redis              # Skills tagged with redis
frontmcp skills list --bundle recommended     # Recommended bundle
```

### `frontmcp skills read <nameOrPath> [reference]`

Read a skill's main SKILL.md, a specific reference, or list available references.

| Flag                     | Description                                                        | Default |
| ------------------------ | ------------------------------------------------------------------ | ------- |
| `--refs`                 | List all available references for the skill                        | `false` |
| `--examples [reference]` | List examples for the skill, optionally filtered by reference name | —       |

```bash
# Read main skill content
frontmcp skills read frontmcp-development

# List all references for a skill
frontmcp skills read frontmcp-development --refs

# List every example bundled with the skill (or filter by reference)
frontmcp skills read frontmcp-development --examples
frontmcp skills read frontmcp-development --examples create-tool

# Read a specific reference by name
frontmcp skills read frontmcp-development create-tool

# Read any file using colon syntax (works with non-.md files too)
frontmcp skills read frontmcp-development:references/create-tool.md
frontmcp skills read frontmcp-development:scripts/setup.sh
```

### `frontmcp skills install [name]`

Install one or many skills to a provider-specific directory. `[name]` is
optional when one of `--all`, `--tag`, or `--category` is supplied —
those flags select skills in bulk.

| Flag                        | Description                                                                                            | Default  |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| `-p, --provider <provider>` | Target provider: `claude` or `codex`                                                                   | `claude` |
| `-d, --dir <directory>`     | Custom install directory (overrides provider default)                                                  | —        |
| `-a, --all`                 | Install **every** skill in the catalog (or every `@Skill` entry when `--from-*` is set)                | `false`  |
| `-t, --tag <tag>`           | Install every skill matching a tag (catalog only)                                                      | —        |
| `-c, --category <c>`        | Install every skill in a category (catalog only)                                                       | —        |
| `--from-entry <path>`       | Install `@Skill` entries discovered in a **local project entry file** instead of the framework catalog | —        |
| `--from-package <pkg>`      | Install `@Skill` entries discovered in a **published package's** main entry                            | —        |

```bash
# Single-skill install (positional name)
frontmcp skills install frontmcp-development --provider claude   # → .claude/skills/<name>/SKILL.md
frontmcp skills install frontmcp-setup --provider codex          # → .codex/skills/<name>/SKILL.md
frontmcp skills install frontmcp-guides --dir ./my-skills        # custom destination

# Bulk install — see "Bulk install patterns" below for the full decision matrix
frontmcp skills install --all --provider claude
frontmcp skills install --category development --provider claude
frontmcp skills install --tag middleware --provider codex

# Install a project's own @Skill-decorated entries (see "Installing project-defined skills")
frontmcp skills install --from-entry src/main.ts --all -p claude
frontmcp skills install --from-package my-frontmcp-server my-skill -p claude
```

### `frontmcp skills export`

Convert one or many catalog skills into a rule file for IDEs that
**don't** speak the skills protocol (Cursor, Windsurf, Copilot). The
emitted file lives in the current directory by default.

| Flag                    | Description                                           | Default  |
| ----------------------- | ----------------------------------------------------- | -------- |
| `-t, --target <target>` | Target IDE: `cursor`, `windsurf`, or `copilot`        | `cursor` |
| `-n, --name <name>`     | Skill name to export (required unless `--all` is set) | —        |
| `-a, --all`             | Export **every** skill in the catalog                 | `false`  |
| `-d, --out <directory>` | Output directory                                      | `cwd`    |

```bash
frontmcp skills export --name frontmcp-development --target cursor
frontmcp skills export --name frontmcp-setup --target windsurf
frontmcp skills export --all --target copilot --out ./.github
```

See **Other AI clients (Cursor / Windsurf / Copilot)** below for the
output-filename mapping per target.

### `frontmcp skills publish <name>`

Publish a skill to a public marketplace (Smithery or Glama).

| Flag                    | Description                                                      | Default    |
| ----------------------- | ---------------------------------------------------------------- | ---------- |
| `-t, --target <target>` | Marketplace: `smithery` or `glama`                               | `smithery` |
| `--token <token>`       | API token (defaults to `SMITHERY_TOKEN` / `GLAMA_TOKEN` env var) | env        |
| `--repository <url>`    | Repository URL to advertise on the marketplace                   | —          |
| `--dry-run`             | Print the payload + endpoint without submitting                  | `false`    |

```bash
# Dry run against Smithery (no submission)
frontmcp skills publish frontmcp-development --dry-run

# Real publish to Glama with a custom repo URL + env-var token
GLAMA_TOKEN=xxx frontmcp skills publish frontmcp-development \
  --target glama --repository https://github.com/me/my-frontmcp-server
```

<!-- AUTOGEN:skills-cli:end -->

## Bulk install patterns

`frontmcp skills install` accepts a single `[name]` OR one of the bulk
selectors. They are mutually exclusive — pass exactly one. The decision
matrix:

| Goal                                                  | Command                                            |
| ----------------------------------------------------- | -------------------------------------------------- |
| Install one specific skill                            | `frontmcp skills install <name> -p claude`         |
| Install every skill in the catalog                    | `frontmcp skills install --all -p claude`          |
| Install all skills in a category (e.g. `development`) | `frontmcp skills install -c development -p claude` |
| Install all skills with a tag (e.g. `middleware`)     | `frontmcp skills install -t middleware -p codex`   |
| Install all skills to a non-default directory         | `frontmcp skills install --all -d ./custom-skills` |

Examples:

```bash
# Onboard a new repo: install everything for Claude Code
frontmcp skills install --all -p claude

# Scaffold a tools-focused project: only the development category
frontmcp skills install -c development -p claude

# Cross-IDE setup: install middleware skills into a Codex project
frontmcp skills install -t middleware -p codex

# Mono-repo with a shared skills folder
frontmcp skills install --all -d ./shared/.claude/skills
```

> **Heads up:** `--all` / `--tag` / `--category` make `[name]` optional. Pass
> exactly one bulk selector OR a `[name]`; combining a positional name with a
> bulk flag is rejected.

## Installing project-defined skills (`@Skill`)

The same `frontmcp skills install` command can install **your project's
own** `@Skill`-decorated entries — not just the framework catalog. Use
this when you ship a FrontMCP server that registers skills (via the
`@Skill` decorator or the `skill()` helper — see `create-skill`) and
want end users to drop those skills onto Claude Code's filesystem.

| Flag                   | When to use it                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `--from-entry <path>`  | Resolve `@Skill` entries from a local entry file (`src/main.ts`, etc.) in the current project |
| `--from-package <pkg>` | Resolve `@Skill` entries from an installed package's main entry (works with `npx` workflows)  |

The command bundles the entry once via esbuild, boots the SDK with the
same in-memory client that `frontmcp build` uses, and enumerates every
`@Skill` entry. Each entry's instructions file (and any `references/` /
`examples/` / `scripts/` / `assets/` resource directories) is copied
under `.claude/skills/<skill-name>/`. If the source instructions file
has no YAML frontmatter, the CLI prepends one synthesized from the
`@Skill` decorator metadata (`name`, `description`, `tags`, `license`)
so Claude Code's filesystem loader picks the skill up.

```bash
# From a project checkout: install one named skill
frontmcp skills install example-project --from-entry src/main.ts -p claude

# Install every @Skill the project exposes
frontmcp skills install --from-entry src/main.ts --all -p claude

# From a published package the user has installed:
frontmcp skills install --from-package my-frontmcp-server --all -p claude
npx my-frontmcp-server # ... once installed, skills resolve through `my-frontmcp-server`'s main entry
frontmcp skills install --from-package my-frontmcp-server example-project -p claude
```

Selectors and constraints:

- Pass **either** `<name>` **or** `--all`. `--tag` / `--category` are
  catalog-only and are rejected when `--from-entry` / `--from-package` is
  set — the project's `@Skill` list is the authoritative source.
- `--from-entry` and `--from-package` are mutually exclusive.
- The CLAUDE.md auto-generated `<!-- frontmcp:skills -->` block lists
  every installed skill in `.claude/skills/`, catalog **and**
  project-defined together. Re-running install keeps the block coherent.

> **Tip:** This is the lightest path for shipping a project's own skills.
> If you also want to ship slash commands, environment hints, and a
> `.claude-plugin/plugin.json` manifest in one shot, use the per-bin
> `<bin> install -p claude` (see `frontmcp-deployment`) — it wraps the
> same enumeration plus the rest of the plugin surface.

## Other AI clients (Cursor / Windsurf / Copilot)

For IDEs that don't natively load `SKILL.md` files, `frontmcp skills
export` converts a skill into the target IDE's native rule format and
writes it into the current directory (or `--out <dir>`).

| Target     | Output path (per skill, relative to `--out` / cwd) | Loaded by      |
| ---------- | -------------------------------------------------- | -------------- |
| `cursor`   | `.cursor/rules/<skill>.mdc`                        | Cursor         |
| `windsurf` | `.windsurfrules` (single file)                     | Windsurf       |
| `copilot`  | `.github/instructions/<skill>.md`                  | GitHub Copilot |

```bash
# Cursor: export one skill → .cursor/rules/frontmcp-development.mdc
frontmcp skills export --name frontmcp-development --target cursor

# Windsurf: export every skill into a single .windsurfrules in the cwd
frontmcp skills export --all --target windsurf

# Copilot: export every skill, one file per skill, under .github/instructions/
frontmcp skills export --all --target copilot
```

> Today `--provider` on `install` accepts `claude` and `codex` only.
> Cursor / Windsurf / Copilot integration goes through `export` instead
> because those clients consume rule files, not skill packages.

## Publishing to marketplaces

`frontmcp skills publish <name>` ships a skill to a public catalog so
other developers can discover and install it.

| Target     | Marketplace           | Token env var    |
| ---------- | --------------------- | ---------------- |
| `smithery` | <https://smithery.ai> | `SMITHERY_TOKEN` |
| `glama`    | <https://glama.ai>    | `GLAMA_TOKEN`    |

The CLI reads the token from the matching env var by default; override
with `--token <value>`. Use `--dry-run` to inspect the request payload
before submitting.

```bash
# Inspect the request without sending it
frontmcp skills publish frontmcp-development --target smithery --dry-run

# Publish to Smithery with a repo link (token from SMITHERY_TOKEN env)
SMITHERY_TOKEN=sk_xxx frontmcp skills publish frontmcp-development \
  --target smithery \
  --repository https://github.com/me/my-frontmcp-server

# Publish to Glama with an explicit token
frontmcp skills publish frontmcp-development \
  --target glama \
  --token "$GLAMA_TOKEN"
```

## Two Approaches: Static vs Dynamic

### Static Installation (Copy to Disk)

Install skills once — they live in your project and are always available:

```bash
# Install for Claude Code
frontmcp skills install frontmcp-setup --provider claude
frontmcp skills install frontmcp-development --provider claude
frontmcp skills install frontmcp-config --provider claude

# Install for Codex
frontmcp skills install frontmcp-development --provider codex
```

**Directory structure after install:**

```text
my-project/
├── .claude/
│   └── skills/
│       ├── frontmcp-setup/
│       │   ├── SKILL.md
│       │   └── references/
│       ├── frontmcp-development/
│       │   ├── SKILL.md
│       │   └── references/
│       └── frontmcp-config/
│           ├── SKILL.md
│           └── references/
├── .codex/
│   └── skills/
│       └── frontmcp-development/
│           ├── SKILL.md
│           └── references/
└── src/
    └── ...
```

### Dynamic Search (On-Demand via CLI)

Use the CLI to search and show skills on demand — no installation needed:

```bash
# Search for what you need
frontmcp skills search "how to create a tool with zod"

# Pipe skill content directly into context
frontmcp skills read frontmcp-development
```

This works because `frontmcp skills read` outputs the full SKILL.md content to stdout.

## Comparison: Static vs Dynamic

| Aspect            | Static Install                        | Dynamic CLI Search                              |
| ----------------- | ------------------------------------- | ----------------------------------------------- |
| **Setup**         | `frontmcp skills install <name>` once | No setup — just use `frontmcp skills search`    |
| **Availability**  | Always loaded by AI agent             | On-demand, requires CLI invocation              |
| **Context usage** | Skills in system prompt (uses tokens) | Only loaded when searched (saves tokens)        |
| **Updates**       | Re-install to update                  | Uses catalog bundled with the installed package |
| **Offline**       | Works offline after install           | Needs catalog available                         |
| **Best for**      | Core skills you use daily             | Occasional reference, exploration               |
| **Token cost**    | Higher (all installed skills loaded)  | Lower (only searched skills loaded)             |

### Recommended Approach

**Install 2-4 core skills statically** for your most common workflows, and use dynamic search for everything else:

```bash
# Core skills — install statically
frontmcp skills install frontmcp-setup --provider claude
frontmcp skills install frontmcp-development --provider claude
frontmcp skills install frontmcp-config --provider claude

# Everything else — search on demand
frontmcp skills search "deploy to vercel"
frontmcp skills search "rate limiting"
frontmcp skills read frontmcp-deployment
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
frontmcp skills list --category setup        # Project setup and scaffolding
frontmcp skills list --category config       # Server configuration (transport, HTTP, throttle, auth)
frontmcp skills list --category development  # Creating tools, resources, prompts, agents, skills
frontmcp skills list --category deployment   # Build and deploy (node, vercel, lambda, cloudflare, cli, browser, sdk)
frontmcp skills list --category testing      # Testing with Jest and @frontmcp/testing
frontmcp skills list --category guides       # End-to-end examples and best practices
```

## Common Patterns

| Pattern                       | Correct                                                                    | Incorrect                                                  | Why                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Installing a skill            | `frontmcp skills install frontmcp-development --provider claude`           | `cp node_modules/.../SKILL.md .claude/skills/`             | The CLI handles directory creation, naming, and reference files automatically                          |
| Bulk install (entire catalog) | `frontmcp skills install --all --provider claude`                          | Loop over `frontmcp skills install <name>` per skill name  | `--all` resolves the manifest in a single pass and writes consistently into the provider directory     |
| Bulk install (subset)         | `frontmcp skills install --category development --provider claude`         | `frontmcp skills install --all` followed by manual cleanup | `--category`/`--tag` filter at install time so you only ship the skills you need                       |
| Searching skills              | `frontmcp skills search "oauth authentication"`                            | `frontmcp skills list \| grep oauth`                       | Search uses weighted text matching (description 3x, tags 2x) for better relevance                      |
| Choosing delivery mode        | Install 2-4 core skills statically; search the rest on demand              | Install every skill statically into the project            | Static skills consume tokens on every agent invocation; keep the set small                             |
| Updating an installed skill   | `frontmcp skills install frontmcp-development --provider claude` (re-run)  | Manually editing the installed SKILL.md file               | Re-installing overwrites with the catalog bundled in the installed CLI version and preserves structure |
| Filtering by category         | `frontmcp skills list --category deployment`                               | `frontmcp skills search "deployment"`                      | `--category` uses the manifest taxonomy; search is for free-text queries                               |
| Skills-unaware IDE (Cursor)   | `frontmcp skills export --name <skill> --target cursor`                    | `frontmcp skills install <skill> --provider cursor`        | Cursor / Windsurf / Copilot consume rule files; `install` only writes `SKILL.md` packages              |
| Publishing                    | `frontmcp skills publish <name> --dry-run` first, then without `--dry-run` | Submitting directly without inspecting the payload         | `--dry-run` prints the exact endpoint + body so you can audit before submitting credentials            |

## Verification Checklist

### Configuration

- [ ] FrontMCP CLI is installed and available on PATH (`frontmcp --version`)
- [ ] Target provider directory exists or will be created (`.claude/skills/` or `.codex/skills/`)
- [ ] Desired skills are listed in `frontmcp skills list` output
- [ ] Bundle preset matches project needs (`minimal`, `recommended`, or `full`)

### Runtime

- [ ] Installed skills appear in the correct provider directory after `frontmcp skills install`
- [ ] `frontmcp skills read <name>` outputs the full SKILL.md content to stdout
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

## Examples

| Example                                                                                         | Level        | Description                                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| [`bundle-presets-scaffolding`](../examples/frontmcp-skills-usage/bundle-presets-scaffolding.md) | Intermediate | Use `--skills` flag during project creation to install a skill bundle preset.                 |
| [`install-and-search-skills`](../examples/frontmcp-skills-usage/install-and-search-skills.md)   | Basic        | Install skills statically for Claude Code and use dynamic CLI search for on-demand discovery. |

> See all examples in [`examples/frontmcp-skills-usage/`](../examples/frontmcp-skills-usage/)

## Reference

- **Docs:** <https://docs.agentfront.dev/frontmcp/servers/skills>
- **Related skills:** `frontmcp-setup`, `frontmcp-development`, `frontmcp-config`, `frontmcp-deployment`
