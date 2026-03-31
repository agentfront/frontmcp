---
name: manual-client-with-transport
reference: test-e2e-handler
level: advanced
description: 'Use `McpTestClient.create()` with explicit transport settings for fine-grained control over E2E tests.'
tags: [testing, session, transport, e2e, handler, manual]
features:
  - 'Using `TestServer.start()` with an explicit command and port for process-based server startup'
  - "Building a client with `McpTestClient.create().withTransport('modern').buildAndConnect()` for streamable HTTP + strict sessions"
  - 'Using `server.info.baseUrl` to wire the client to the correct address'
  - 'Separate `disconnect()` / `stop()` calls for client and server teardown'
  - 'The `toBeError()` and `toHaveTextContent()` custom matchers'
---

# Manual McpTestClient with Transport Configuration

Use `McpTestClient.create()` with explicit transport settings for fine-grained control over E2E tests.

## Code

```typescript
// src/__tests__/advanced.e2e.spec.ts
import { McpTestClient, TestServer } from '@frontmcp/testing';

describe('Advanced E2E with Transport Config', () => {
  let server: TestServer;
  let client: McpTestClient;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx src/main.ts',
      port: 3004,
    });

    client = await McpTestClient.create({ baseUrl: server.info.baseUrl }).withTransport('modern').buildAndConnect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.stop();
  });

  it('should list tools after initialization', async () => {
    const tools = await client.tools.list();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('should handle tool errors gracefully', async () => {
    const result = await client.tools.call('nonexistent_tool', {});
    expect(result).toBeError();
  });

  it('should call tool and verify result shape', async () => {
    const result = await client.tools.call('add_numbers', { a: 1, b: 2 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('3');
  });
});
```

## What This Demonstrates

- Using `TestServer.start()` with an explicit command and port for process-based server startup
- Building a client with `McpTestClient.create().withTransport('modern').buildAndConnect()` for streamable HTTP + strict sessions
- Using `server.info.baseUrl` to wire the client to the correct address
- Separate `disconnect()` / `stop()` calls for client and server teardown
- The `toBeError()` and `toHaveTextContent()` custom matchers

## Related

- See `test-e2e-handler` for the full E2E handler testing reference
- See `setup-testing` for fixture-based E2E patterns
