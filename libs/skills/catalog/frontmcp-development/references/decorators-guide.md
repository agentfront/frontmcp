# FrontMCP Decorators - Complete Reference

## Architecture Overview

FrontMCP uses a hierarchical decorator system. The nesting order is:

```text
@FrontMcp          (server root)
  +-- @App         (application module)
       +-- @Tool           (MCP tool)
       +-- @Resource       (static MCP resource)
       +-- @ResourceTemplate (parameterized resource)
       +-- @Prompt         (MCP prompt)
       +-- @Agent          (autonomous AI agent)
       +-- @Skill          (knowledge/workflow package)
       +-- @Plugin         (lifecycle plugin)
       +-- @Provider       (DI provider)
       +-- @Adapter        (external source adapter)
       +-- @Job            (long-running job)
       +-- @Workflow       (multi-step workflow)
       +-- @Flow           (custom flow)
       +-- @Hook (@Will, @Did, @Stage, @Around)
```

---

## When to Use This Skill

### Must Use

- You are building a new FrontMCP server and need to choose the correct decorator for each component
- You are reviewing or debugging decorator configuration and need to verify field names, types, or nesting hierarchy
- You are onboarding to the FrontMCP codebase and need a single reference for the full decorator architecture

### Recommended

- You are adding a new capability (tool, resource, prompt, agent, skill) to an existing server and want to confirm the correct decorator signature
- You are designing a plugin or adapter and need to understand how it integrates with the decorator hierarchy
- You are refactoring an app's module structure and need to verify which decorators belong in `@App` vs `@FrontMcp`

### Skip When

- You only need to write business logic inside an existing tool or resource (see `create-tool` reference)
- You are configuring authentication or session management without changing decorators (see `configure-auth` reference)
- You are working on CI/CD, deployment, or infrastructure that does not involve decorator choices

> **Decision:** Use this skill whenever you need to look up, choose, or validate a FrontMCP decorator -- skip it when the decorator is already chosen and you are only implementing internal logic.

---

## 1. @FrontMcp

**Purpose:** Declares the root MCP server and its global configuration.

**When to use:** Once per server, on the top-level bootstrap class.

**Key fields:**

| Field           | Description                                                                     |
| --------------- | ------------------------------------------------------------------------------- |
| `info`          | Server name, version, and description                                           |
| `apps`          | Array of `@App` classes to mount                                                |
| `redis?`        | Redis connection options                                                        |
| `plugins?`      | Global plugins                                                                  |
| `providers?`    | Global DI providers                                                             |
| `tools?`        | Standalone tools (outside apps)                                                 |
| `resources?`    | Standalone resources                                                            |
| `skills?`       | Standalone skills                                                               |
| `skillsConfig?` | Skills feature configuration (enabled, cache, auth)                             |
| `transport?`    | Transport preset ('modern', 'legacy', 'stateless-api', 'full') or config object |
| `auth?`         | Authentication mode and OAuth configuration (AuthOptionsInput)                  |
| `http?`         | HTTP server options (port, host, cors)                                          |
| `logging?`      | Logging configuration                                                           |
| `elicitation?`  | Elicitation store config                                                        |
| `sqlite?`       | SQLite storage config                                                           |
| `pubsub?`       | Pub/sub configuration                                                           |
| `jobs?`         | Job scheduler config                                                            |
| `throttle?`     | Rate limiting config                                                            |
| `pagination?`   | Pagination defaults                                                             |
| `ui?`           | UI configuration                                                                |

```typescript
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MainApp],
  transport: 'modern', // Valid presets: 'modern', 'legacy', 'stateless-api', 'full'
  http: { port: 3000 },
  plugins: [RememberPlugin],
  skillsConfig: { enabled: true },
})
class MyServer {}
```

---

## 2. @App

**Purpose:** Groups related tools, resources, prompts, agents, and skills into an application module.

**When to use:** To organize your server into logical modules. Every server has at least one app.

**Key fields:**

| Field         | Description                                           |
| ------------- | ----------------------------------------------------- |
| `name`        | Application name                                      |
| `tools?`      | Array of tool classes or function-built tools         |
| `resources?`  | Array of resource classes or function-built resources |
| `prompts?`    | Array of prompt classes or function-built prompts     |
| `agents?`     | Array of agent classes                                |
| `skills?`     | Array of skill definitions                            |
| `plugins?`    | App-scoped plugins                                    |
| `providers?`  | App-scoped DI providers                               |
| `adapters?`   | External source adapters                              |
| `auth?`       | Auth configuration                                    |
| `standalone?` | Whether the app runs independently                    |
| `jobs?`       | Job definitions                                       |
| `workflows?`  | Workflow definitions                                  |

```typescript
import { App } from '@frontmcp/sdk';

@App({
  name: 'analytics',
  tools: [QueryTool, ReportTool],
  resources: [DashboardResource],
  prompts: [SummaryPrompt],
  providers: [DatabaseProvider],
})
class AnalyticsApp {}
```

---

## 3. @Tool

**Purpose:** Defines an MCP tool that an LLM can invoke to perform actions.

**When to use:** When you need the LLM to execute a function, query data, or trigger side effects.

**Key fields:**

| Field                | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `name`               | Tool name (used in MCP protocol)                           |
| `description`        | Human-readable description for the LLM                     |
| `inputSchema`        | Zod raw shape defining input parameters                    |
| `outputSchema?`      | Zod schema for output validation                           |
| `annotations?`       | MCP tool annotations (readOnlyHint, destructiveHint, etc.) |
| `tags?`              | Categorization tags                                        |
| `hideFromDiscovery?` | Hide from tool listing                                     |
| `concurrency?`       | Max concurrent executions                                  |
| `rateLimit?`         | Rate limiting configuration                                |
| `timeout?`           | Execution timeout in ms                                    |
| `ui?`                | UI rendering hints                                         |

```typescript
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'search_users',
  description: 'Search for users by name or email',
  inputSchema: {
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(10),
  },
})
class SearchUsersTool extends ToolContext {
  async execute(input: { query: string; limit: number }) {
    const users = await this.get(UserService).search(input.query, input.limit);
    return { users };
  }
}
```

---

## 4. @Prompt

**Purpose:** Defines an MCP prompt template that generates structured messages for the LLM.

**When to use:** When you want to expose reusable prompt templates with typed arguments.

**Key fields:**

| Field          | Description                                                         |
| -------------- | ------------------------------------------------------------------- |
| `name`         | Prompt name                                                         |
| `description?` | What this prompt does                                               |
| `arguments?`   | Array of argument definitions (`{ name, description?, required? }`) |

```typescript
import { Prompt, PromptContext } from '@frontmcp/sdk';

@Prompt({
  name: 'code_review',
  description: 'Generate a code review for the given code',
  arguments: [
    { name: 'code', description: 'The code to review', required: true },
    { name: 'language', description: 'Programming language' },
  ],
})
class CodeReviewPrompt extends PromptContext {
  async execute(args: { code: string; language?: string }) {
    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Review this ${args.language ?? ''} code:\n\n${args.code}`,
          },
        },
      ],
    };
  }
}
```

---

## 5. @Resource

**Purpose:** Exposes a static MCP resource identified by a fixed URI.

**When to use:** When you need to expose data at a known, unchanging URI (e.g., config files, system status).

**Key fields:**

| Field          | Description                                  |
| -------------- | -------------------------------------------- |
| `name`         | Resource name                                |
| `uri`          | Fixed URI (e.g., `config://app/settings`)    |
| `description?` | What this resource provides                  |
| `mimeType?`    | Content MIME type (e.g., `application/json`) |

```typescript
import { Resource, ResourceContext } from '@frontmcp/sdk';

@Resource({
  name: 'app_config',
  uri: 'config://app/settings',
  description: 'Current application settings',
  mimeType: 'application/json',
})
class AppConfigResource extends ResourceContext {
  async read() {
    const config = await this.get(ConfigService).getAll();
    return { contents: [{ uri: this.uri, text: JSON.stringify(config) }] };
  }
}
```

---

## 6. @ResourceTemplate

**Purpose:** Exposes a parameterized MCP resource with URI pattern matching.

**When to use:** When resources are identified by dynamic parameters (e.g., user profiles, documents by ID).

**Key fields:**

| Field          | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `name`         | Resource template name                                          |
| `uriTemplate`  | URI template with parameters (e.g., `users://{userId}/profile`) |
| `description?` | What this resource provides                                     |
| `mimeType?`    | Content MIME type                                               |

```typescript
import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';

@ResourceTemplate({
  name: 'user_profile',
  uriTemplate: 'users://{userId}/profile',
  description: 'User profile by ID',
  mimeType: 'application/json',
})
class UserProfileResource extends ResourceContext {
  async read(uri: string, params: { userId: string }) {
    const user = await this.get(UserService).findById(params.userId);
    return { contents: [{ uri, text: JSON.stringify(user) }] };
  }
}
```

---

## 7. @Agent

**Purpose:** Defines an autonomous AI agent that uses LLMs to accomplish tasks, optionally with tools and sub-agents.

**When to use:** When you need an autonomous entity that reasons, plans, and executes multi-step tasks using LLMs.

**Key fields:**

| Field           | Description                                            |
| --------------- | ------------------------------------------------------ |
| `name`          | Agent name                                             |
| `description`   | What this agent does                                   |
| `llm`           | LLM configuration (model, provider, temperature, etc.) |
| `inputSchema?`  | Zod raw shape for agent input                          |
| `outputSchema?` | Zod schema for structured output                       |
| `tools?`        | Tools available to this agent                          |
| `agents?`       | Sub-agents for delegation                              |
| `exports?`      | What capabilities to expose externally                 |
| `swarm?`        | Multi-agent swarm configuration                        |

```typescript
import { Agent, AgentContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Agent({
  name: 'research_agent',
  description: 'Researches topics and produces summaries',
  llm: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
  inputSchema: {
    topic: z.string().describe('Topic to research'),
  },
  tools: [WebSearchTool, SummarizeTool],
})
class ResearchAgent extends AgentContext {
  async execute(input: { topic: string }) {
    return this.run(`Research and summarize: ${input.topic}`);
  }
}
```

---

## 8. @Skill

**Purpose:** Packages knowledge, instructions, and tools into a reusable workflow unit that LLMs can discover and follow.

**When to use:** When you want to bundle a set of instructions and tools into a cohesive capability that an LLM can activate.

**Key fields:**

| Field             | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `name`            | Skill name                                             |
| `description`     | What this skill enables                                |
| `instructions`    | Detailed instructions the LLM should follow            |
| `tools?`          | Tools bundled with this skill                          |
| `parameters?`     | Configurable parameters                                |
| `examples?`       | Usage examples                                         |
| `visibility?`     | Where skill is visible: `'mcp'`, `'http'`, or `'both'` |
| `toolValidation?` | Validation rules for tool usage                        |

```typescript
import { Skill } from '@frontmcp/sdk';

@Skill({
  name: 'code_migration',
  description: 'Guides migration of code between frameworks',
  instructions: `
    1. Analyze the source codebase structure
    2. Identify framework-specific patterns
    3. Generate migration plan
    4. Apply transformations using the provided tools
  `,
  tools: [AnalyzeTool, TransformTool, ValidateTool],
  visibility: 'both',
})
class CodeMigrationSkill {}
```

---

## 9. @Plugin

**Purpose:** Adds lifecycle hooks, DI providers, and context extensions to the server.

**When to use:** When you need cross-cutting concerns (logging, caching, session memory) that span multiple tools.

**Key fields:**

| Field                | Description                                                     |
| -------------------- | --------------------------------------------------------------- |
| `name`               | Plugin name                                                     |
| `providers?`         | DI providers this plugin registers                              |
| `contextExtensions?` | Extensions to add to execution contexts (e.g., `this.remember`) |
| `tools?`             | Tools provided by this plugin                                   |

```typescript
import { Plugin } from '@frontmcp/sdk';

@Plugin({
  name: 'audit-log',
  providers: [AuditLogProvider],
  contextExtensions: [installAuditExtension],
})
class AuditPlugin {}
```

---

## 10. @Adapter

**Purpose:** Integrates an external API or data source, converting it into FrontMCP tools and resources.

**When to use:** When you want to auto-generate MCP tools/resources from an external OpenAPI spec, GraphQL schema, or other source.

**Key fields:**

| Field  | Description  |
| ------ | ------------ |
| `name` | Adapter name |

```typescript
import { Adapter } from '@frontmcp/sdk';

@Adapter({ name: 'github-api' })
class GitHubAdapter {
  async connect() {
    // Load OpenAPI spec and generate tools
  }
}
```

---

## 11. @Provider

**Purpose:** Registers a dependency injection provider in the FrontMCP DI container.

**When to use:** When you need injectable services, configuration, or factories available via `this.get(Token)`.

**Key fields:**

| Field        | Description                                                     |
| ------------ | --------------------------------------------------------------- |
| `name`       | Provider name                                                   |
| `provide`    | Injection token                                                 |
| `useClass`   | Class to instantiate (pick one of useClass/useValue/useFactory) |
| `useValue`   | Static value to inject                                          |
| `useFactory` | Factory function for dynamic creation                           |

```typescript
import { Provider } from '@frontmcp/sdk';

@Provider({
  name: 'database',
  provide: DatabaseToken,
  useFactory: () => new DatabaseClient(process.env.DB_URL),
})
class DatabaseProvider {}
```

---

## 12. @Flow

**Purpose:** Defines a custom request/response flow with a multi-stage processing plan.

**When to use:** When you need complex multi-step request processing beyond simple tool execution (e.g., validation, transformation, approval chains).

**Key fields:**

| Field          | Description                         |
| -------------- | ----------------------------------- |
| `name`         | Flow name                           |
| `plan`         | Array of stages to execute in order |
| `inputSchema`  | Zod schema for flow input           |
| `outputSchema` | Zod schema for flow output          |
| `access`       | Access control configuration        |

```typescript
import { Flow } from '@frontmcp/sdk';
import { z } from 'zod';

@Flow({
  name: 'approval-flow',
  plan: [ValidateStage, EnrichStage, ApproveStage, ExecuteStage],
  inputSchema: z.object({ action: z.string(), target: z.string() }),
  outputSchema: z.object({ approved: z.boolean(), result: z.unknown() }),
  access: { roles: ['admin'] },
})
class ApprovalFlow {}
```

---

## 13. @Job

**Purpose:** Declares a long-running or scheduled background job.

**When to use:** When you need recurring tasks (cron), background processing, or deferred work.

**Key fields:**

| Field         | Description                                               |
| ------------- | --------------------------------------------------------- |
| `name`        | Job name                                                  |
| `description` | What the job does                                         |
| `schedule?`   | Cron expression (e.g., `'0 */6 * * *'` for every 6 hours) |

```typescript
import { Job, JobContext } from '@frontmcp/sdk';

@Job({
  name: 'sync_data',
  description: 'Synchronize data from external sources',
  schedule: '0 */6 * * *',
})
class SyncDataJob extends JobContext {
  async execute() {
    await this.get(SyncService).runFullSync();
  }
}
```

---

## 14. @Workflow

**Purpose:** Orchestrates a multi-step workflow composed of sequential or parallel steps.

**When to use:** When you need to coordinate multiple jobs or actions in a defined order with error handling and rollback.

**Key fields:**

| Field         | Description                         |
| ------------- | ----------------------------------- |
| `name`        | Workflow name                       |
| `description` | What this workflow accomplishes     |
| `steps`       | Array of step definitions (ordered) |

```typescript
import { Workflow } from '@frontmcp/sdk';

@Workflow({
  name: 'deploy_pipeline',
  description: 'Full deployment pipeline',
  steps: [
    { name: 'build', job: BuildJob },
    { name: 'test', job: TestJob },
    { name: 'deploy', job: DeployJob },
  ],
})
class DeployPipeline {}
```

---

## 15. @Hook Decorators (@Will, @Did, @Stage, @Around)

**Purpose:** Attach lifecycle hooks to flows, allowing interception at different points.

**When to use:** When you need to run logic before, after, at a specific stage of, or wrapping around a flow execution.

**Variants:**

| Decorator | Timing   | Description                               |
| --------- | -------- | ----------------------------------------- |
| `@Will`   | Before   | Runs before the flow executes             |
| `@Did`    | After    | Runs after the flow completes             |
| `@Stage`  | During   | Runs at a specific stage in the flow plan |
| `@Around` | Wrapping | Wraps the flow, controlling execution     |

```typescript
import { Will, Did, Stage, Around, HookContext } from '@frontmcp/sdk';

class AuditHooks {
  @Will('tools:call-tool')
  async beforeToolCall(ctx: HookContext) {
    ctx.state.set('startTime', Date.now());
  }

  @Did('tools:call-tool')
  async afterToolCall(ctx: HookContext) {
    const duration = Date.now() - ctx.state.get('startTime');
    await this.get(AuditService).log({ tool: ctx.toolName, duration });
  }

  @Around('resources:read-resource')
  async cacheResource(ctx: HookContext, next: () => Promise<void>) {
    const cached = await this.get(CacheService).get(ctx.uri);
    if (cached) {
      ctx.respond(cached);
      return;
    }
    await next();
  }
}
```

---

## Quick Reference Table

| Decorator                   | Extends           | Registered In    | Purpose                  |
| --------------------------- | ----------------- | ---------------- | ------------------------ |
| `@FrontMcp`                 | -                 | Root             | Server configuration     |
| `@App`                      | -                 | `@FrontMcp.apps` | Module grouping          |
| `@Tool`                     | `ToolContext`     | `@App.tools`     | Executable action        |
| `@Prompt`                   | `PromptContext`   | `@App.prompts`   | Prompt template          |
| `@Resource`                 | `ResourceContext` | `@App.resources` | Static data              |
| `@ResourceTemplate`         | `ResourceContext` | `@App.resources` | Parameterized data       |
| `@Agent`                    | `AgentContext`    | `@App.agents`    | Autonomous AI agent      |
| `@Skill`                    | -                 | `@App.skills`    | Knowledge package        |
| `@Plugin`                   | -                 | `@App.plugins`   | Cross-cutting concern    |
| `@Adapter`                  | -                 | `@App.adapters`  | External integration     |
| `@Provider`                 | -                 | `@App.providers` | DI binding               |
| `@Flow`                     | -                 | `@App`           | Custom flow              |
| `@Job`                      | `JobContext`      | `@App.jobs`      | Background task          |
| `@Workflow`                 | -                 | `@App.workflows` | Multi-step orchestration |
| `@Will/@Did/@Stage/@Around` | -                 | Entry class      | Lifecycle hooks          |

---

## Common Patterns

| Pattern                     | Correct                                                                       | Incorrect                                                                    | Why                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grouping tools into modules | Place tools inside `@App({ tools: [...] })`                                   | Register tools directly in `@FrontMcp({ tools: [...] })` for large servers   | Apps provide logical grouping, scoped providers, and isolation; standalone tools in `@FrontMcp` are only appropriate for small servers or global utilities |
| Exposing data to the LLM    | Use `@Resource` for fixed URIs, `@ResourceTemplate` for parameterized URIs    | Using `@Tool` to return static data that never changes                       | Resources are the MCP-standard way to expose readable data; tools are for actions with side effects or dynamic computation                                 |
| Cross-cutting concerns      | Create a `@Plugin` with providers and context extensions                      | Adding logging/caching logic directly inside every tool's `execute()` method | Plugins centralize shared behavior, reduce duplication, and can be reused across servers                                                                   |
| Background processing       | Use `@Job` with a cron schedule for recurring work                            | Using `setTimeout` or manual polling inside a tool                           | Jobs integrate with the scheduler, support persistence, and are visible in server diagnostics                                                              |
| Multi-step orchestration    | Use `@Workflow` with ordered steps referencing `@Job` classes                 | Chaining multiple tool calls manually from the LLM                           | Workflows provide built-in ordering, error handling, and rollback semantics                                                                                |
| Injecting services          | Use `@Provider` with `useFactory`/`useClass` and access via `this.get(Token)` | Importing singletons directly or using global state                          | DI providers support testability, lifecycle management, and per-scope isolation                                                                            |

---

## Verification Checklist

### Structure

- [ ] Server has exactly one `@FrontMcp` decorated class
- [ ] Every `@App` is listed in the `@FrontMcp({ apps: [...] })` array
- [ ] Each tool, resource, prompt, agent, and skill is registered in an `@App` (or in `@FrontMcp` for standalone use)

### Decorator Fields

- [ ] Every `@Tool` has `name`, `description`, and `inputSchema` defined
- [ ] Every `@Resource` has `name` and `uri` with a valid scheme (e.g., `config://`, `file://`)
- [ ] Every `@ResourceTemplate` has `uriTemplate` with `{param}` placeholders matching the `read()` params argument
- [ ] Every `@Prompt` has `name` and at least one argument when it accepts input
- [ ] Every `@Agent` has `name`, `description`, and `llm` configuration

### Inheritance

- [ ] Tool classes extend `ToolContext` and implement `execute()`
- [ ] Prompt classes extend `PromptContext` and implement `execute()`
- [ ] Resource classes extend `ResourceContext` and implement `read()`
- [ ] Agent classes extend `AgentContext` and implement `execute()`
- [ ] Job classes extend `JobContext` and implement `execute()`

### Hooks

- [ ] Hook flow strings match valid flows (e.g., `tools:call-tool`, `resources:read-resource`)
- [ ] `@Around` hooks call `await next()` to continue the chain (unless intentionally short-circuiting)
- [ ] Hooks do not mutate `rawInput` -- use `ctx.state.set()` for flow state

### DI and Plugins

- [ ] All `@Provider` entries specify exactly one of `useClass`, `useValue`, or `useFactory`
- [ ] Plugins are registered in `@App({ plugins: [...] })` or `@FrontMcp({ plugins: [...] })`
- [ ] Context extensions installed by plugins match the module augmentation declarations

---

## Troubleshooting

| Problem                                            | Cause                                                                                                 | Solution                                                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tool does not appear in `tools/list` MCP response  | Tool class is not registered in any `@App({ tools: [...] })` or `@FrontMcp({ tools: [...] })`         | Add the tool class to the `tools` array of the appropriate `@App` or `@FrontMcp` decorator                                          |
| `this.get(Token)` throws `DependencyNotFoundError` | The provider for that token is not registered or is registered in a different app scope               | Add a `@Provider` for the token in the same `@App` or in `@FrontMcp({ providers: [...] })` for global access                        |
| Resource returns 404 / `ResourceNotFoundError`     | The `uri` in `@Resource` does not match the requested URI, or `uriTemplate` parameters are misaligned | Verify the URI string exactly matches what the client requests; for templates, confirm `{param}` names match                        |
| Hook never fires                                   | The `flow` string in `@Will`/`@Did`/`@Around`/`@Stage` does not match any registered flow             | Check the flow string against valid flows (e.g., `tools:call-tool`, `resources:read-resource`, `resources:list-resources`)          |
| Plugin context extension is `undefined` at runtime | The plugin's `installContextExtension` function was not called, or module augmentation is missing     | Ensure the plugin is registered and its context extension function runs at startup; verify the `declare module` augmentation exists |
| Agent `execute()` returns empty result             | LLM configuration is missing or invalid (wrong model name, missing API key)                           | Verify `llm.model` and `llm.provider` in `@Agent`, and ensure the provider API key is set in environment variables                  |

---

## Reference

- **Official docs:** [FrontMCP Decorators Overview](https://docs.agentfront.dev/frontmcp/sdk-reference/decorators/overview)
- **Related skills:**
  - `create-tool` -- step-by-step guide for building tools with `@Tool` and `ToolContext`
  - `create-resource` -- patterns for `@Resource` and `@ResourceTemplate` usage
  - `create-plugin` -- creating plugins with `@Plugin`, providers, and context extensions
  - `configure-auth` -- authentication and session configuration (not decorator-focused)
