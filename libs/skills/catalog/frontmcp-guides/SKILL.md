---
name: frontmcp-guides
description: 'End-to-end examples and best practices for building FrontMCP MCP servers. Use when starting a new project from scratch, learning architectural patterns, or following a complete build walkthrough.'
tags: [guides, examples, best-practices, architecture, walkthrough, end-to-end]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/guides/overview
examples:
  - scenario: Build a simple weather API MCP server from scratch
    expected-outcome: Working server with tools, resources, and tests deployed to Node
  - scenario: Build a task manager with auth, Redis, and multi-tool patterns
    expected-outcome: Authenticated server with CRUD tools, session storage, and E2E tests
  - scenario: Build a multi-app knowledge base with agents and plugins
    expected-outcome: Composed server with multiple apps, AI agents, caching, and Vercel deployment
---

# FrontMCP End-to-End Guides

Complete build walkthroughs and best practices for FrontMCP servers. Each example starts from an empty directory and ends with a deployed, tested server. Every pattern references the specific skill that teaches it.

## When to Use This Skill

### Must Use

- Starting a new FrontMCP project from scratch and want a complete walkthrough to follow
- Learning FrontMCP architecture by building progressively complex real examples
- Need to see how multiple skills work together in a complete application

### Recommended

- Planning a new project and want to see how similar architectures are structured
- Onboarding a team member who learns best from complete working examples
- Reviewing best practices for file organization, naming, and code patterns

### Skip When

- You need to learn one specific component type (use the specific skill, e.g., `create-tool`)
- You need to find the right skill for a task (use domain routers: `frontmcp-development`, `frontmcp-deployment`, etc.)
- You need CLI/install instructions for the skills system (see `frontmcp-skills-usage`)

> **Decision:** Use this skill when you want to see how everything fits together. Use individual skills when you need focused instruction.

## Prerequisites

- Node.js 22+ and npm/yarn installed
- Familiarity with TypeScript and decorators
- `frontmcp` CLI available globally (`npm install -g frontmcp`)

## Steps

1. Choose an example that matches your project's complexity level (Beginner, Intermediate, Advanced)
2. Work through the Planning Checklist to define your project's scope
3. Follow the example code and architecture, referencing individual skills for deeper guidance
4. Verify your implementation using the Verification Checklist at the end of this skill

## Planning Checklist

Before writing any code, answer these questions:

### 1. What does the server do?

- What tools does it expose? (actions AI clients can call)
- What resources does it expose? (data AI clients can read)
- What prompts does it expose? (conversation templates)

### 2. How is it organized?

- Single app or multiple apps? (see `multi-app-composition`)
- Standalone project or Nx monorepo? (see `project-structure-standalone`, `project-structure-nx`)

### 3. How is it secured?

- Public (no auth), transparent (passthrough), local (self-contained), or remote (OAuth)? (see `configure-auth`)
- What session storage? Memory (dev), Redis (prod), Vercel KV (serverless)? (see `configure-session`)

### 4. Where does it deploy?

- Node, Vercel, Lambda, Cloudflare, CLI, browser, or SDK? (see `frontmcp-deployment`)
- What transport? stdio (local), SSE (streaming), Streamable HTTP (stateless)? (see `configure-transport`)

### 5. How is it tested?

- Unit tests for each component (see `setup-testing`)
- E2E tests for protocol-level flows
- Coverage target: 95%+

---

## Example 1: Weather API (Beginner)

**Skills used:** `setup-project`, `create-tool`, `create-resource`, `setup-testing`, `deploy-to-node`

A simple MCP server that exposes a weather lookup tool and a resource for supported cities.

### Architecture

```text
weather-api/
├── src/
│   ├── main.ts              # @FrontMcp server (deploy-to-node)
│   ├── weather.app.ts       # @App with tools and resources
│   ├── tools/
│   │   └── get-weather.tool.ts    # @Tool: fetch weather by city (create-tool)
│   └── resources/
│       └── cities.resource.ts     # @Resource: list supported cities (create-resource)
├── test/
│   ├── get-weather.tool.spec.ts   # Unit tests (setup-testing)
│   └── weather.e2e.spec.ts        # E2E protocol test (setup-testing)
└── package.json
```

### Key Code

**Server entry point** (`setup-project`):

```typescript
import { FrontMcp } from '@frontmcp/sdk';
import { WeatherApp } from './weather.app';

@FrontMcp({
  info: { name: 'weather-api', version: '1.0.0' },
  apps: [WeatherApp],
})
export default class WeatherServer {}
```

**Tool** (`create-tool`):

```typescript
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  inputSchema: {
    city: z.string().min(1).describe('City name'),
  },
  outputSchema: {
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
  },
})
export class GetWeatherTool extends ToolContext {
  async execute(input: { city: string }) {
    const data = await this.fetch(`https://api.weather.example.com/v1?city=${input.city}`);
    const json = await data.json();
    return { temperature: json.temp, condition: json.condition, humidity: json.humidity };
  }
}
```

**Resource** (`create-resource`):

```typescript
import { Resource, ResourceContext } from '@frontmcp/sdk';

@Resource({
  uri: 'weather://cities',
  name: 'Supported Cities',
  description: 'List of cities with weather data',
  mimeType: 'application/json',
})
export class CitiesResource extends ResourceContext {
  async read() {
    return JSON.stringify(['London', 'Tokyo', 'New York', 'Paris', 'Sydney']);
  }
}
```

> **Full working code:** See `references/example-weather-api.md`

---

## Example 2: Task Manager (Intermediate)

**Skills used:** `setup-project`, `create-tool`, `create-provider`, `configure-auth`, `configure-session`, `setup-redis`, `setup-testing`, `deploy-to-vercel`

An authenticated task management server with CRUD tools, Redis storage, and OAuth.

### Architecture

```text
task-manager/
├── src/
│   ├── main.ts                    # @FrontMcp with auth: { mode: 'remote' }
│   ├── tasks.app.ts               # @App with CRUD tools + provider
│   ├── providers/
│   │   └── task-store.provider.ts # @Provider: Redis-backed task storage (create-provider)
│   ├── tools/
│   │   ├── create-task.tool.ts    # @Tool: create a task (create-tool)
│   │   ├── list-tasks.tool.ts     # @Tool: list tasks (create-tool)
│   │   ├── update-task.tool.ts    # @Tool: update task status (create-tool)
│   │   └── delete-task.tool.ts    # @Tool: delete a task (create-tool)
│   └── types/
│       └── task.ts                # Shared task interface
├── test/
│   ├── *.spec.ts                  # Unit tests per tool
│   └── tasks.e2e.spec.ts          # E2E with auth flow
├── vercel.json                    # Vercel config (deploy-to-vercel)
└── package.json
```

### Key Code

**Server with auth** (`configure-auth`, `configure-session`, `setup-redis`):

```typescript
@FrontMcp({
  info: { name: 'task-manager', version: '1.0.0' },
  apps: [TasksApp],
  auth: { mode: 'remote', provider: 'https://auth.example.com', clientId: 'my-client-id' },
  redis: { provider: 'redis', host: process.env.REDIS_URL ?? 'localhost' },
})
export default class TaskManagerServer {}
```

**Provider for shared storage** (`create-provider`):

```typescript
import { Provider } from '@frontmcp/sdk';
import type { Token } from '@frontmcp/di';

export interface TaskStore {
  create(task: Task): Promise<Task>;
  list(userId: string): Promise<Task[]>;
  update(id: string, data: Partial<Task>): Promise<Task>;
  delete(id: string): Promise<void>;
}

export const TASK_STORE: Token<TaskStore> = Symbol('TaskStore');

@Provider({ token: TASK_STORE })
export class RedisTaskStoreProvider implements TaskStore {
  // Redis-backed implementation
}
```

**Tool with DI** (`create-tool` + `create-provider`):

```typescript
@Tool({
  name: 'create_task',
  description: 'Create a new task',
  inputSchema: {
    title: z.string().min(1).describe('Task title'),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  },
  outputSchema: { id: z.string(), title: z.string(), priority: z.string(), status: z.string() },
})
export class CreateTaskTool extends ToolContext {
  async execute(input: { title: string; priority: string }) {
    const store = this.get(TASK_STORE);
    return store.create({ title: input.title, priority: input.priority, status: 'pending' });
  }
}
```

> **Full working code:** See `references/example-task-manager.md`

---

## Example 3: Knowledge Base (Advanced)

**Skills used:** `setup-project`, `multi-app-composition`, `create-tool`, `create-resource`, `create-agent`, `create-skill-with-tools`, `create-plugin`, `official-plugins`, `configure-auth`, `deploy-to-vercel`

A multi-app knowledge base with AI-powered search, document ingestion, and an autonomous research agent.

### Architecture

```text
knowledge-base/
├── src/
│   ├── main.ts                          # @FrontMcp composing 3 apps
│   ├── ingestion/
│   │   ├── ingestion.app.ts             # @App: document ingestion
│   │   ├── tools/ingest-document.tool.ts
│   │   └── providers/vector-store.provider.ts
│   ├── search/
│   │   ├── search.app.ts               # @App: search and retrieval
│   │   ├── tools/search-docs.tool.ts
│   │   └── resources/doc.resource.ts
│   ├── research/
│   │   ├── research.app.ts             # @App: AI research agent
│   │   └── agents/researcher.agent.ts  # @Agent: autonomous research loop
│   └── plugins/
│       └── audit-log.plugin.ts         # @Plugin: audit logging
├── test/
│   └── *.spec.ts
├── vercel.json
└── package.json
```

### Key Code

**Multi-app composition** (`multi-app-composition`):

```typescript
@FrontMcp({
  info: { name: 'knowledge-base', version: '1.0.0' },
  apps: [IngestionApp, SearchApp, ResearchApp],
  plugins: [AuditLogPlugin],
  auth: { mode: 'remote', provider: 'https://auth.example.com', clientId: 'my-client-id' },
  redis: { provider: 'redis', host: process.env.REDIS_URL ?? 'localhost' },
})
export default class KnowledgeBaseServer {}
```

**AI Research Agent** (`create-agent`):

```typescript
@Agent({
  name: 'research_topic',
  description: 'Research a topic across the knowledge base and synthesize findings',
  inputSchema: {
    topic: z.string().describe('Research topic'),
    depth: z.enum(['shallow', 'deep']).default('shallow'),
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
    maxTokens: 4096,
  }, // provider and model are client-configurable
  tools: [SearchDocsTool, IngestDocumentTool],
})
export class ResearcherAgent extends AgentContext {
  async execute(input: { topic: string; depth: string }) {
    return this.run(
      `Research "${input.topic}" at ${input.depth} depth. Search for relevant documents, synthesize findings, and provide a structured summary.`,
    );
  }
}
```

> **Full working code:** See `references/example-knowledge-base.md`

---

## Best Practices

### Planning

| Practice                                               | Why                                                               | Skill Reference                       |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------- |
| Start with the `@App` boundaries, not individual tools | Apps define module boundaries; tools are implementation details   | `multi-app-composition`               |
| Choose auth mode and storage before writing tools      | Auth affects session handling, which affects storage requirements | `configure-auth`, `configure-session` |
| Pick your deployment target early                      | Target determines transport, storage, and build constraints       | `frontmcp-deployment`                 |

### Organizing Code

| Practice                                          | Why                                                         | Skill Reference                |
| ------------------------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| One class per file with `<name>.<type>.ts` naming | Consistency, generator compatibility, clear imports         | `project-structure-standalone` |
| Group by feature, not by type, for 10+ components | Feature folders scale better than flat `tools/` directories | `project-structure-standalone` |
| Extract shared logic into `@Provider` classes     | Testable, lifecycle-managed, injected via DI                | `create-provider`              |

### Writing Code

| Practice                                        | Why                                                           | Skill Reference   |
| ----------------------------------------------- | ------------------------------------------------------------- | ----------------- |
| Always define `outputSchema` on tools           | Prevents data leaks, enables CodeCall chaining                | `create-tool`     |
| Use `this.fail()` with MCP error classes        | Proper error codes in protocol responses                      | `create-tool`     |
| Use `this.get(TOKEN)` not `this.tryGet(TOKEN)!` | Clear error on missing dependency vs silent null              | `create-provider` |
| Use Zod raw shapes, not `z.object()`            | Framework wraps internally; double-wrapping breaks validation | `create-tool`     |

## Common Patterns

| Pattern           | Correct                                     | Incorrect                                 | Why                                                       |
| ----------------- | ------------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| Project start     | Plan apps and auth first, then build tools  | Jump straight into writing tools          | Architecture decisions are expensive to change later      |
| Code organization | Feature folders with `<name>.<type>.ts`     | Flat directory with generic names         | Scales to large projects and matches generator output     |
| Shared state      | `@Provider` with DI token                   | Module-level singleton or global variable | DI is testable, lifecycle-managed, and scoped per request |
| Error handling    | `this.fail(new ResourceNotFoundError(...))` | `throw new Error('not found')`            | MCP error codes enable proper client error handling       |
| Testing           | Unit tests per component + E2E for protocol | Only E2E tests or only unit tests         | Both layers catch different types of bugs                 |

## Verification Checklist

### Architecture

- [ ] Apps define clear module boundaries with no circular imports
- [ ] Shared logic extracted into providers, not duplicated across tools
- [ ] Auth mode and storage chosen before writing tools

### Code Quality

- [ ] All tools have `outputSchema` defined
- [ ] All files follow `<name>.<type>.ts` naming convention
- [ ] All test files use `.spec.ts` extension
- [ ] Coverage at 95%+ across all metrics

### Production Readiness

- [ ] Secrets stored in environment variables, not source code
- [ ] Session storage uses Redis/KV in production (not memory)
- [ ] Rate limiting configured for public-facing tools
- [ ] E2E tests exercise the full protocol flow

## Troubleshooting

| Problem                                  | Cause                                                  | Solution                                                     |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Unsure where to start                    | No project plan                                        | Run through the Planning Checklist above before writing code |
| Architecture feels wrong                 | Wrong app boundaries or component types                | Review the Scenario Routing Table in `frontmcp-development`  |
| Feature works locally but fails deployed | Environment-specific config (storage, auth, transport) | Check the Target Comparison in `frontmcp-deployment`         |
| Tests pass but coverage below 95%        | Missing error path or branch tests                     | Run `jest --coverage` and add tests for uncovered lines      |
| Provider state leaking between requests  | Using module-level state instead of DI                 | Move state into a `@Provider` scoped per request             |

## Reference

- [Guides Documentation](https://docs.agentfront.dev/frontmcp/guides/overview)
- Domain routers: `frontmcp-development`, `frontmcp-deployment`, `frontmcp-testing`, `frontmcp-config`
- Core skills: `setup-project`, `create-tool`, `create-resource`, `create-provider`, `create-agent`, `configure-auth`, `setup-testing`
