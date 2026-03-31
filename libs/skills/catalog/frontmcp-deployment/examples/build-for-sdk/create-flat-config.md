---
name: create-flat-config
reference: build-for-sdk
level: basic
description: 'Spin up an in-memory FrontMCP server from a flat config object using `create()`.'
tags: [deployment, sdk, cache, flat, config]
features:
  - 'Using `create()` to spin up a server without decorators or classes'
  - 'Calling tools directly via `server.callTool()` with zero network overhead'
  - 'Using `cacheKey` to reuse the same server instance across multiple calls'
---

# Programmatic Server with create()

Spin up an in-memory FrontMCP server from a flat config object using `create()`.

## Code

```typescript
// src/embedded-server.ts
import { create, tool } from '@frontmcp/sdk';
import { z } from 'zod';

async function main() {
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

  // Call tools directly - no HTTP involved
  const result = await server.callTool('calculate', { expression: '2 + 2' });
  console.log(result); // { result: 4 }

  // List available tools
  const { tools } = await server.listTools();
  console.log(tools.map((t) => t.name)); // ['calculate']

  // Clean up when done
  await server.dispose();
}

main();
```

```bash
# Build as an SDK library
frontmcp build --target sdk

# Verify outputs
ls dist/
# my-service.cjs.js  my-service.esm.mjs  *.d.ts
```

## What This Demonstrates

- Using `create()` to spin up a server without decorators or classes
- Calling tools directly via `server.callTool()` with zero network overhead
- Using `cacheKey` to reuse the same server instance across multiple calls

## Related

- See `build-for-sdk` for the full `CreateConfig` fields and `DirectClient` API
