---
name: create-tool
description: Build MCP tools with Zod input/output validation and dependency injection
---

# Creating an MCP Tool

Tools are the primary way to expose executable actions to AI clients in the MCP protocol. In FrontMCP, tools are TypeScript classes that extend `ToolContext`, decorated with `@Tool`, and registered on a `@FrontMcp` server or inside an `@App`.

## When to Use This Skill

### Must Use

- Building a new executable action that AI clients can invoke via MCP
- Defining typed input schemas with Zod validation for tool parameters
- Adding output schema validation to prevent data leaks from tool responses

### Recommended

- Adding rate limiting, concurrency control, or timeouts to existing tools
- Integrating dependency injection into tool execution
- Converting raw function handlers into class-based `ToolContext` patterns

### Skip When

- Exposing read-only data that does not require execution logic (see `create-resource`)
- Building conversational templates or system prompts (see `create-prompt`)
- Orchestrating multi-tool workflows with conditional logic (see `create-agent`)

> **Decision:** Use this skill when you need an AI-callable action that accepts validated input, performs work, and returns structured output.

## Class-Based Pattern

Create a class extending `ToolContext<In, Out>` and implement the `execute(input: In): Promise<Out>` method. The `@Tool` decorator requires at minimum a `name` and an `inputSchema`.

```typescript
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'greet_user',
  description: 'Greet a user by name',
  inputSchema: {
    name: z.string().describe('The name of the user to greet'),
  },
})
class GreetUserTool extends ToolContext {
  async execute(input: { name: string }) {
    return `Hello, ${input.name}!`;
  }
}
```

### Available Context Methods and Properties

`ToolContext` extends `ExecutionContextBase`, which provides:

**Methods:**

- `execute(input: In): Promise<Out>` -- the main method you implement
- `this.get(token)` -- resolve a dependency from DI (throws if not found)
- `this.tryGet(token)` -- resolve a dependency from DI (returns `undefined` if not found)
- `this.fail(err)` -- abort execution, triggers error flow (never returns)
- `this.mark(stage)` -- set the active execution stage for debugging/tracking
- `this.fetch(input, init?)` -- HTTP fetch with context propagation
- `this.notify(message, level?)` -- send a log-level notification to the client
- `this.respondProgress(value, total?)` -- send a progress notification to the client

**Properties:**

- `this.input` -- the validated input object
- `this.output` -- the output (available after execute)
- `this.metadata` -- tool metadata from the decorator
- `this.scope` -- the current scope instance
- `this.context` -- the execution context (see below)

**`this.context` properties (FrontMcpContext):**

| Property       | Type                | Description                         |
| -------------- | ------------------- | ----------------------------------- |
| `requestId`    | `string`            | Unique ID for this request          |
| `sessionId`    | `string`            | Session identifier                  |
| `scopeId`      | `string`            | Scope identifier                    |
| `authInfo`     | `Partial<AuthInfo>` | Authentication info for the request |
| `traceContext` | `TraceContext`      | Distributed tracing context         |
| `timestamp`    | `number`            | Request timestamp                   |
| `metadata`     | `RequestMetadata`   | Request headers, client IP, etc.    |

## Input Schema: Zod Raw Shapes

The `inputSchema` accepts a **Zod raw shape** -- a plain object mapping field names to Zod types. Do NOT wrap it in `z.object()`. The framework wraps it internally.

```typescript
@Tool({
  name: 'search_documents',
  description: 'Search documents by query and optional filters',
  inputSchema: {
    // This is a raw shape, NOT z.object({...})
    query: z.string().min(1).describe('Search query'),
    limit: z.number().int().min(1).max(100).default(10).describe('Max results'),
    category: z.enum(['blog', 'docs', 'api']).optional().describe('Filter by category'),
  },
})
class SearchDocumentsTool extends ToolContext {
  async execute(input: { query: string; limit: number; category?: 'blog' | 'docs' | 'api' }) {
    // input is already validated by Zod before execute() is called
    return { results: [], total: 0 };
  }
}
```

The `execute()` parameter type must match the inferred output of `z.object(inputSchema)`. Validated input is also available via `this.input`.

## Output Schema (Recommended Best Practice)

**Always define `outputSchema` for every tool.** This is a best practice for three critical reasons:

1. **Output validation** -- Prevents data leaks by ensuring your tool only returns fields you explicitly declare. Without `outputSchema`, any data in the return value passes through unvalidated, risking accidental exposure of sensitive fields (internal IDs, tokens, PII).
2. **CodeCall plugin compatibility** -- The CodeCall plugin uses `outputSchema` to understand what a tool returns, enabling correct VM-based orchestration and pass-by-reference. Tools without `outputSchema` degrade CodeCall's ability to chain results.
3. **Type safety** -- The `Out` generic on `ToolContext<In, Out>` is inferred from `outputSchema`, giving you compile-time guarantees that `execute()` returns the correct shape.

```typescript
@Tool({
  name: 'get_weather',
  description: 'Get current weather for a location',
  inputSchema: {
    city: z.string().describe('City name'),
  },
  // Always define outputSchema to validate output and prevent data leaks
  outputSchema: {
    temperature: z.number(),
    unit: z.enum(['celsius', 'fahrenheit']),
    description: z.string(),
  },
})
class GetWeatherTool extends ToolContext {
  async execute(input: { city: string }): Promise<{
    temperature: number;
    unit: 'celsius' | 'fahrenheit';
    description: string;
  }> {
    const response = await this.fetch(`https://api.weather.example.com/v1/current?city=${input.city}`);
    const weather = await response.json();
    // Only temperature, unit, and description are returned.
    // Any extra fields from the API (e.g., internalId, apiKey) are stripped by outputSchema validation.
    return {
      temperature: weather.temp,
      unit: 'celsius',
      description: weather.summary,
    };
  }
}
```

**Why not omit outputSchema?** Without it:

- The tool returns raw unvalidated data — any field your code accidentally includes leaks to the client
- CodeCall cannot infer return types for chaining tool calls in VM scripts
- No compile-time type checking on the return value

Supported `outputSchema` types:

- **Zod raw shapes** (recommended): `{ field: z.string(), count: z.number() }` — structured JSON output with validation
- **Zod schemas**: `z.object(...)`, `z.array(...)`, `z.union([...])` — for complex types
- **Primitive literals**: `'string'`, `'number'`, `'boolean'`, `'date'` — for simple returns
- **Media types**: `'image'`, `'audio'`, `'resource'`, `'resource_link'` — for binary/link content
- **Arrays**: `['string', 'image']` for multi-content responses

## Dependency Injection

Access providers registered in the scope using `this.get(token)` (throws if not found) or `this.tryGet(token)` (returns `undefined` if not found).

```typescript
import type { Token } from '@frontmcp/di';

interface DatabaseService {
  query(sql: string, params: unknown[]): Promise<unknown[]>;
}
const DATABASE: Token<DatabaseService> = Symbol('database');

@Tool({
  name: 'run_query',
  description: 'Execute a database query',
  inputSchema: {
    sql: z.string().describe('SQL query to execute'),
  },
})
class RunQueryTool extends ToolContext {
  async execute(input: { sql: string }) {
    const db = this.get(DATABASE); // throws if DATABASE not registered
    const rows = await db.query(input.sql, []);
    return { rows, count: rows.length };
  }
}
```

Use `this.tryGet(token)` when the dependency is optional:

```typescript
async execute(input: { data: string }) {
  const cache = this.tryGet(CACHE); // returns undefined if not registered
  if (cache) {
    const cached = await cache.get(input.data);
    if (cached) return cached;
  }
  // proceed without cache
}
```

## Error Handling

**Do NOT wrap `execute()` in try/catch.** The framework's tool execution flow automatically catches exceptions, formats error responses, and triggers error hooks. Only use `this.fail(err)` for **business-logic errors** (validation failures, not-found, permission denied). Let infrastructure errors (network, database) propagate naturally.

```typescript
// WRONG — never do this:
async execute(input) {
  try {
    const result = await someOperation();
    return result;
  } catch (err) {
    this.fail(err instanceof Error ? err : new Error(String(err)));
  }
}

// CORRECT — let the framework handle errors:
async execute(input) {
  const result = await someOperation(); // errors propagate to framework
  return result;
}
```

Use `this.fail(err)` to abort execution and trigger the error flow. The method throws internally and never returns.

```typescript
@Tool({
  name: 'delete_record',
  description: 'Delete a record by ID',
  inputSchema: {
    id: z.string().uuid().describe('Record UUID'),
  },
})
class DeleteRecordTool extends ToolContext {
  async execute(input: { id: string }) {
    const record = await this.findRecord(input.id);
    if (!record) {
      this.fail(new Error(`Record not found: ${input.id}`));
    }

    await this.deleteRecord(record);
    return `Record ${input.id} deleted successfully`;
  }

  private async findRecord(id: string) {
    return null;
  }

  private async deleteRecord(record: unknown) {
    // delete implementation
  }
}
```

For MCP-specific errors, use error classes with JSON-RPC codes:

```typescript
import { ResourceNotFoundError, PublicMcpError, MCP_ERROR_CODES } from '@frontmcp/sdk';

this.fail(new ResourceNotFoundError(`Record ${input.id}`));
```

## Progress and Notifications

Use `this.notify(message, level?)` to send log-level notifications and `this.respondProgress(value, total?)` to send progress updates to the client.

```typescript
@Tool({
  name: 'batch_process',
  description: 'Process a batch of items',
  inputSchema: {
    items: z.array(z.string()).min(1).describe('Items to process'),
  },
})
class BatchProcessTool extends ToolContext {
  async execute(input: { items: string[] }) {
    this.mark('validation');
    this.validateItems(input.items);

    this.mark('processing');
    const results: string[] = [];
    for (let i = 0; i < input.items.length; i++) {
      await this.respondProgress(i + 1, input.items.length);
      const result = await this.processItem(input.items[i]);
      results.push(result);
    }

    this.mark('complete');
    await this.notify(`Processed ${results.length} items`, 'info');
    return { processed: results.length, results };
  }

  private validateItems(items: string[]) {
    /* ... */
  }
  private async processItem(item: string): Promise<string> {
    return item;
  }
}
```

## Tool Annotations

Provide behavioral hints to clients using `annotations`. These hints help clients decide how to present and gate tool usage.

```typescript
@Tool({
  name: 'web_search',
  description: 'Search the web',
  inputSchema: {
    query: z.string(),
  },
  annotations: {
    title: 'Web Search',
    readOnlyHint: true,
    openWorldHint: true,
  },
})
class WebSearchTool extends ToolContext {
  async execute(input: { query: string }) {
    return await this.performSearch(input.query);
  }

  private async performSearch(query: string) {
    return [];
  }
}
```

Annotation fields:

- `title` -- Human-readable title for the tool
- `readOnlyHint` -- Tool does not modify its environment (default: false)
- `destructiveHint` -- Tool may perform destructive updates (default: true, meaningful only when readOnlyHint is false)
- `idempotentHint` -- Calling repeatedly with same args has no additional effect (default: false)
- `openWorldHint` -- Tool interacts with external entities (default: true)

## Function-Style Builder

For simple tools that do not need a class, use the `tool()` function builder. It returns a value you register the same way as a class tool.

```typescript
import { tool } from '@frontmcp/sdk';
import { z } from 'zod';

const AddNumbers = tool({
  name: 'add_numbers',
  description: 'Add two numbers',
  inputSchema: {
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  },
  outputSchema: 'number',
})((input) => {
  return input.a + input.b;
});
```

The callback receives `(input, ctx)` where `ctx` provides access to the same context methods (`get`, `tryGet`, `fail`, `mark`, `fetch`, `notify`, `respondProgress`).

Register it the same way as a class tool: `tools: [AddNumbers]`.

## Remote and ESM Loading

Load tools from external modules or remote URLs without importing them directly.

**ESM loading** -- load a tool from an ES module:

```typescript
const RemoteTool = Tool.esm('@my-org/tools@^1.0.0', 'MyTool', {
  description: 'A tool loaded from an ES module',
});
```

**Remote loading** -- load a tool from a remote URL:

```typescript
const CloudTool = Tool.remote('https://example.com/tools/cloud-tool', 'CloudTool', {
  description: 'A tool loaded from a remote server',
});
```

Both return values that can be registered in `tools: [RemoteTool, CloudTool]`.

## Registration

Add tool classes (or function-style tools) to the `tools` array in `@FrontMcp` or `@App`.

```typescript
import { FrontMcp, App } from '@frontmcp/sdk';

@App({
  name: 'my-app',
  tools: [GreetUserTool, SearchDocumentsTool, AddNumbers],
})
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  tools: [RunQueryTool], // can also register tools directly on the server
})
class MyServer {}
```

## Nx Generator

Scaffold a new tool using the Nx generator:

```bash
nx generate @frontmcp/nx:tool
```

This creates the tool file, spec file, and updates barrel exports.

## Rate Limiting and Concurrency

Protect tools with throttling controls:

```typescript
@Tool({
  name: 'expensive_operation',
  description: 'An expensive operation that should be rate limited',
  inputSchema: {
    data: z.string(),
  },
  rateLimit: { maxRequests: 10, windowMs: 60_000 },
  concurrency: { maxConcurrent: 2 },
  timeout: { executeMs: 30_000 },
})
class ExpensiveOperationTool extends ToolContext {
  async execute(input: { data: string }) {
    // At most 10 calls per minute, 2 concurrent, 30s timeout
    return await this.heavyComputation(input.data);
  }

  private async heavyComputation(data: string) {
    return data;
  }
}
```

## Auth Providers

Declare which auth providers a tool requires. Credentials are loaded before tool execution.

```typescript
// String shorthand — single provider
@Tool({
  name: 'create_issue',
  description: 'Create a GitHub issue',
  inputSchema: { title: z.string(), body: z.string() },
  authProviders: ['github'],
})
class CreateIssueTool extends ToolContext {
  /* ... */
}

// Full mapping — with scopes and required flag
@Tool({
  name: 'deploy_app',
  description: 'Deploy to cloud',
  inputSchema: { env: z.string() },
  authProviders: [
    { name: 'github', required: true, scopes: ['repo', 'workflow'] },
    { name: 'aws', required: false, alias: 'cloud' },
  ],
})
class DeployAppTool extends ToolContext {
  /* ... */
}
```

Auth provider mapping fields:

- `name` — Provider name (must match a registered `@AuthProvider`)
- `required?` — Whether credential is required (default: `true`)
- `scopes?` — Required OAuth scopes
- `alias?` — Alias for injection when using multiple providers

## Environment Availability

Restrict a tool to specific platforms, runtimes, or environments using `availableWhen`. The tool will be automatically filtered from discovery and blocked from execution when the constraint doesn't match.

> **Important:** `availableWhen` is a **registry-level** constraint, evaluated at server boot time against the process's runtime context (OS, runtime, deployment mode, NODE_ENV). This is fundamentally different from:
>
> - **Authorization** — per-request, evaluated in HTTP flows against session/user identity
> - **Rule-based filtering** — dynamic, policy-driven, evaluated at request time
> - **`hideFromDiscovery`** — a soft hide from listing; hidden tools can still be called directly
>
> `availableWhen` is a **hard constraint**: filtered tools are excluded from both listing AND execution. Results are logged at boot time for operational visibility.

```typescript
// macOS-only tool
@Tool({
  name: 'apple_notes_search',
  description: 'Search Apple Notes',
  inputSchema: { query: z.string() },
  availableWhen: { platform: ['darwin'] },
})
class AppleNotesSearchTool extends ToolContext {
  async execute(input: { query: string }) {
    // Only runs on macOS
  }
}

// Node.js production-only tool
@Tool({
  name: 'deploy_service',
  description: 'Deploy to production',
  inputSchema: { service: z.string() },
  availableWhen: { runtime: ['node'], env: ['production'] },
})
class DeployServiceTool extends ToolContext {
  async execute(input: { service: string }) {
    // Only available in Node.js production
  }
}
```

Available constraint fields (AND across fields, OR within arrays):

- `platform` — OS: `'darwin'`, `'linux'`, `'win32'`
- `runtime` — JS runtime: `'node'`, `'browser'`, `'edge'`, `'bun'`, `'deno'`
- `deployment` — Mode: `'serverless'`, `'standalone'`
- `env` — NODE_ENV: `'production'`, `'development'`, `'test'`

You can also check the platform imperatively inside `execute()`:

```typescript
if (this.isPlatform('darwin')) {
  /* macOS logic */
}
if (this.isRuntime('node')) {
  /* Node.js logic */
}
if (this.isEnv('production')) {
  /* production logic */
}
```

## Elicitation (Interactive Input)

Tools can request interactive input from users mid-execution using `this.elicit()`. Requires `elicitation` to be enabled at server level.

```typescript
@Tool({
  name: 'confirm_delete',
  description: 'Delete a resource after user confirmation',
  inputSchema: { resourceId: z.string() },
})
class ConfirmDeleteTool extends ToolContext {
  async execute(input: { resourceId: string }) {
    const result = await this.elicit('Are you sure you want to delete this resource?', {
      confirm: z.boolean().describe('Confirm deletion'),
      reason: z.string().optional().describe('Reason for deletion'),
    });

    if (result.action === 'accept' && result.data.confirm) {
      await this.get(ResourceService).delete(input.resourceId);
      return 'Resource deleted';
    }
    return 'Deletion cancelled';
  }
}
```

> **Note:** Elicitation must be enabled at server level: `@FrontMcp({ elicitation: { enabled: true } })`. See `configure-elicitation` for full configuration options.

## Tool Examples

Provide usage examples for documentation and discovery:

```typescript
@Tool({
  name: 'convert_currency',
  description: 'Convert between currencies',
  inputSchema: {
    amount: z.number(),
    from: z.string(),
    to: z.string(),
  },
  examples: [
    {
      description: 'Convert USD to EUR',
      input: { amount: 100, from: 'USD', to: 'EUR' },
      output: { converted: 85.5, rate: 0.855 },
    },
    {
      description: 'Convert with large amount',
      input: { amount: 1_000_000, from: 'GBP', to: 'JPY' },
    },
  ],
})
class ConvertCurrencyTool extends ToolContext {
  /* ... */
}
```

## Common Patterns

| Pattern        | Correct                                         | Incorrect                                     | Why                                                           |
| -------------- | ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Input schema   | `inputSchema: { name: z.string() }` (raw shape) | `inputSchema: z.object({ name: z.string() })` | Framework wraps in `z.object()` internally                    |
| Output schema  | Always define `outputSchema`                    | Omit `outputSchema`                           | Prevents data leaks and enables CodeCall chaining             |
| DI resolution  | `this.get(TOKEN)` with proper error handling    | `this.tryGet(TOKEN)!` with non-null assertion | `get` throws a clear error; non-null assertions mask failures |
| Error handling | `this.fail(new ResourceNotFoundError(...))`     | `throw new Error(...)`                        | `this.fail` triggers the error flow with MCP error codes      |
| Tool naming    | `snake_case` names: `get_weather`               | `camelCase` or `PascalCase`: `getWeather`     | MCP protocol convention for tool names                        |

## Verification Checklist

### Configuration

- [ ] Tool class extends `ToolContext` and implements `execute()`
- [ ] `@Tool` decorator has `name`, `description`, and `inputSchema`
- [ ] `outputSchema` is defined to validate and restrict output fields
- [ ] Tool is registered in `tools` array of `@App` or `@FrontMcp`

### Runtime

- [ ] Tool appears in `tools/list` MCP response
- [ ] Valid input returns expected output
- [ ] Invalid input returns Zod validation error (not a crash)
- [ ] `this.fail()` triggers proper MCP error response
- [ ] DI dependencies resolve correctly via `this.get()`

## Troubleshooting

| Problem                                          | Cause                                       | Solution                                                                     |
| ------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------- |
| Tool not appearing in `tools/list`               | Not registered in `tools` array             | Add tool class to `@App` or `@FrontMcp` `tools` array                        |
| Zod validation error on valid input              | Using `z.object()` wrapper in `inputSchema` | Use raw shape: `{ field: z.string() }` not `z.object({ field: z.string() })` |
| `this.get(TOKEN)` throws DependencyNotFoundError | Provider not registered in scope            | Register provider in `providers` array of `@App` or `@FrontMcp`              |
| Output contains unexpected fields                | No `outputSchema` defined                   | Add `outputSchema` to strip unvalidated fields from response                 |
| Tool times out                                   | No timeout configured for long operation    | Add `timeout: { executeMs: 30_000 }` to `@Tool` options                      |

## Examples

| Example                                                                                                   | Level        | Description                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| [`basic-class-tool`](../examples/create-tool/basic-class-tool.md)                                         | Basic        | A minimal tool using the class-based pattern with Zod input validation and output schema.                      |
| [`tool-with-di-and-errors`](../examples/create-tool/tool-with-di-and-errors.md)                           | Intermediate | A tool that resolves a database service via DI and uses `this.fail()` for business-logic errors.               |
| [`tool-with-rate-limiting-and-progress`](../examples/create-tool/tool-with-rate-limiting-and-progress.md) | Advanced     | A batch processing tool that uses rate limiting, concurrency control, progress notifications, and annotations. |

> See all examples in [`examples/create-tool/`](../examples/create-tool/)

## Reference

- [Tools Documentation](https://docs.agentfront.dev/frontmcp/servers/tools)
- Related skills: `create-resource`, `create-prompt`, `configure-throttle`, `create-agent`
