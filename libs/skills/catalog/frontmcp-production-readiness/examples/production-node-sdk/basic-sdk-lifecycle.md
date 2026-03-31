---
name: basic-sdk-lifecycle
reference: production-node-sdk
level: basic
description: 'Shows the complete lifecycle of a FrontMCP SDK package used as an embedded client: initialization, tool invocation, and proper cleanup.'
tags: [production, sdk, node, lifecycle]
features:
  - 'Exporting a `create()` function as the public API surface'
  - 'No port binding in SDK mode (embedded, not standalone server)'
  - 'The full lifecycle: `create()` -> `connect()` -> `callTool()` -> `close()` -> `dispose()`'
  - 'Proper cleanup to prevent memory and connection leaks'
---

# Basic SDK Lifecycle: Create, Connect, Use, Dispose

Shows the complete lifecycle of a FrontMCP SDK package used as an embedded client: initialization, tool invocation, and proper cleanup.

## Code

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'my-mcp-package', version: '1.0.0' },
  apps: [MyApp],
  // SDK mode: no port binding, no HTTP server
})
export default class MyMcpServer {}
```

```typescript
// src/index.ts — Public API surface
// Export a clean create() function for consumers
import MyMcpServer from './main';

export async function create() {
  // create() does not bind a port — SDK mode, not server mode
  const server = await MyMcpServer.create();
  return server;
}

export type { MyMcpServer };
```

```typescript
// examples/usage.ts — How consumers use the SDK
import { create } from 'my-mcp-package';

async function main() {
  // 1. Create the server (no port binding)
  const server = await create();

  // 2. Connect to get a typed client
  const client = await server.connect();

  // 3. Use the client
  const tools = await client.listTools();
  console.log(
    'Available tools:',
    tools.map((t) => t.name),
  );

  const result = await client.callTool('my_tool', { input: 'value' });
  console.log('Result:', result);

  // 4. Always clean up — prevents leaks
  await client.close();
  await server.dispose();
}

main().catch(console.error);
```

## What This Demonstrates

- Exporting a `create()` function as the public API surface
- No port binding in SDK mode (embedded, not standalone server)
- The full lifecycle: `create()` -> `connect()` -> `callTool()` -> `close()` -> `dispose()`
- Proper cleanup to prevent memory and connection leaks

## Related

- See `production-node-sdk` for the full SDK publishing checklist
