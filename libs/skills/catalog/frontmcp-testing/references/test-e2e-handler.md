---
name: test-e2e-handler
description: Full MCP protocol E2E tests over HTTP with McpTestClient and TestServer
---

# E2E Testing with McpTestClient (HTTP Handler)

Tests the full MCP protocol over HTTP — validates tools, resources, prompts end-to-end.

```typescript
import { McpTestClient, TestServer } from '@frontmcp/testing';
import Server from '../src/main';

describe('Server E2E', () => {
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

  it('should list all tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools).toContainTool('add_numbers');
  });

  it('should call a tool and get result', async () => {
    const result = await client.callTool('add_numbers', { a: 5, b: 3 });
    expect(result).toBeSuccessful();
    expect(result.content[0].text).toContain('8');
  });

  it('should return error for invalid input', async () => {
    const result = await client.callTool('add_numbers', { a: 'bad' });
    expect(result.isError).toBe(true);
  });

  it('should list resources', async () => {
    const { resources } = await client.listResources();
    expect(resources.length).toBeGreaterThanOrEqual(0);
  });

  it('should get a prompt', async () => {
    const result = await client.getPrompt('summarize', { topic: 'testing' });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
  });
});
```
