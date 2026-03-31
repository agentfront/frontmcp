---
name: basic-create-test
reference: test-direct-client
level: basic
description: 'Test tools in-memory without any HTTP overhead using the `create()` function from `@frontmcp/sdk`.'
tags: [testing, sdk, transport, direct-client, direct, client]
features:
  - 'Using `create()` to spin up an in-memory server with no HTTP transport'
  - 'Defining tools inline with the functional `tool()` API and Zod schemas'
  - 'Calling tools directly via `server.callTool()` and checking text content'
  - 'Proper cleanup with `server.dispose()` in each test'
---

# Basic In-Memory Testing with create()

Test tools in-memory without any HTTP overhead using the `create()` function from `@frontmcp/sdk`.

## Code

```typescript
// src/__tests__/direct-client.spec.ts
import { create } from '@frontmcp/sdk';
import { tool } from '@frontmcp/sdk';
import { z } from 'zod';

const AddTool = tool({
  name: 'add',
  description: 'Add numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: { sum: z.number() },
})((input) => ({ sum: input.a + input.b }));

describe('Direct Client Testing', () => {
  it('should call tools via create()', async () => {
    const server = await create({
      info: { name: 'test', version: '1.0.0' },
      tools: [AddTool],
      cacheKey: 'test-direct',
    });

    const result = await server.callTool('add', { a: 2, b: 3 });
    expect(result.content[0].text).toContain('5');

    await server.dispose();
  });

  it('should handle multiple tool calls', async () => {
    const server = await create({
      info: { name: 'test', version: '1.0.0' },
      tools: [AddTool],
      cacheKey: 'test-direct-multi',
    });

    const r1 = await server.callTool('add', { a: 10, b: 20 });
    expect(r1.content[0].text).toContain('30');

    const r2 = await server.callTool('add', { a: -5, b: 5 });
    expect(r2.content[0].text).toContain('0');

    await server.dispose();
  });
});
```

## What This Demonstrates

- Using `create()` to spin up an in-memory server with no HTTP transport
- Defining tools inline with the functional `tool()` API and Zod schemas
- Calling tools directly via `server.callTool()` and checking text content
- Proper cleanup with `server.dispose()` in each test

## Related

- See `test-direct-client` for the full direct client testing reference
