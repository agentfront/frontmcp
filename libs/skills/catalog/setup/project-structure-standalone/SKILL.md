---
name: project-structure-standalone
description: Best practices for organizing a standalone FrontMCP project -- file layout, naming conventions, and folder hierarchy. Use when scaffolding with frontmcp create or organizing an existing standalone project.
tags: [project, structure, standalone, organization, best-practices]
priority: 8
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/getting-started/quickstart
---

# Standalone Project Structure

When you run `frontmcp create`, the CLI scaffolds a standalone project with the following layout:

```
my-project/
├── src/
│   ├── main.ts              # @FrontMcp server entry (default export)
│   ├── my-app.app.ts        # @App class
│   ├── tools/               # @Tool classes (*.tool.ts)
│   ├── resources/            # @Resource classes (*.resource.ts)
│   ├── prompts/              # @Prompt classes (*.prompt.ts)
│   ├── agents/               # @Agent classes (*.agent.ts)
│   ├── skills/               # @Skill classes or SKILL.md dirs
│   ├── providers/            # @Provider classes (*.provider.ts)
│   ├── plugins/              # @Plugin classes (*.plugin.ts)
│   └── jobs/                 # @Job classes (*.job.ts)
├── e2e/                      # E2E tests (*.e2e.spec.ts)
├── skills/                   # Catalog skills (from --skills flag)
├── package.json
├── tsconfig.json
└── .env.example
```

## File Naming Conventions

Every entity type uses a consistent `<name>.<type>.ts` pattern:

| Entity   | File Pattern    | Example                      |
| -------- | --------------- | ---------------------------- |
| Tool     | `*.tool.ts`     | `fetch-weather.tool.ts`      |
| Resource | `*.resource.ts` | `user-profile.resource.ts`   |
| Prompt   | `*.prompt.ts`   | `summarize.prompt.ts`        |
| Agent    | `*.agent.ts`    | `research.agent.ts`          |
| Skill    | `*.skill.ts`    | `calendar.skill.ts`          |
| Provider | `*.provider.ts` | `database.provider.ts`       |
| Plugin   | `*.plugin.ts`   | `logging.plugin.ts`          |
| Job      | `*.job.ts`      | `cleanup.job.ts`             |
| Test     | `*.spec.ts`     | `fetch-weather.tool.spec.ts` |
| E2E Test | `*.e2e.spec.ts` | `api.e2e.spec.ts`            |

**One class per file.** Keep each tool, resource, prompt, etc. in its own file.

## Entry Point: main.ts

`main.ts` default-exports the `@FrontMcp` server class. This is the file FrontMCP loads at startup:

```typescript
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './my-app.app';

@FrontMcp({
  info: { name: 'my-project', version: '1.0.0' },
  apps: [MyApp],
})
class MyServer {}

export default MyServer;
```

## App Class

The `@App` class groups tools, resources, prompts, plugins, and providers together:

```typescript
import { App } from '@frontmcp/sdk';
import { FetchWeatherTool } from './tools/fetch-weather.tool';
import { DatabaseProvider } from './providers/database.provider';

@App({
  name: 'my-app',
  tools: [FetchWeatherTool],
  providers: [DatabaseProvider],
})
export class MyApp {}
```

## Development Workflow

### Start development server

```bash
frontmcp dev
```

Watches for file changes and restarts automatically.

### Build for production

```bash
frontmcp build --target node
frontmcp build --target bun
frontmcp build --target cloudflare-workers
```

The `--target` flag determines the output format and runtime optimizations.

### Run tests

```bash
# Unit tests
jest

# E2E tests
jest --config e2e/jest.config.ts
```

## Organizing by Feature

For larger standalone projects, group related entities into feature folders:

```
src/
├── main.ts
├── my-app.app.ts
├── billing/
│   ├── create-invoice.tool.ts
│   ├── invoice.resource.ts
│   └── billing.provider.ts
├── users/
│   ├── lookup-user.tool.ts
│   ├── user-profile.resource.ts
│   └── users.provider.ts
└── plugins/
    └── logging.plugin.ts
```

Feature folders work well when your project has multiple related tools and resources that share a domain.

## Skills Directory

The top-level `skills/` directory (outside `src/`) holds catalog skills added via the `--skills` flag during `frontmcp create`. Each skill is a folder containing a `SKILL.md` file:

```
skills/
├── create-tool/
│   └── SKILL.md
└── setup-project/
    └── SKILL.md
```

Skills inside `src/skills/` are `@Skill` classes that are part of your application code.
