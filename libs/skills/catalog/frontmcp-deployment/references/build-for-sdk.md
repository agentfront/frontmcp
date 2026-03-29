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
import { create } from '@frontmcp/sdk';
import { z } from 'zod';

const server = await create({
  info: { name: 'my-service', version: '1.0.0' },
  tools: [
    tool({
      name: 'calculate',
      description: 'Perform calculation',
      inputSchema: { expression: z.string() },
      outputSchema: { result: z.number() },
    })((input) => ({ result: eval(input.expression) })),
  ],
  cacheKey: 'my-service', // Reuse same instance on repeated calls
});

// Call tools directly
const result = await server.callTool('calculate', { expression: '2 + 2' });

// List available tools
const { tools } = await server.listTools();

// Clean up
await server.dispose();
```

### CreateConfig Fields

```typescript
create({
  // Required
  info: { name: string; version: string },

  // App-level (merged into synthetic app)
  tools?: ToolType[],
  resources?: ResourceType[],
  prompts?: PromptType[],
  agents?: AgentType[],
  skills?: SkillType[],
  plugins?: PluginType[],
  providers?: ProviderType[],
  adapters?: AdapterType[],
  auth?: AuthOptionsInput,

  // Server-level
  redis?: RedisOptionsInput,
  transport?: TransportOptionsInput,
  logging?: LoggingOptionsInput,
  elicitation?: ElicitationOptionsInput,

  // create()-specific
  appName?: string,       // defaults to info.name
  cacheKey?: string,      // same key = reuse server instance
  machineId?: string,     // stable session ID across restarts
})
```

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
  session: { id: 'session-123', user: { sub: 'user-id', name: 'Alice' } },
  authToken: 'jwt-token-here',
  capabilities: { roots: { listChanged: true } },
});
```

## DirectClient API

All `connect*()` functions return a `DirectClient` with these methods:

| Method                  | Description                            |
| ----------------------- | -------------------------------------- |
| `listTools()`           | List tools in platform-specific format |
| `callTool(name, args)`  | Execute a tool                         |
| `listResources()`       | List available resources               |
| `readResource(uri)`     | Read a resource                        |
| `listPrompts()`         | List available prompts                 |
| `getPrompt(name, args)` | Get a prompt                           |
| `close()`               | Clean up connection                    |

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

## Reference

- **Docs:** <https://docs.agentfront.dev/frontmcp/deployment/direct-client>
- **Related skills:** `build-for-cli`, `build-for-browser`, `deploy-to-cloudflare`
