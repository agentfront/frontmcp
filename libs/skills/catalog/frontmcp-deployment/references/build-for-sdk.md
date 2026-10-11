---
name: build-for-sdk
description: Build a FrontMCP server as an embeddable library with create() and connect() APIs
---

# Building as an SDK Library

Build your FrontMCP server as an embeddable library that runs without an HTTP server. Use `create()` for flat-config setup or `connect()` for platform-specific tool formatting (OpenAI, Claude, LangChain, Vercel AI).

## When to Use This Skill

### Must Use

- Embedding MCP tools in an existing Node.js application without starting an HTTP server
- Distributing your MCP server as an npm package with CJS + ESM + TypeScript declarations
- Connecting tools to LLM platforms (OpenAI, Claude, LangChain, Vercel AI) via `connect*()` functions

### Recommended

- Running MCP tools in-memory for low-latency, zero-network-overhead execution
- Building a shared tool library consumed by multiple services in a monorepo
- Testing MCP tools programmatically in integration test suites

### Skip When

- Deploying a standalone MCP server that listens on a port -- use `--target node` or `build-for-cli`
- Building a browser-based MCP client -- use `build-for-browser`
- Deploying to Cloudflare Workers -- use `deploy-to-cloudflare`

> **Decision:** Choose this skill when you need MCP tools as a library or programmatic API; use other targets for standalone servers or browser clients.

## Build Command

```bash
frontmcp build --target sdk
```

Produces dual-format output:

- `{name}.cjs.js` — CommonJS format
- `{name}.esm.mjs` — ES Module format
- `*.d.ts` — TypeScript declarations

All `@frontmcp/*` dependencies are marked as external (not bundled).

## Disable HTTP Server

Set `serve: false` in your `@FrontMcp` decorator to prevent the HTTP listener from starting:

```typescript
@FrontMcp({
  info: { name: 'my-sdk', version: '1.0.0' },
  apps: [MyApp],
  serve: false, // No HTTP server — library mode only
})
class MySDK {}
```

## Programmatic Usage with `create()`

The `create()` factory spins up a server from a flat config object — no decorators or classes needed:

```typescript
import { create, z } from '@frontmcp/sdk';

const server = await create({
  info: { name: 'my-service', version: '1.0.0' },
  tools: [
    tool({
      name: 'calculate',
      description: 'Perform calculation',
      inputSchema: {
        a: z.number(),
        b: z.number(),
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
      },
      outputSchema: { result: z.number() },
    })((input) => {
      switch (input.operation) {
        case 'add':
          return { result: input.a + input.b };
        case 'subtract':
          return { result: input.a - input.b };
        case 'multiply':
          return { result: input.a * input.b };
        case 'divide':
          // `z.number()` accepts 0, so guard the divisor: 1/0 is Infinity, which JSON
          // serialises as null, and 0/0 is NaN, which the output schema rejects with an
          // opaque error. Fail with a message the caller can act on instead.
          if (input.b === 0) throw new Error('Cannot divide by zero');
          return { result: input.a / input.b };
      }
    }),
  ],
  cacheKey: 'my-service', // Reuse same instance on repeated calls
});

// Call tools directly
const result = await server.callTool('calculate', { a: 2, b: 2, operation: 'add' });
// Name the caller of one call: user claims, token, sessionId, extra, and the OAuth scopes it holds
await server.callTool('calculate', { a: 1, b: 1, operation: 'add' }, { authContext: { scopes: ['math:use'] } });
// Request metadata reaches this.context.metadata: userAgent, clientIp (an IP address) and
// x-frontmcp-* customHeaders (other keys are dropped); x-frontmcp-trace-id continues a trace
await server.callTool(
  'calculate',
  { a: 1, b: 1, operation: 'add' },
  { metadata: { customHeaders: { 'x-frontmcp-disable-cache': 'true' } } },
);
// Platform bindings (a Worker / Durable Object / queue consumer `env`) reach this.workerEnv in the
// tool, resource, prompt, job or agent the call runs; they replace create({ workerEnv })'s default
await server.callTool('calculate', { a: 1, b: 1, operation: 'add' }, { workerEnv: env });

// List available tools: every page is read, so this is the whole list (no `nextCursor`).
// To page yourself: `listTools({ paginate: true })`, then `listTools({ cursor: page.nextCursor })`.
const { tools } = await server.listTools();

// Clean up
await server.dispose();
```

> **Never `eval()` tool input.** A tool's arguments come from the MCP caller, or from an LLM acting
> on caller-controlled prompts — they are untrusted by definition. `eval` on that value runs with the
> embedding process's full authority: environment credentials, the filesystem, the network, and
> `process.getBuiltinModule('child_process')`. Output-schema validation cannot help, because the side
> effects happen before the result is validated. Model the operation in the schema, as above, so the
> set of things the tool can do is fixed at design time.

### CreateConfig Fields

```typescript
create({
  // Required
  info: { name: string; version: string },

  // App-level (merged into one synthetic app, which joins the server's root scope)
  tools?: ToolType[],
  resources?: ResourceType[],
  prompts?: PromptType[],
  agents?: AgentType[],
  skills?: SkillType[],
  plugins?: PluginType[],
  providers?: ProviderType[],
  adapters?: AdapterType[],

  // Server-level: every other @FrontMcp option, passed on as it is (except http and splitByApp)
  auth?: AuthOptionsInput, // the server's auth, as @FrontMcp({ auth })
  redis?: RedisOptionsInput,
  transport?: TransportOptionsInput,
  logging?: LoggingOptionsInput, // without it: `warn`, or the level FRONTMCP_LOG_LEVEL names
  elicitation?: ElicitationOptionsInput,
  output?: OutputPolicy,  // as @FrontMcp({ output })
  throttle?: GuardConfig, // as @FrontMcp({ throttle })
  fetch?, ui?, authorities?, instructions?, channels?, tasks?, health?, metrics?, observability?, // ...

  // create()-specific
  appName?: string,       // defaults to info.name
  cacheKey?: string,      // same key = reuse server instance (it keeps the first call's workerEnv)
  machineId?: string,     // stable session ID across restarts
  workerEnv?: Readonly<Record<string, unknown>>, // default bindings for this.workerEnv (per call: callTool(..., { workerEnv }))
})
```

A `create()` server builds one scope, the root scope, which holds the synthetic app (`standalone: false`) and applies `auth` as the server's auth. A server-scoped plugin (`@Plugin({ scope: 'server' })`) in `plugins` installs there. Up to 1.9.4 the synthetic app had a scope of its own and an empty root scope started too, so every `create()` server ran two task stores, two task runners and their timers, and a server-scoped plugin failed with `InvalidPluginScopeError`.

## Platform-Specific Connections

Use `connect*()` functions to get tools formatted for a specific LLM platform:

### OpenAI Function Calling

```typescript
import { connectOpenAI } from '@frontmcp/sdk';

const client = await connectOpenAI(MyServerConfig, {
  session: { id: 'user-123', user: { sub: 'user-id' } },
});

const tools = await client.listTools();
// Returns OpenAI format: [{ type: 'function', function: { name, description, parameters, strict: true } }]

const result = await client.callTool('my-tool', { arg: 'value' });
await client.close();
```

### Anthropic Claude

```typescript
import { connectClaude } from '@frontmcp/sdk';

const client = await connectClaude(MyServerConfig);
const tools = await client.listTools();
// Returns Claude format: [{ name, description, input_schema }]
```

### LangChain

```typescript
import { connectLangChain } from '@frontmcp/sdk';

const client = await connectLangChain(MyServerConfig);
const tools = await client.listTools();
// Returns LangChain tool schema format
```

### Vercel AI SDK

```typescript
import { connectVercelAI } from '@frontmcp/sdk';

const client = await connectVercelAI(MyServerConfig);
const tools = await client.listTools();
// Returns Vercel AI SDK format
```

### ConnectOptions

```typescript
const client = await connectOpenAI(config, {
  clientInfo: { name: 'my-app', version: '1.0' },
  session: { id: 'session-123', user: { sub: 'user-id', name: 'Alice' }, scopes: ['tickets:write'] },
  authToken: 'jwt-token-here',
  capabilities: { roots: { listChanged: true } },
  workerEnv: env, // platform bindings this client's calls read as this.workerEnv (never copied into process.env)
});

// One app of a splitByApp server (or a standalone app's own endpoint): its tools only
const billing = await connect(config, { app: 'billing' });
const billingServer = await FrontMcpInstance.createDirect(config, { app: 'billing' });
```

`server.dispose()` shuts the whole server down (every scope, the endpoints it doesn't serve included), as `FrontMcpInstance.shutdown()` does. It stops every timer the server started (provider session cleanup, the in-memory auth stores, the task store's and the auth layer's storage sweepers), closes the storage the auth layer opened, and leaves no reference to the server on a `Plugin.init()` record, so a process can create and dispose servers repeatedly without keeping the disposed ones in memory (up to 1.9.4 four 60-second intervals and the first server's plugin records kept every disposed server reachable). An `app` without an endpoint of its own rejects after the server built for it is shut down; `connect()` then also disposes the shared server when no other client uses it, so the next `connect()` builds a new one.

## DirectClient API

All `connect*()` functions return a `DirectClient` with these methods:

| Method                                        | Description                                                                                                                                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listTools()`                                 | List tools in platform-specific format                                                                                                                                                                                                                   |
| `callTool(name, args, options?)`              | Execute a tool; with an LLM platform format (OpenAI, Claude, LangChain, Vercel AI) a failed call (`isError`) rejects with `ToolCallError` (`message`, raw `result`). `{ onProgress }` sends a progress token, so the tool's `this.progress()` reaches it |
| `listResources()`                             | List all resources (follows every page)                                                                                                                                                                                                                  |
| `readResource(uri)`                           | Read a resource                                                                                                                                                                                                                                          |
| `listPrompts()`                               | List all prompts (follows every page)                                                                                                                                                                                                                    |
| `getPrompt(name, args)`                       | Get a prompt                                                                                                                                                                                                                                             |
| `onElicitation(handler)`                      | Answer the tools' `this.elicit()` questions (the handler gets `elicitId`, `expiresAt`, `message`, `requestedSchema`, `mode`). Pass `onElicitation` to `connect()` to declare elicitation; without it the tool gets the fallback flow                     |
| `submitElicitationResult(elicitId, response)` | Answer a fallback question (`_meta.elicitationPending.elicitId`): calls the `sendElicitationResult` tool and returns the waiting tool's result                                                                                                           |
| `setLogLevel(level)`                          | Set the `notifications/message` level                                                                                                                                                                                                                    |
| `close()`                                     | Clean up connection; clients of the same config share one server, disposed when the last of them closes. A `server.connect()` client leaves its server to `server.dispose()`                                                                             |

## SDK vs Node Target

| Aspect       | `--target sdk`                    | `--target node`       |
| ------------ | --------------------------------- | --------------------- |
| Output       | CJS + ESM + .d.ts                 | Single JS executable  |
| HTTP server  | No (`serve: false`)               | Yes (listens on port) |
| Use case     | Library/embed in apps             | Standalone deployment |
| Distribution | npm package                       | Docker/binary         |
| Tool format  | Platform-specific via connect\*() | Raw MCP protocol      |

## Verification

```bash
# Build
frontmcp build --target sdk

# Check outputs
ls dist/
# my-sdk.cjs.js  my-sdk.esm.mjs  *.d.ts

# Test programmatically
node -e "const { create } = require('./dist/my-sdk.cjs.js'); ..."
```

## Common Patterns

| Pattern             | Correct                                     | Incorrect                                | Why                                                         |
| ------------------- | ------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| HTTP server         | `serve: false` in `@FrontMcp` decorator     | Omitting `serve` (defaults to `true`)    | SDK mode should not bind a port                             |
| Dependency bundling | `@frontmcp/*` marked as external            | Bundling all `@frontmcp/*` packages      | Consumers already have these as peer deps                   |
| Instance reuse      | Pass `cacheKey` to `create()`               | Call `create()` on every request         | Same key reuses the server instance, avoiding repeated init |
| Cleanup             | Call `server.dispose()` or `client.close()` | Letting the process exit without cleanup | Avoids leaked connections and open handles                  |
| Platform tools      | `connectOpenAI()` for OpenAI format         | Manually formatting tool schemas         | `connect*()` handles schema translation automatically       |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target sdk` completes without errors
- [ ] Output contains `.cjs.js`, `.esm.mjs`, and `.d.ts` files
- [ ] `@frontmcp/*` packages are not included in the bundle

**Programmatic API**

- [ ] `create()` returns a working server instance
- [ ] `server.callTool()` executes tools and returns results
- [ ] `server.listTools()` returns all registered tools
- [ ] `server.dispose()` cleans up without errors

**Platform Connections**

- [ ] `connectOpenAI()` returns tools in OpenAI function-calling format
- [ ] `connectClaude()` returns tools in Anthropic `input_schema` format
- [ ] `client.close()` releases all resources

## Troubleshooting

| Problem                         | Cause                                              | Solution                                                            |
| ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| HTTP server starts unexpectedly | Missing `serve: false` in decorator                | Add `serve: false` to the `@FrontMcp` options                       |
| `create()` returns stale tools  | Cached instance from a previous `cacheKey`         | Use a unique `cacheKey` or call `dispose()` before re-creating      |
| TypeScript types missing        | `.d.ts` files not generated                        | Ensure `tsconfig` has `declaration: true` and build target is `sdk` |
| `connectOpenAI()` format wrong  | Using raw `listTools()` instead of platform client | Use `connectOpenAI()` which formats tools for OpenAI automatically  |
| Bundle includes `@frontmcp/*`   | Build config missing externals                     | Verify `--target sdk` is set; it marks `@frontmcp/*` as external    |

## Examples

| Example                                                                         | Level        | Description                                                                                                |
| ------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| [`connect-openai`](../examples/build-for-sdk/connect-openai.md)                 | Intermediate | Use `connectOpenAI()` to get tools formatted for OpenAI's function-calling API.                            |
| [`create-flat-config`](../examples/build-for-sdk/create-flat-config.md)         | Basic        | Spin up an in-memory FrontMCP server from a flat config object using `create()`.                           |
| [`multi-platform-connect`](../examples/build-for-sdk/multi-platform-connect.md) | Advanced     | Connect the same FrontMCP server to multiple LLM platforms using platform-specific `connect*()` functions. |

> See all examples in [`examples/build-for-sdk/`](../examples/build-for-sdk/)

## Reference

- **Docs:** <https://docs.agentfront.dev/frontmcp/deployment/direct-client>
- **Related skills:** `build-for-cli`, `build-for-browser`, `deploy-to-cloudflare`
