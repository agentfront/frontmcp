---
name: fixture-based-e2e-test
reference: setup-testing
level: advanced
description: 'Write E2E tests using the fixture API from `@frontmcp/testing` that manages server lifecycle automatically and uses MCP-specific custom matchers.'
tags: [testing, jest, e2e, setup, fixture, based]
features:
  - 'Using `test.use()` to configure server path and port for automatic lifecycle management'
  - 'Importing `test` and `expect` from `@frontmcp/testing` (not from Jest) to access MCP-specific matchers'
  - 'Custom matchers: `toContainTool()`, `toBeSuccessful()`, `toHaveTextContent()` for MCP assertions'
  - 'Testing all three MCP primitives (tools, resources, prompts) in a single E2E suite'
---

# Fixture-Based E2E Test with Custom Matchers

Write E2E tests using the fixture API from `@frontmcp/testing` that manages server lifecycle automatically and uses MCP-specific custom matchers.

## Code

```typescript
// my-server.e2e.spec.ts
import { test, expect } from '@frontmcp/testing';

test.use({
  server: './src/main.ts',
  port: 3003,
});

test('server exposes expected tools', async ({ mcp }) => {
  const tools = await mcp.tools.list();
  expect(tools).toContainTool('create_record');
  expect(tools).toContainTool('delete_record');
});

test('create_record tool returns success', async ({ mcp }) => {
  const result = await mcp.tools.call('create_record', {
    name: 'Test Record',
    type: 'example',
  });

  expect(result).toBeSuccessful();
  expect(result).toHaveTextContent('created');
});

test('reading a resource returns valid content', async ({ mcp }) => {
  const result = await mcp.resources.read('config://server-info');

  expect(result.contents).toHaveLength(1);
  expect(result.contents[0]).toHaveProperty('mimeType', 'application/json');
});

test('prompts return well-formed messages', async ({ mcp }) => {
  const result = await mcp.prompts.get('summarize', { topic: 'testing' });

  expect(result.messages).toBeDefined();
  expect(result.messages.length).toBeGreaterThan(0);
});
```

## What This Demonstrates

- Using `test.use()` to configure server path and port for automatic lifecycle management
- Importing `test` and `expect` from `@frontmcp/testing` (not from Jest) to access MCP-specific matchers
- Custom matchers: `toContainTool()`, `toBeSuccessful()`, `toHaveTextContent()` for MCP assertions
- Testing all three MCP primitives (tools, resources, prompts) in a single E2E suite

## Related

- See `setup-testing` for the full testing setup reference
- See `test-e2e-handler` for manual `McpTestClient` E2E patterns
