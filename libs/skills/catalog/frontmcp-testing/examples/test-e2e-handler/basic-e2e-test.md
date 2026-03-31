---
name: basic-e2e-test
reference: test-e2e-handler
level: basic
description: 'Set up a basic E2E test that starts a server, connects a client, and verifies tools are listed.'
tags: [testing, e2e, handler]
features:
  - 'Using `TestServer.create()` to start a server from its module export'
  - 'Connecting a client via `server.connect()` for automatic base URL wiring'
  - 'Proper lifecycle management with `beforeAll` / `afterAll` for setup and teardown'
  - 'Using the `toContainTool` custom matcher from `@frontmcp/testing`'
---

# Basic E2E Test with McpTestClient

Set up a basic E2E test that starts a server, connects a client, and verifies tools are listed.

## Code

```typescript
// src/__tests__/server.e2e.spec.ts
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

  it('should list resources', async () => {
    const { resources } = await client.listResources();
    expect(resources.length).toBeGreaterThanOrEqual(0);
  });

  it('should list prompts', async () => {
    const result = await client.getPrompt('summarize', { topic: 'testing' });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
  });
});
```

## What This Demonstrates

- Using `TestServer.create()` to start a server from its module export
- Connecting a client via `server.connect()` for automatic base URL wiring
- Proper lifecycle management with `beforeAll` / `afterAll` for setup and teardown
- Using the `toContainTool` custom matcher from `@frontmcp/testing`

## Related

- See `test-e2e-handler` for the full E2E handler testing reference
