---
name: frontmcp-setup
description: "Domain router for project setup and scaffolding \u2014 new projects, project structure, Nx workspaces, storage backends, multi-app composition, and the skills system. Use when starting or organizing a FrontMCP project."
tags: [router, setup, scaffold, project, nx, redis, sqlite, structure, guide]
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

| Scenario                                      | Reference                                    | Description                                                            |
| --------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| Scaffold a new project with `frontmcp create` | `references/setup-project.md`                | CLI scaffolder, manual setup, deployment-specific config               |
| Organize a standalone (non-Nx) project        | `references/project-structure-standalone.md` | File layout, naming conventions (`<name>.<type>.ts`), folder hierarchy |
| Organize an Nx monorepo                       | `references/project-structure-nx.md`         | apps/, libs/, servers/ layout, generators, dependency rules            |
| Set up Redis for production storage           | `references/setup-redis.md`                  | Docker Redis, Vercel KV, pub/sub for subscriptions                     |
| Set up SQLite for local development           | `references/setup-sqlite.md`                 | WAL mode, migration helpers, encryption                                |
| Compose multiple apps into one server         | `references/multi-app-composition.md`        | `@FrontMcp` with multiple `@App` classes, cross-app providers          |
| Use Nx build, test, and CI commands           | `references/nx-workflow.md`                  | `nx build`, `nx test`, `nx run-many`, caching, affected commands       |
| Browse, install, and manage skills            | `references/frontmcp-skills-usage.md`        | CLI commands, bundles, categories, search                              |

## Recommended Reading Order

1. **`references/setup-project.md`** — Start here for any new project
2. **`references/project-structure-standalone.md`** or **`references/project-structure-nx.md`** — Choose your layout
3. **`references/setup-redis.md`** or **`references/setup-sqlite.md`** — Add storage if needed
4. **`references/multi-app-composition.md`** — Scale to multiple apps (when needed)
5. **`references/nx-workflow.md`** — Nx-specific build and CI commands (if using Nx)
6. **`references/frontmcp-skills-usage.md`** — Learn the skills system

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
- [ ] Tests pass with `jest` or `nx test`

## Troubleshooting

| Problem                  | Cause                            | Solution                                                              |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------- |
| `frontmcp create` fails  | Missing Node.js 24+ or npm/yarn  | Install Node.js 24+ and ensure npm/yarn is available                  |
| Server fails to start    | `main.ts` missing default export | Add `export default MyServerClass` to `main.ts`                       |
| Redis connection refused | Redis not running or wrong URL   | Start Redis (`docker compose up redis`) or fix `REDIS_URL` env var    |
| Nx generator not found   | `@frontmcp/nx` not installed     | Run `npm install -D @frontmcp/nx`                                     |
| Skills not loading       | Skills placed in wrong directory | Catalog skills go in top-level `skills/`, app skills in `src/skills/` |

## Reference

- [Getting Started](https://docs.agentfront.dev/frontmcp/getting-started/quickstart)
- Domain routers: `frontmcp-development`, `frontmcp-deployment`, `frontmcp-testing`, `frontmcp-config`, `frontmcp-guides`
