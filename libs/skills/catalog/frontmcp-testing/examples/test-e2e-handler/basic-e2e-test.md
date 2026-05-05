---
name: basic-e2e-test
reference: test-e2e-handler
level: basic
description: 'Set up a basic E2E test that starts a server, connects a client, and verifies tools are listed.'
tags: [testing, e2e, handler]
features:
  - 'Using `TestServer.start({ command, port })` to spawn the server as a child process'
  - 'Building a client with `McpTestClient.create(...).withTransport(...).buildAndConnect()`'
  - 'Calling the namespaced public API: `client.tools.list()`, `client.resources.list()`, `client.prompts.get(...)`'
  - 'Cleaning up with `client.disconnect()` and `server.stop()`'
---

# Basic E2E Test with McpTestClient

Set up a basic E2E test that starts a server, connects a client, and verifies tools are listed.

## Code

```typescript
// src/__tests__/server.e2e.spec.ts
// Real API:
//   libs/testing/src/server/test-server.ts:101 — `TestServer.start({ command, port })`
//   libs/testing/src/client/mcp-test-client.builder.ts — `McpTestClient.create(...).buildAndConnect()`
//   libs/testing/src/client/mcp-test-client.ts:306-402 — `client.tools.list/call`, `client.resources.list/read`, `client.prompts.list/get`, `client.disconnect`
import { McpTestClient, TestServer } from '@frontmcp/testing';

describe('Server E2E', () => {
  let client: McpTestClient;
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx src/main.ts',
      port: 3021,
    });

    client = await McpTestClient.create({ baseUrl: server.info.baseUrl })
      .withTransport('streamable-http')
      .buildAndConnect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.stop();
  });

  it('lists all tools', async () => {
    const tools = await client.tools.list();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools).toContainTool('add_numbers');
  });

  it('lists resources', async () => {
    const resources = await client.resources.list();
    expect(Array.isArray(resources)).toBe(true);
  });

  it('gets a prompt', async () => {
    const result = await client.prompts.get('summarize', { topic: 'testing' });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
  });
});
```

## What This Demonstrates

- Using `TestServer.start({ command, port })` to spawn the server as a child process
- Building a client with `McpTestClient.create(...).withTransport(...).buildAndConnect()`
- Calling the namespaced public API: `client.tools.list()`, `client.resources.list()`, `client.prompts.get(...)`
- Cleaning up with `client.disconnect()` and `server.stop()`

## Related

- See `test-e2e-handler` for the full E2E handler testing reference
