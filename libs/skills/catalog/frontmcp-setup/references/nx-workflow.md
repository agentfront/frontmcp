---
name: nx-workflow
description: Scaffold, build, test, and deploy FrontMCP projects using the @frontmcp/nx plugin in a monorepo
---

# Nx Monorepo Workflow for FrontMCP

Use the `@frontmcp/nx` plugin to scaffold, build, test, and deploy FrontMCP projects in an Nx monorepo. The plugin provides generators for every FrontMCP primitive (tools, resources, prompts, skills, agents, plugins, adapters, providers, flows, jobs, workflows) and deployment shells for multiple targets.

## When to Use This Skill

### Must Use

- Your project contains multiple apps or shared libraries in a monorepo structure
- You need fine-grained build caching and affected-only testing in CI
- You are scaffolding a new FrontMCP workspace with multiple deployment targets

### Recommended

- You want generator-based scaffolding for every FrontMCP primitive (tools, resources, prompts, skills, etc.)
- You need to visualize and manage complex dependency graphs across projects
- Your team benefits from parallelized builds and consistent project structure

### Skip When

- Your project is a single standalone MCP server with no shared libraries -- use `frontmcp create` instead
- You are adding FrontMCP to an existing non-Nx build system (Turborepo, Lerna) -- use `setup-project` instead
- You only need to configure storage or auth without workspace scaffolding -- use `setup-sqlite` or `setup-redis` instead

> **Decision:** Use this skill when managing a multi-project FrontMCP monorepo; skip it for single-server projects.

## Step 1 -- Initialize the Workspace

### Option A: Scaffold a new Nx workspace with the FrontMCP CLI

```bash
npx frontmcp create my-project --nx
```

This creates a full Nx workspace with `@frontmcp/nx` pre-installed, sample app, and workspace configuration.

### Option B: Add FrontMCP to an existing Nx workspace

Install the plugin:

```bash
yarn add -D @frontmcp/nx
```

Then initialize the workspace structure:

```bash
nx g @frontmcp/nx:workspace my-workspace
```

The workspace generator creates the directory structure (`apps/`, `libs/`, `servers/`) and base configuration. It accepts these options:

| Option            | Type                        | Default    | Description                      |
| ----------------- | --------------------------- | ---------- | -------------------------------- |
| `name`            | `string`                    | (required) | Workspace name                   |
| `packageManager`  | `'npm' \| 'yarn' \| 'pnpm'` | `'npm'`    | Package manager to use           |
| `skipInstall`     | `boolean`                   | `false`    | Skip package installation        |
| `skipGit`         | `boolean`                   | `false`    | Skip git initialization          |
| `createSampleApp` | `boolean`                   | `true`     | Create a sample demo application |

## Step 2 -- Generate Apps and Libraries

### Generate an App

```bash
nx g @frontmcp/nx:app my-app
```

Creates an `@App`-decorated class in `apps/my-app/` with a tools directory, barrel exports, and project configuration. The `--project` flag is not needed for app generation since the app is the project.

### Generate a Shared Library

```bash
nx g @frontmcp/nx:lib my-lib
```

Creates a shared library in `libs/my-lib/` with TypeScript configuration, Jest setup, and barrel exports. Use libraries for shared providers, utilities, and types that multiple apps consume.

### Generate a Server (Deployment Shell)

```bash
nx g @frontmcp/nx:server my-server --deploymentTarget=node --apps=my-app
```

Creates a `@FrontMcp`-decorated server class in `servers/my-server/` that composes one or more apps. The server is the deployment unit.

| Option             | Type                                             | Default          | Description                           |
| ------------------ | ------------------------------------------------ | ---------------- | ------------------------------------- |
| `name`             | `string`                                         | (required)       | Server name                           |
| `apps`             | `string`                                         | (required)       | Comma-separated app names to compose  |
| `deploymentTarget` | `'node' \| 'vercel' \| 'lambda' \| 'cloudflare'` | `'node'`         | Deployment target platform            |
| `directory`        | `string`                                         | `servers/<name>` | Override the default directory        |
| `redis`            | `'docker' \| 'existing' \| 'none'`               | `'none'`         | Redis setup option (node target only) |
| `skills`           | `'recommended' \| 'minimal' \| 'full' \| 'none'` | `'recommended'`  | Skills bundle to include              |

## Step 3 -- Generate MCP Primitives

All primitive generators require `--project` to specify which app receives the generated file. Each generator creates the implementation file, a `.spec.ts` test file, and updates barrel exports.

### Tool

```bash
nx g @frontmcp/nx:tool my-tool --project=my-app
```

Creates a `@Tool`-decorated class extending `ToolContext` in `apps/my-app/src/tools/`. Use the `--directory` option to place it in a subdirectory within `src/tools/`.

### Resource

```bash
nx g @frontmcp/nx:resource my-resource --project=my-app
```

Creates a `@Resource`-decorated class extending `ResourceContext` in `apps/my-app/src/resources/`.

### Prompt

```bash
nx g @frontmcp/nx:prompt my-prompt --project=my-app
```

Creates a `@Prompt`-decorated class extending `PromptContext` in `apps/my-app/src/prompts/`.

### Skill (Class-Based)

```bash
nx g @frontmcp/nx:skill my-skill --project=my-app
```

Creates a `@Skill`-decorated class extending `SkillContext` in `apps/my-app/src/skills/`.

### Skill (SKILL.md Directory)

```bash
nx g @frontmcp/nx:skill-dir my-skill --project=my-app
```

Creates a `SKILL.md`-based skill directory in `apps/my-app/src/skills/my-skill/` with a template SKILL.md file. Use this for declarative skills that are defined by markdown instructions rather than code.

### Agent

```bash
nx g @frontmcp/nx:agent my-agent --project=my-app
```

Creates an `@Agent`-decorated class in `apps/my-app/src/agents/`. Agents are autonomous AI components with their own LLM providers and isolated scopes, automatically exposed as `use-agent:<agent_id>` tools.

### Plugin

```bash
nx g @frontmcp/nx:plugin my-plugin --project=my-app
```

Creates a `@Plugin` class extending `DynamicPlugin` in `apps/my-app/src/plugins/`. Plugins participate in lifecycle events and can contribute additional capabilities.

### Adapter

```bash
nx g @frontmcp/nx:adapter my-adapter --project=my-app
```

Creates an `@Adapter` class extending `DynamicAdapter` in `apps/my-app/src/adapters/`. Adapters convert external definitions (OpenAPI, Lambda, etc.) into generated tools, resources, and prompts.

### Provider

```bash
nx g @frontmcp/nx:provider my-provider --project=my-app
```

Creates a `@Provider` class in `apps/my-app/src/providers/`. Providers are named singletons resolved via DI (e.g., database pools, API clients, config).

### Flow

```bash
nx g @frontmcp/nx:flow my-flow --project=my-app
```

Creates a `@Flow` class extending `FlowBase` in `apps/my-app/src/flows/`. Flows define execution pipelines with hooks and stages.

### Job

```bash
nx g @frontmcp/nx:job my-job --project=my-app
```

Creates a `@Job` class in `apps/my-app/src/jobs/`. Jobs are pure executable units with strict input/output schemas.

### Workflow

```bash
nx g @frontmcp/nx:workflow my-workflow --project=my-app
```

Creates a `@Workflow` class in `apps/my-app/src/workflows/`. Workflows connect jobs into managed steps with triggers.

### Auth Provider

```bash
nx g @frontmcp/nx:auth-provider my-auth --project=my-app
```

Creates an `@AuthProvider` class in `apps/my-app/src/auth-providers/`. Auth providers handle session-based authentication (e.g., GitHub OAuth, Google OAuth).

## Step 4 -- Build and Test

### Build a Single Project

```bash
nx build my-server
```

Builds the server and all its dependencies in the correct order. Nx caches build outputs so subsequent builds of unchanged projects are instant.

### Test a Single Project

```bash
nx test my-app
```

Runs Jest tests for the specified project. Test files must use `.spec.ts` extension (not `.test.ts`).

### Build All Projects

```bash
nx run-many -t build
```

Builds every project in the workspace. Nx parallelizes independent builds automatically.

### Test All Projects

```bash
nx run-many -t test
```

Runs tests for every project in the workspace.

### Test Only Affected Projects

```bash
nx affected -t test
```

Runs tests only for projects affected by changes since the last commit (or since the base branch). This is the fastest way to validate changes in CI.

### Build Only Affected Projects

```bash
nx affected -t build
```

### Run Multiple Targets

```bash
nx run-many -t build,test,lint
```

## Step 5 -- Workspace Structure

After scaffolding, the workspace follows this directory layout:

```text
my-project/
  apps/
    my-app/
      src/
        tools/         # @Tool classes
        resources/     # @Resource classes
        prompts/       # @Prompt classes
        skills/        # @Skill classes and SKILL.md dirs
        agents/        # @Agent classes
        plugins/       # @Plugin classes
        adapters/      # @Adapter classes
        providers/     # @Provider classes
        flows/         # @Flow classes
        jobs/          # @Job classes
        workflows/     # @Workflow classes
        auth-providers/ # @AuthProvider classes
        my-app.app.ts  # @App class
        index.ts       # barrel exports
      project.json
      tsconfig.json
      jest.config.ts
  libs/
    my-lib/
      src/
        index.ts
      project.json
  servers/
    my-server/
      src/
        main.ts        # @FrontMcp server (default export)
      project.json
      Dockerfile       # (node target)
  nx.json
  tsconfig.base.json
  package.json
```

## Step 6 -- Development Workflow

### Serve in Development

```bash
nx serve my-server
```

Or use the FrontMCP dev command:

```bash
nx dev my-server
```

### Generate, Build, and Test a New Feature

A typical workflow for adding a new tool:

```bash
# 1. Generate the tool scaffold
nx g @frontmcp/nx:tool calculate-tax --project=billing-app

# 2. Implement the tool logic in apps/billing-app/src/tools/calculate-tax.tool.ts

# 3. Run tests for the affected app
nx test billing-app

# 4. Build the server that includes this app
nx build billing-server

# 5. Or test everything affected by your changes
nx affected -t test
```

### Visualize the Project Graph

```bash
nx graph
```

Opens an interactive visualization of project dependencies in your browser. Useful for understanding how apps, libs, and servers relate to each other.

## Generator Reference

Complete list of all `@frontmcp/nx` generators from `generators.json`:

| Generator       | Command                                                  | Description                                                          |
| --------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| `workspace`     | `nx g @frontmcp/nx:workspace <name>`                     | Scaffold a full FrontMCP Nx monorepo with apps/, libs/, and servers/ |
| `app`           | `nx g @frontmcp/nx:app <name>`                           | Generate a FrontMCP application in apps/                             |
| `lib`           | `nx g @frontmcp/nx:lib <name>`                           | Generate a shared library in libs/                                   |
| `server`        | `nx g @frontmcp/nx:server <name> --apps=<apps>`          | Generate a deployment shell in servers/                              |
| `tool`          | `nx g @frontmcp/nx:tool <name> --project=<app>`          | Generate a @Tool class                                               |
| `resource`      | `nx g @frontmcp/nx:resource <name> --project=<app>`      | Generate a @Resource or @ResourceTemplate class                      |
| `prompt`        | `nx g @frontmcp/nx:prompt <name> --project=<app>`        | Generate a @Prompt class                                             |
| `skill`         | `nx g @frontmcp/nx:skill <name> --project=<app>`         | Generate a @Skill class                                              |
| `skill-dir`     | `nx g @frontmcp/nx:skill-dir <name> --project=<app>`     | Generate a SKILL.md-based skill directory                            |
| `agent`         | `nx g @frontmcp/nx:agent <name> --project=<app>`         | Generate an @Agent class                                             |
| `plugin`        | `nx g @frontmcp/nx:plugin <name> --project=<app>`        | Generate a @Plugin class extending DynamicPlugin                     |
| `adapter`       | `nx g @frontmcp/nx:adapter <name> --project=<app>`       | Generate an @Adapter class extending DynamicAdapter                  |
| `provider`      | `nx g @frontmcp/nx:provider <name> --project=<app>`      | Generate a @Provider class for dependency injection                  |
| `flow`          | `nx g @frontmcp/nx:flow <name> --project=<app>`          | Generate a @Flow class extending FlowBase                            |
| `job`           | `nx g @frontmcp/nx:job <name> --project=<app>`           | Generate a @Job class                                                |
| `workflow`      | `nx g @frontmcp/nx:workflow <name> --project=<app>`      | Generate a @Workflow class                                           |
| `auth-provider` | `nx g @frontmcp/nx:auth-provider <name> --project=<app>` | Generate an @AuthProvider class                                      |

## Common Patterns

| Pattern                    | Correct                                                 | Incorrect                              | Why                                                                                       |
| -------------------------- | ------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| Primitive generator target | `nx g @frontmcp/nx:tool my-tool --project=my-app`       | `nx g @frontmcp/nx:tool my-tool`       | All primitive generators require `--project` to specify which app receives the file       |
| Test file naming           | `my-tool.tool.spec.ts`                                  | `my-tool.tool.test.ts`                 | FrontMCP enforces `.spec.ts` extension; `.test.ts` files are not picked up by Jest config |
| Affected-only CI testing   | `nx affected -t test`                                   | `nx run-many -t test`                  | `affected` only runs tests for changed projects, saving CI time and compute               |
| Server composition         | `nx g @frontmcp/nx:server my-server --apps=app-a,app-b` | Manually importing apps in `main.ts`   | The server generator wires app composition and deployment config automatically            |
| Build before deploy        | `nx build my-server` (builds server + all deps)         | Building each lib and app individually | Nx resolves the dependency graph and builds in the correct order with caching             |

## Verification Checklist

### Workspace Setup

- [ ] `@frontmcp/nx` is listed in `devDependencies`
- [ ] `nx.json` exists at workspace root with valid configuration
- [ ] `apps/`, `libs/`, and `servers/` directories exist

### Generation

- [ ] Generated files are placed in the correct directory (`apps/<app>/src/<type>/`)
- [ ] Barrel exports (`index.ts`) are updated after each generator run
- [ ] `.spec.ts` test file is created alongside each generated class

### Build and Test

- [ ] `nx build <server>` completes without TypeScript errors or warnings
- [ ] `nx test <app>` passes with 95%+ coverage
- [ ] `nx affected -t test` correctly identifies changed projects

### Development Workflow

- [ ] `nx serve <server>` or `nx dev <server>` starts the server successfully
- [ ] `nx graph` renders the project dependency graph in the browser

## Troubleshooting

| Problem                                        | Cause                                                       | Solution                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Cannot find module '@frontmcp/nx'`            | Plugin not installed                                        | Run `yarn add -D @frontmcp/nx` and ensure it appears in `devDependencies`                            |
| Generator creates files in the wrong directory | Missing or incorrect `--project` flag                       | Always pass `--project=<app-name>` for primitive generators; verify the app exists in `apps/`        |
| `nx affected` runs nothing despite changes     | Base branch not configured or no dependency link            | Check `nx.json` for `defaultBase` setting; verify the changed file belongs to a project in the graph |
| Build fails with circular dependency error     | Library A imports from Library B and vice versa             | Use `nx graph` to visualize the cycle; extract shared code into a new library                        |
| Cache not working (full rebuild every time)    | Missing or misconfigured `cacheableOperations` in `nx.json` | Ensure `build`, `test`, and `lint` are listed in `targetDefaults` with `cache: true`                 |

## Examples

| Example                                                                         | Level        | Description                                                                                                   |
| ------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| [`build-test-affected`](../examples/nx-workflow/build-test-affected.md)         | Intermediate | Use Nx commands for efficient building, testing, and CI with affected-only execution.                         |
| [`multi-server-deployment`](../examples/nx-workflow/multi-server-deployment.md) | Advanced     | Generate multiple servers in an Nx workspace, each composing different apps for different deployment targets. |
| [`scaffold-and-generate`](../examples/nx-workflow/scaffold-and-generate.md)     | Basic        | Initialize an Nx workspace and use generators to scaffold an app with tools, resources, and a server.         |

> See all examples in [`examples/nx-workflow/`](../examples/nx-workflow/)

## Reference

- **Docs:** [Nx Plugin Overview](https://docs.agentfront.dev/frontmcp/nx-plugin/overview)
- **Related skills:** `setup-project`, `setup-sqlite`, `setup-redis`
