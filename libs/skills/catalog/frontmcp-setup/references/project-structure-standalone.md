---
name: project-structure-standalone
description: File layout, naming conventions, and dev workflow for standalone FrontMCP projects
---

# Standalone Project Structure

## When to Use This Skill

### Must Use

- Scaffolding a new FrontMCP project with `frontmcp create` and need to understand the generated layout
- Organizing tools, resources, prompts, and providers in a standalone (non-Nx) project
- Setting up the `main.ts` entry point with the `@FrontMcp` server default export

### Recommended

- Adopting consistent `<name>.<type>.ts` file naming conventions across the project
- Restructuring an existing standalone project to follow FrontMCP best practices
- Organizing a growing project into feature folders with grouped domain entities

### Skip When

- You are working in an Nx monorepo with multiple apps and shared libraries (see `project-structure-nx`)
- You need to compose multiple apps into a single server (see `multi-app-composition`)
- You are creating a specific entity (tool, resource, etc.) and need its decorator API (see `create-tool`, `create-resource`)

> **Decision:** Use this skill when scaffolding or organizing a standalone FrontMCP project and you need the canonical file layout, naming conventions, and development workflow.

When you run `frontmcp create`, the CLI scaffolds a standalone project with the following layout:

```text
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
frontmcp build --target cloudflare
frontmcp build --target vercel
frontmcp build --target lambda
```

Valid targets: `cli`, `node`, `sdk`, `browser`, `cloudflare`, `vercel`, `lambda`. The `--target` flag determines the output format and runtime optimizations.

### Run tests

```bash
# Unit tests
jest

# E2E tests
jest --config e2e/jest.config.ts
```

## Organizing by Feature

For larger standalone projects, group related entities into feature folders:

```text
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

```text
skills/
├── create-tool/
│   └── SKILL.md
└── setup-project/
    └── SKILL.md
```

Skills inside `src/skills/` are `@Skill` classes that are part of your application code.

## Common Patterns

| Pattern            | Correct                                                   | Incorrect                                           | Why                                                                                   |
| ------------------ | --------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| File naming        | `fetch-weather.tool.ts` (kebab-case with type suffix)     | `FetchWeather.ts` or `fetchWeatherTool.ts`          | The `<name>.<type>.ts` convention enables tooling, generators, and consistent imports |
| Entry point        | `main.ts` with `export default MyServer`                  | Named export or no default export in `main.ts`      | FrontMCP loads the default export from the entry point at startup                     |
| One class per file | Each tool, resource, or provider in its own file          | Multiple tool classes in a single file              | Keeps files focused, simplifies imports, and aligns with generator output             |
| Feature folders    | Group related entities under `src/billing/`, `src/users/` | Flat structure with dozens of files in `src/tools/` | Feature folders scale better and make domain boundaries visible                       |
| Test files         | `fetch-weather.tool.spec.ts` (`.spec.ts` extension)       | `fetch-weather.tool.test.ts` (`.test.ts` extension) | FrontMCP convention requires `.spec.ts`; generators and CI expect this pattern        |

## Verification Checklist

### Project Structure

- [ ] `src/main.ts` exists and default-exports the `@FrontMcp` server class
- [ ] At least one `@App` class exists (e.g., `src/my-app.app.ts`)
- [ ] Entity files follow the `<name>.<type>.ts` naming convention
- [ ] Test files use the `.spec.ts` extension

### Development Workflow

- [ ] `frontmcp dev` starts the development server with file watching
- [ ] `frontmcp build --target node` produces a valid production build
- [ ] Unit tests pass with `jest`
- [ ] E2E tests (if any) are in the `e2e/` directory with `*.e2e.spec.ts` naming

### Organization

- [ ] Each entity type has its own directory (`tools/`, `resources/`, etc.) or feature folder
- [ ] Catalog skills (from `--skills` flag) are in the top-level `skills/` directory
- [ ] Application `@Skill` classes are in `src/skills/`

## Troubleshooting

| Problem                        | Cause                                                         | Solution                                                                 |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `frontmcp dev` fails to start  | `main.ts` does not default-export the `@FrontMcp` class       | Add `export default MyServer` to `main.ts`                               |
| Tool not discovered at runtime | Tool class not added to the `tools` array in `@App`           | Register the tool in the `@App` decorator's `tools` array                |
| Tests not found by Jest        | Test file uses `.test.ts` instead of `.spec.ts`               | Rename to `.spec.ts` to match the FrontMCP test file convention          |
| Build target error             | Invalid `--target` flag value                                 | Use `node`, `vercel`, `lambda`, or `cloudflare` as the target value      |
| Catalog skills not loaded      | Skills placed in `src/skills/` instead of top-level `skills/` | Move catalog `SKILL.md` directories to the top-level `skills/` directory |

## Examples

| Example                                                                                                  | Level        | Description                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| [`dev-workflow-commands`](../examples/project-structure-standalone/dev-workflow-commands.md)             | Basic        | Run the standard development workflow for a standalone FrontMCP project: dev server, build, and tests.                      |
| [`feature-folder-organization`](../examples/project-structure-standalone/feature-folder-organization.md) | Intermediate | Organize a growing standalone project into domain-specific feature folders instead of flat type-based directories.          |
| [`minimal-standalone-layout`](../examples/project-structure-standalone/minimal-standalone-layout.md)     | Basic        | Set up the canonical file structure for a standalone FrontMCP project with one app, one tool, and the required entry point. |

> See all examples in [`examples/project-structure-standalone/`](../examples/project-structure-standalone/)

## Reference

- [Quickstart Documentation](https://docs.agentfront.dev/frontmcp/getting-started/quickstart)
- Related skills: `project-structure-nx`, `multi-app-composition`, `setup-project`, `create-tool`
