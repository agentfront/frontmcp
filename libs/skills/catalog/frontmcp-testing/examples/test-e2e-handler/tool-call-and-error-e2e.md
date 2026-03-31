---
name: tool-call-and-error-e2e
reference: test-e2e-handler
level: intermediate
description: 'Test successful tool calls and verify that invalid inputs produce proper error responses over the full MCP protocol.'
tags: [testing, e2e, handler, tool, call, error]
features:
  - 'Calling tools via `client.callTool()` and asserting success with `toBeSuccessful()`'
  - 'Verifying text content in tool results with `result.content[0].text`'
  - 'Checking `result.isError` for invalid input and nonexistent tool calls'
  - 'Testing edge cases like zero values and missing optional parameters'
---

# E2E Testing Tool Calls and Error Responses

Test successful tool calls and verify that invalid inputs produce proper error responses over the full MCP protocol.

## Code

```typescript
// src/__tests__/tool-calls.e2e.spec.ts
import { McpTestClient, TestServer } from '@frontmcp/testing';
import Server from '../src/main';

describe('Tool Call E2E', () => {
  let client: McpTestClient;
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.create(Server);
    client = await server.connect();
  });

  afterAll(async () => {
    await client.close();
    await server.dispose();
  });

  it('should call a tool and get a successful result', async () => {
    const result = await client.callTool('add_numbers', { a: 5, b: 3 });
    expect(result).toBeSuccessful();
    expect(result.content[0].text).toContain('8');
  });

  it('should return isError for invalid input', async () => {
    const result = await client.callTool('add_numbers', { a: 'bad' });
    expect(result.isError).toBe(true);
  });

  it('should return error for nonexistent tool', async () => {
    const result = await client.callTool('nonexistent_tool', {});
    expect(result.isError).toBe(true);
  });

  it('should handle tool with optional parameters', async () => {
    const result = await client.callTool('add_numbers', { a: 10, b: 0 });
    expect(result).toBeSuccessful();
    expect(result.content[0].text).toContain('10');
  });
});
```

## What This Demonstrates

- Calling tools via `client.callTool()` and asserting success with `toBeSuccessful()`
- Verifying text content in tool results with `result.content[0].text`
- Checking `result.isError` for invalid input and nonexistent tool calls
- Testing edge cases like zero values and missing optional parameters

## Related

- See `test-e2e-handler` for the full E2E handler testing reference
- See `test-tool-unit` for unit-level tool testing
