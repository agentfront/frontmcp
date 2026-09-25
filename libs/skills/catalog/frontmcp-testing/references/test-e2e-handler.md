---
name: test-e2e-handler
description: Full MCP protocol E2E tests over HTTP with McpTestClient and TestServer
---

# E2E Testing with McpTestClient (HTTP Handler)

Tests the full MCP protocol over HTTP — validates tools, resources, prompts end-to-end. This is the manual alternative to the fixture API in `setup-testing` and is useful when you need fine-grained control over server lifecycle, transport, or auth.

Real API references:

- `TestServer.start({ command, port })` returns a `TestServer` instance with `info.baseUrl` and `stop()` — `libs/testing/src/server/test-server.ts:101`. There is no `TestServer.create(ServerClass)`.
- Build a client with `await McpTestClient.create({ baseUrl }).withTransport('streamable-http').buildAndConnect()` — `libs/testing/src/client/mcp-test-client.builder.ts`.
- The public client API is namespaced: `client.tools.list()`, `client.tools.call(name, args)`, `client.resources.list()`, `client.resources.read(uri)`, `client.prompts.list()`, `client.prompts.get(name, args)`, `client.disconnect()` — `libs/testing/src/client/mcp-test-client.ts:306-402`.

```typescript
// server.e2e.spec.ts
import { McpTestClient, TestServer } from '@frontmcp/testing';

describe('Server E2E', () => {
  let client: McpTestClient;
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx src/main.ts',
      port: 3020,
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

  it('calls a tool and gets a successful result', async () => {
    const result = await client.tools.call('add_numbers', { a: 5, b: 3 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('8');
  });

  it('returns an error for invalid input', async () => {
    const result = await client.tools.call('add_numbers', { a: 'bad' });
    expect(result).toBeError();
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

## Error Codes

Errors raised while a tool runs, including invalid input, come back as a tool result with `isError: true` and a string `_meta.code`, not as a JSON-RPC error. Match them with the string form, and keep the numeric form for JSON-RPC errors:

```typescript
expect(await client.tools.call('add_numbers', { a: 5 })).toBeError('INVALID_INPUT');
expect(await client.tools.call('nonexistent_tool', {})).toBeError('TOOL_NOT_FOUND');
expect(await client.prompts.get('nonexistent_prompt')).toBeError(-32602);
```

A tool without an `outputSchema` that returns a plain number sends `{ value: 8 }`, so assert `expect(result.json()).toEqual({ value: 8 })`.

## Notifications and Progress

After `initialize`, `McpTestClient` opens the session's notification stream (a `GET` on the MCP endpoint) and records what the server sends there and on each request's own response:

```typescript
it('records progress and log messages', async () => {
  const progress = client.notifications.collectProgress(); // tools.call now sends a _meta.progressToken
  const notifications = client.notifications.collect();
  await client.raw.request({ jsonrpc: '2.0', id: 1, method: 'logging/setLevel', params: { level: 'info' } });

  await client.tools.call('import_files', {});

  await progress.waitForComplete(5000);
  expect(progress.all.length).toBeGreaterThan(0);
  await notifications.waitFor('notifications/message', 5000);
});
```

- Pass `{ progressToken }` as the third argument of `tools.call()` to choose the token yourself.
- The server sends `notifications/message` (from `this.notify()`) only after `logging/setLevel`.
- Session-stream notifications can arrive after the call's result, so wait with `waitFor()` / `waitForComplete()` before asserting.
- `McpTestClient` speaks `2025-06-18` by default. `2026-07-28` has no `initialize` handshake, so `withProtocolVersion('2026-07-28')` makes `build()` throw.

## Examples

| Example                                                                                        | Level        | Description                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| [`basic-e2e-test`](../examples/test-e2e-handler/basic-e2e-test.md)                             | Basic        | Set up a basic E2E test that starts a server, connects a client, and verifies tools are listed.                      |
| [`manual-client-with-transport`](../examples/test-e2e-handler/manual-client-with-transport.md) | Advanced     | Use `McpTestClient.create()` with explicit transport settings for fine-grained control over E2E tests.               |
| [`tool-call-and-error-e2e`](../examples/test-e2e-handler/tool-call-and-error-e2e.md)           | Intermediate | Test successful tool calls and verify that invalid inputs produce proper error responses over the full MCP protocol. |

> See all examples in [`examples/test-e2e-handler/`](../examples/test-e2e-handler/)
