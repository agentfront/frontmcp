---
name: frontmcp-setup
description: 'Use when starting, scaffolding, or organizing a FrontMCP project. Covers creating a new project (CLI scaffold or manual) for Node, Vercel, and other targets; standalone versus Nx-monorepo layout, naming conventions, generators, and dependency rules; composing multiple @App classes, ESM packages, and remote MCP servers into one server; provisioning session and storage backends (Redis, Vercel KV, SQLite with WAL and optional encryption); generating deployment-target-aware README files; and searching, installing, and managing the FrontMCP skill catalog for AI agents (Claude Code, Codex). Triggers: create a new project, how do I start, scaffold, project layout, folder structure, Nx monorepo, add Redis, set up SQLite or a database, compose apps, create a new app, manage skills.'
tags: [router, setup, scaffold, project, nx, redis, sqlite, structure, guide]
category: setup
targets: [all]
bundle: [recommended, minimal, full]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/getting-started/quickstart
---

# FrontMCP Setup Router

Entry point for project setup and scaffolding. This skill helps you find the right setup guide based on your project needs — from initial scaffolding to storage backends, project structure, and multi-app composition.

## When to Use This Skill

### Must Use

- Starting a new FrontMCP project from scratch and need to choose between standalone vs Nx monorepo
- Setting up storage backends (Redis, SQLite) for session or state management
- Organizing an existing project and need canonical directory layout guidance

### Recommended

- Onboarding to the FrontMCP project structure and naming conventions
- Setting up multi-app composition within a single server
- Understanding the skills system and how to browse, install, and manage skills

### Skip When

- You need to build specific components like tools or resources (see `frontmcp-development`)
- You need to configure transport, auth, or throttling (see `frontmcp-config`)
- You need to deploy or build for a target platform (see `frontmcp-deployment`)

> **Decision:** Use this skill when you need to CREATE or ORGANIZE a project. Use other routers when you need to build, configure, deploy, or test.

## Prerequisites

- Node.js 24+ and npm/yarn installed
- `frontmcp` CLI available globally (`npm install -g frontmcp`)

## Steps

1. Use the Scenario Routing Table below to find the right setup guide for your task
2. Scaffold your project with `frontmcp create` (standalone) or `frontmcp create --nx` (monorepo)
3. Configure storage and project structure per the relevant reference files
4. Follow the Recommended Reading Order for a complete setup walkthrough

## Scenario Routing Table

| Scenario                                      | Reference                                    | Description                                                                                    |
| --------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Scaffold a new project with `frontmcp create` | `references/setup-project.md`                | CLI scaffolder (flags: `--target`, `--redis`, `--skills <bundle>`, `--cicd`, `--nx`, `--pm`)   |
| Organize a standalone (non-Nx) project        | `references/project-structure-standalone.md` | File layout, naming conventions (`<name>.<type>.ts`), folder hierarchy                         |
| Organize an Nx monorepo                       | `references/project-structure-nx.md`         | apps/, libs/, servers/ layout, generators, dependency rules                                    |
| Set up Redis for production storage           | `references/setup-redis.md`                  | Docker Redis, Vercel KV, pub/sub for distributed subscriptions (single-server uses in-memory)  |
| Set up SQLite for local development           | `references/setup-sqlite.md`                 | WAL mode, migration helpers, encryption                                                        |
| Compose multiple apps into one server         | `references/multi-app-composition.md`        | `@FrontMcp` with multiple `@App` classes, cross-app providers                                  |
| Use Nx build, test, and CI commands           | `references/nx-workflow.md`                  | `nx build`, `nx test`, `nx run-many`, caching, affected commands                               |
| Browse, install, and manage skills            | `references/frontmcp-skills-usage.md`        | CLI commands (search, list, install, read, export, publish), bundles, categories, bulk install |
| Generate or update project README.md          | `references/readme-guide.md`                 | Deployment-target-aware README for npm, CLI, Docker, serverless                                |

## Recommended Reading Order

1. **`references/setup-project.md`** — Start here for any new project
2. **`references/project-structure-standalone.md`** or **`references/project-structure-nx.md`** — Choose your layout
3. **`references/setup-redis.md`** or **`references/setup-sqlite.md`** — Add storage if needed
4. **`references/multi-app-composition.md`** — Scale to multiple apps (when needed)
5. **`references/nx-workflow.md`** — Nx-specific build and CI commands (if using Nx)
6. **`references/frontmcp-skills-usage.md`** — Learn the skills system
7. **`references/readme-guide.md`** — Generate README for your deployment target

## Cross-Cutting Patterns

| Pattern        | Rule                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| Project type   | Standalone for single-app projects; Nx for multi-app or team projects            |
| File naming    | `<name>.<type>.ts` (e.g., `fetch-weather.tool.ts`) everywhere                    |
| Test naming    | `.spec.ts` extension (not `.test.ts`)                                            |
| Entry point    | `main.ts` must `export default` the `@FrontMcp` class                            |
| Storage choice | Redis for production/serverless; SQLite for local dev/CLI; memory for tests only |
| App boundaries | Each `@App` is a self-contained module; shared logic goes in providers           |

## Common Patterns

| Pattern               | Correct                                         | Incorrect                                    | Why                                                               |
| --------------------- | ----------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Project scaffolding   | `frontmcp create` or `frontmcp create --nx`     | Manual setup from scratch                    | CLI sets up correct structure, dependencies, and config files     |
| Entry point           | `export default class MyServer` in `main.ts`    | Named export or no default export            | FrontMCP loads the default export at startup                      |
| Storage in production | Redis or platform-native (Vercel KV, DynamoDB)  | Memory store or SQLite                       | Memory is lost on restart; SQLite doesn't work on serverless      |
| Multi-app composition | Separate `@App` classes composed in `@FrontMcp` | One giant `@App` with all components         | Separate apps enable independent testing and modular architecture |
| File organization     | Feature folders for 10+ components              | Flat `tools/` directory with dozens of files | Feature folders make domain boundaries visible                    |

## Verification Checklist

### Project Structure

- [ ] `main.ts` exists with `export default` of `@FrontMcp` class
- [ ] At least one `@App` class registered in the server
- [ ] Files follow `<name>.<type>.ts` naming convention
- [ ] Test files use `.spec.ts` extension

### Storage

- [ ] Storage backend chosen and configured (Redis/SQLite/memory)
- [ ] Connection string in environment variables, not hardcoded
- [ ] Storage accessible from the server process

### Build and Dev

- [ ] `frontmcp dev` starts successfully with file watching
- [ ] `frontmcp build --target <target>` completes without errors
- [ ] Tests pass with `frontmcp test` or `nx test`

## Troubleshooting

| Problem                  | Cause                            | Solution                                                              |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------- |
| `frontmcp create` fails  | Missing Node.js 24+ or npm/yarn  | Install Node.js 24+ and ensure npm/yarn is available                  |
| Server fails to start    | `main.ts` missing default export | Add `export default MyServerClass` to `main.ts`                       |
| Redis connection refused | Redis not running or wrong URL   | Start Redis (`docker compose up redis`) or fix `REDIS_URL` env var    |
| Nx generator not found   | `@frontmcp/nx` not installed     | Run `npm install -D @frontmcp/nx`                                     |
| Skills not loading       | Skills placed in wrong directory | Catalog skills go in top-level `skills/`, app skills in `src/skills/` |

## Examples

Each reference has matching examples under [`examples/<reference>/`](./examples/):

### `frontmcp-skills-usage`

| Example                                                                                        | Level        | Description                                                                                   |
| ---------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| [`bundle-presets-scaffolding`](./examples/frontmcp-skills-usage/bundle-presets-scaffolding.md) | Intermediate | Use `--skills` flag during project creation to install a skill bundle preset.                 |
| [`install-and-search-skills`](./examples/frontmcp-skills-usage/install-and-search-skills.md)   | Basic        | Install skills statically for Claude Code and use dynamic CLI search for on-demand discovery. |

### `multi-app-composition`

| Example                                                                                            | Level        | Description                                                                                     |
| -------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| [`local-apps-with-shared-tools`](./examples/multi-app-composition/local-apps-with-shared-tools.md) | Basic        | Compose multiple local `@App` classes into a server with shared tools available to all apps.    |
| [`per-app-auth-and-isolation`](./examples/multi-app-composition/per-app-auth-and-isolation.md)     | Advanced     | Configure mixed authentication modes and scope isolation for different apps in a single server. |
| [`remote-and-esm-apps`](./examples/multi-app-composition/remote-and-esm-apps.md)                   | Intermediate | Compose local, ESM (npm package), and remote (external MCP server) apps into a single gateway.  |

### `nx-workflow`

| Example                                                                        | Level        | Description                                                                                                   |
| ------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------- |
| [`build-test-affected`](./examples/nx-workflow/build-test-affected.md)         | Intermediate | Use Nx commands for efficient building, testing, and CI with affected-only execution.                         |
| [`multi-server-deployment`](./examples/nx-workflow/multi-server-deployment.md) | Advanced     | Generate multiple servers in an Nx workspace, each composing different apps for different deployment targets. |
| [`scaffold-and-generate`](./examples/nx-workflow/scaffold-and-generate.md)     | Basic        | Initialize an Nx workspace and use generators to scaffold an app with tools, resources, and a server.         |

### `project-structure-nx`

| Example                                                                                   | Level        | Description                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [`nx-generator-scaffolding`](./examples/project-structure-nx/nx-generator-scaffolding.md) | Basic        | Use `@frontmcp/nx` generators to scaffold tools, resources, and providers within an app, with automatic barrel export updates. |
| [`nx-workspace-with-apps`](./examples/project-structure-nx/nx-workspace-with-apps.md)     | Basic        | Scaffold an Nx monorepo with two apps and a server that composes them into a single gateway.                                   |
| [`shared-library-usage`](./examples/project-structure-nx/shared-library-usage.md)         | Intermediate | Create a shared library in an Nx monorepo and use it from multiple apps to avoid cross-app imports.                            |

### `project-structure-standalone`

| Example                                                                                                 | Level        | Description                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| [`dev-workflow-commands`](./examples/project-structure-standalone/dev-workflow-commands.md)             | Basic        | Run the standard development workflow for a standalone FrontMCP project: dev server, build, and tests.                      |
| [`feature-folder-organization`](./examples/project-structure-standalone/feature-folder-organization.md) | Intermediate | Organize a growing standalone project into domain-specific feature folders instead of flat type-based directories.          |
| [`minimal-standalone-layout`](./examples/project-structure-standalone/minimal-standalone-layout.md)     | Basic        | Set up the canonical file structure for a standalone FrontMCP project with one app, one tool, and the required entry point. |

### `readme-guide`

| Example                                                                           | Level        | Description                                                                                            |
| --------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| [`node-server-readme`](./examples/readme-guide/node-server-readme.md)             | Basic        | Generate a README for a FrontMCP server deployed as a Docker/Node.js service with tools and resources. |
| [`vercel-deployment-readme`](./examples/readme-guide/vercel-deployment-readme.md) | Intermediate | Generate a README for a FrontMCP server deployed to Vercel with Vercel KV storage.                     |

### `setup-project`

| Example                                                                            | Level        | Description                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-node-server`](./examples/setup-project/basic-node-server.md)               | Basic        | Scaffold a minimal FrontMCP server with one app and one tool, running on Node.js with HTTP transport.                                                 |
| [`cli-scaffold-with-flags`](./examples/setup-project/cli-scaffold-with-flags.md)   | Basic        | Use the `frontmcp create` CLI to scaffold a complete project non-interactively with explicit flags for deployment target, Redis, and package manager. |
| [`vercel-serverless-server`](./examples/setup-project/vercel-serverless-server.md) | Intermediate | Configure a FrontMCP server for Vercel deployment with Vercel KV storage and modern transport protocol.                                               |

### `setup-redis`

| Example                                                                                  | Level        | Description                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docker-redis-local-dev`](./examples/setup-redis/docker-redis-local-dev.md)             | Basic        | Provision Redis with Docker Compose and connect a FrontMCP server for local session storage.                                                  |
| [`hybrid-vercel-kv-with-pubsub`](./examples/setup-redis/hybrid-vercel-kv-with-pubsub.md) | Advanced     | Use Vercel KV for session storage and a separate Redis instance for pub/sub resource subscriptions in distributed multi-instance deployments. |
| [`vercel-kv-serverless`](./examples/setup-redis/vercel-kv-serverless.md)                 | Intermediate | Configure a FrontMCP server with Vercel KV as the session store for serverless deployment.                                                    |

### `setup-sqlite`

| Example                                                                           | Level        | Description                                                                                       |
| --------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| [`basic-sqlite-setup`](./examples/setup-sqlite/basic-sqlite-setup.md)             | Basic        | Configure a FrontMCP server with SQLite for local session storage with WAL mode enabled.          |
| [`encrypted-sqlite-storage`](./examples/setup-sqlite/encrypted-sqlite-storage.md) | Intermediate | Enable AES-256-GCM at-rest encryption for sensitive session data stored in SQLite.                |
| [`unix-socket-daemon`](./examples/setup-sqlite/unix-socket-daemon.md)             | Advanced     | Configure a FrontMCP daemon that listens on a unix socket and uses SQLite for persistent storage. |

## Accessing This Skill

Skills are distributed as plain SKILL.md files plus a sibling `references/`
and `examples/` tree, so consumers can pick whichever access mode fits:

| Mode               | How it works                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/frontmcp-setup/` directly from a clone of the catalog repo, or from a published `@frontmcp/skills` install. SKILL.md is the entry point.                                                                                                                                                                            |
| **`frontmcp` CLI** | `frontmcp skills list`, `frontmcp skills read frontmcp-setup`, `frontmcp skills read frontmcp-setup:references/<file>.md`, `frontmcp skills install frontmcp-setup` — no server required.                                                                                                                                                     |
| **MCP `skill://`** | When a developer mounts this skill into their own FrontMCP server (`@FrontMcp({ skills: [...] })`), the SDK exposes it via SEP-2640 resources: `skill://frontmcp-setup/SKILL.md`, `skill://frontmcp-setup/references/{file}.md`, etc. The server’s `skill://index.json` returns the SEP-2640 discovery document for everything mounted on it. |

The catalog itself is **not** an MCP server. The `skill://` URIs only resolve
when a server has been configured to host this skill.

## Reference

- [Getting Started](https://docs.agentfront.dev/frontmcp/getting-started/quickstart)
- Domain routers: `frontmcp-development`, `frontmcp-deployment`, `frontmcp-testing`, `frontmcp-config`, `frontmcp-guides`
