---
name: build-for-sdk
description: Build a FrontMCP server as an embeddable SDK library for Node.js applications without HTTP serving. Use when embedding MCP in existing apps, using connect()/connectOpenAI()/connectClaude(), or distributing as an npm package.
tags: [deployment, sdk, library, embed, programmatic, connect]
examples:
  - scenario: Embed MCP tools in an existing Express app
    expected-outcome: Tools callable programmatically without HTTP server
  - scenario: Build SDK for npm distribution
    expected-outcome: CJS + ESM + TypeScript declarations package
  - scenario: Connect tools to OpenAI function calling
    expected-outcome: Tools formatted for OpenAI API consumption
priority: 8
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/direct-client
---

# Building as an SDK Library

Build your FrontMCP server as an embeddable library that runs without an HTTP server. Use `create()` for flat-config setup or `connect()` for platform-specific tool formatting (OpenAI, Claude, LangChain, Vercel AI).

## When to Use

Use `--target sdk` when:

- Embedding MCP tools in an existing Node.js application
- Distributing your tools as an npm package
- Connecting tools to LLM platforms (OpenAI, Claude, LangChain, Vercel AI) programmatically
- Running tools in-memory without network overhead

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
