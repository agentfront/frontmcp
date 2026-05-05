---
name: tool-call-and-error-e2e
reference: test-e2e-handler
level: intermediate
description: 'Test successful tool calls and verify that invalid inputs produce proper error responses over the full MCP protocol.'
tags: [testing, e2e, handler, tool-call, error]
features:
  - 'Calling tools via `client.tools.call(name, args)` and asserting success with `toBeSuccessful()`'
  - 'Asserting text content with the `toHaveTextContent()` matcher'
  - 'Asserting error results with `toBeError()` for invalid input and unknown tools'
  - 'Testing edge cases like zero values'
---

# E2E Testing Tool Calls and Error Responses

Test successful tool calls and verify that invalid inputs produce proper error responses over the full MCP protocol.

## Code

```typescript
// src/__tests__/tool-calls.e2e.spec.ts
// Real API:
//   libs/testing/src/server/test-server.ts:101 — `TestServer.start({ command, port })`
//   libs/testing/src/client/mcp-test-client.ts:306 — `client.tools.call(name, args)` (public namespaced API)
//   libs/testing/src/assertions/* — `toBeSuccessful`, `toBeError`, `toHaveTextContent`
import { McpTestClient, TestServer } from '@frontmcp/testing';

describe('Tool Call E2E', () => {
  let client: McpTestClient;
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx src/main.ts',
      port: 3022,
    });

    client = await McpTestClient.create({ baseUrl: server.info.baseUrl })
      .withTransport('streamable-http')
      .buildAndConnect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.stop();
  });

  it('calls a tool and gets a successful result', async () => {
    const result = await client.tools.call('add_numbers', { a: 5, b: 3 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('8');
  });

  it('returns an error for invalid input', async () => {
    const result = await client.tools.call('add_numbers', { a: 'bad' });
    expect(result).toBeError();
  });

  it('returns an error for a nonexistent tool', async () => {
    const result = await client.tools.call('nonexistent_tool', {});
    expect(result).toBeError();
  });

  it('handles edge case: zero values', async () => {
    const result = await client.tools.call('add_numbers', { a: 10, b: 0 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('10');
  });
});
```

## What This Demonstrates

- Calling tools via `client.tools.call(name, args)` and asserting success with `toBeSuccessful()`
- Asserting text content with the `toHaveTextContent()` matcher
- Asserting error results with `toBeError()` for invalid input and unknown tools
- Testing edge cases like zero values

## Related

- See `test-e2e-handler` for the full E2E handler testing reference
- See `test-tool-unit` for unit-level tool testing
