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
- `client.resources.subscribe(uri)` / `unsubscribe(uri)` send `resources/subscribe` / `resources/unsubscribe` and throw with the server's error when it refuses; the `notifications/resources/updated` that follow arrive in `client.notifications.collect().received`. On `2026-07-28`, which removed both methods, they open the client's `subscriptions/listen` stream again with the URI added or removed, and `subscribe` throws when the server doesn't acknowledge the URI.
- `client.discover()` sends `server/discover` and returns the server's `supportedVersions`, `capabilities`, `instructions` and `_meta`. It's sent as a `2026-07-28` request whatever version the client speaks.
- `tools.list()`, `resources.list()`, `resources.listTemplates()` and `prompts.list()` return **every page**: they follow `nextCursor` until the server stops returning one (a FrontMCP server pages at 40 by default), and throw if a cursor repeats or paging passes 1000 pages. Assert on the full list; there is no cursor to pass.

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

`McpTestClient` records the notifications the server sends on each request's own response and on its notification stream: after `initialize`, the session's `GET` stream; on `2026-07-28`, a `subscriptions/listen` stream for list changes and subscribed resources.

```typescript
it('records progress and log messages', async () => {
  const progress = client.notifications.collectProgress(); // tools.call now sends a _meta.progressToken
  const notifications = client.notifications.collect();

  await client.tools.call('import_files', {});

  expect(progress.all.map((update) => update.message)).toEqual(['file 1', 'file 2']);
  expect(notifications.has('notifications/message')).toBe(true);
});
```

- Pass `{ progressToken }` as the third argument of `tools.call()` to choose the token yourself.
- The client asks for every log message (`notifications/message`, from `this.notify()`) by default: it sends `logging/setLevel` `'debug'` after `initialize` when the server has the logging capability, and on `2026-07-28` puts the level in each request's `_meta`. Choose the level with `mcpLogLevel` (`McpTestClient.create({ baseUrl, mcpLogLevel: 'warning' })`, `.withMcpLogLevel()`, or `test.use({ mcpLogLevel })`); `false` asks for none.
- A FrontMCP server sends a tool's progress and log messages on the call's own response, so they're recorded by the time `tools.call()` returns. Each progress update keeps its `message`.
- Notifications that don't belong to a call, like `list_changed`, can arrive at any time: wait for them with `waitFor()`.

## Protocol Versions

`McpTestClient` speaks `2025-06-18` by default. Set `protocolVersion` (`McpTestClient.create({ baseUrl, protocolVersion: '2026-07-28' })`, `.withProtocolVersion()`, or `test.use({ protocolVersion })`) to speak another:

- Up to `2025-11-25`, the client opens a session with `initialize`.
- `2026-07-28` is stateless. `connect()` sends `server/discover` instead, and fills `serverInfo`, `capabilities` and `instructions` from it; `sessionId` stays empty. Each request carries the version, client info, capabilities and log level in its `_meta`, with the `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*` headers. The first `tools.call()` lists the tools once, to learn which arguments their `x-mcp-header` annotations mirror into headers.
- On `2026-07-28`, a tool's `this.elicit()` reaches the client as an `input_required` result: the client answers it with the `onElicitation()` handler (`decline` without one, `cancel` when it throws) and sends the call again, so `tools.call()` returns the final result. A request for sampling or roots fails the call, since the client doesn't answer them.
- A `2026-07-28` server answers a refused request with an HTTP error that carries the JSON-RPC error, and the client returns that error: removed methods like `ping` fail with `-32601`, and an unknown resource with `-32602` (`-32002` before).
- `2026-07-28` has no HTTP+SSE transport, so `transport: 'sse'` with it throws.

## Examples

| Example                                                                                        | Level        | Description                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| [`basic-e2e-test`](../examples/test-e2e-handler/basic-e2e-test.md)                             | Basic        | Set up a basic E2E test that starts a server, connects a client, and verifies tools are listed.                      |
| [`manual-client-with-transport`](../examples/test-e2e-handler/manual-client-with-transport.md) | Advanced     | Use `McpTestClient.create()` with explicit transport settings for fine-grained control over E2E tests.               |
| [`tool-call-and-error-e2e`](../examples/test-e2e-handler/tool-call-and-error-e2e.md)           | Intermediate | Test successful tool calls and verify that invalid inputs produce proper error responses over the full MCP protocol. |

> See all examples in [`examples/test-e2e-handler/`](../examples/test-e2e-handler/)
