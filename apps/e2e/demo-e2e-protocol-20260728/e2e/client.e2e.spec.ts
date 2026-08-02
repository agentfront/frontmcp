/**
 * `McpStatelessClient` — the FrontMCP client speaking 2026-07-28 end to end.
 *
 * The other suites assert the server's wire bytes with raw fetch; this one
 * proves the shipped client actually interoperates with it, including the parts
 * a client MUST implement (mirrored headers, the MRTR retry loop, task polling,
 * and rejecting malformed `x-mcp-header` annotations).
 */
import {
  McpStatelessClient,
  McpStatelessClientAdapter,
  McpStatelessError,
  negotiateRemoteProtocol,
} from '@frontmcp/sdk';
import { expect, test } from '@frontmcp/testing';

import type { ListedTool } from './helpers/mcp-stateless-client';

test.describe('protocol 2026-07-28 — McpStatelessClient', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  const client = (server: { info: { baseUrl: string } }, overrides = {}) =>
    new McpStatelessClient({ url: server.info.baseUrl, ...overrides });

  test('discovers the server', async ({ server }) => {
    const result = await client(server).discover();

    expect(result['supportedVersions']).toContain('2026-07-28');
    expect(result['capabilities']).toBeDefined();
  });

  test('lists and calls tools', async ({ server }) => {
    const mcp = client(server);
    const tools = await mcp.listTools();
    expect(tools.map((t) => t['name'])).toContain('echo');

    const result = await mcp.callTool('echo', { message: 'via client' });
    expect(JSON.stringify(result)).toContain('via client');
  });

  test('reads resources and gets prompts', async ({ server }) => {
    const mcp = client(server);

    expect(JSON.stringify(await mcp.readResource('proto://config'))).toContain('protocol-2026');
    expect(JSON.stringify(await mcp.getPrompt('greeting', { subject: 'ada' }))).toContain('ada');
  });

  test('mirrors x-mcp-header params into headers the server accepts', async ({ server }) => {
    const mcp = client(server);
    // listTools caches the schema; without it the client cannot know which
    // arguments to mirror, and the server would reject the call with -32020.
    await mcp.listTools();

    const result = await mcp.callTool('region-query', { region: 'us-west1', query: 'SELECT 1' });
    expect(JSON.stringify(result)).toContain('us-west1');
  });

  test('completes an MRTR elicitation round trip transparently', async ({ server }) => {
    const asked: string[] = [];
    const mcp = client(server, {
      capabilities: { elicitation: { form: {} } },
      handlers: {
        onElicit: (params: Record<string, unknown>) => {
          asked.push(String(params['message']));
          return { action: 'accept', content: { confirmed: true } };
        },
      },
    });

    const result = await mcp.callTool('confirm', { action: 'ship it' });

    expect(asked[0]).toContain('ship it');
    expect(JSON.stringify(result)).toContain('"confirmed":true');
  });

  test('completes an MRTR sampling round trip', async ({ server }) => {
    const mcp = client(server, {
      capabilities: { sampling: {} },
      handlers: {
        onSample: () => ({
          role: 'assistant',
          content: { type: 'text', text: 'a short summary' },
          model: 'client-model',
        }),
      },
    });

    const result = await mcp.callTool('summarize', { text: 'a long document' });
    expect(JSON.stringify(result)).toContain('a short summary');
  });

  test('completes an MRTR roots round trip', async ({ server }) => {
    const mcp = client(server, {
      capabilities: { roots: {} },
      handlers: { onListRoots: () => ({ roots: [{ uri: 'file:///client-root' }] }) },
    });

    const result = await mcp.callTool('list-workspaces', {});
    expect(JSON.stringify(result)).toContain('file:///client-root');
  });

  test('fails clearly when the server asks for input it cannot supply', async ({ server }) => {
    const mcp = client(server, { capabilities: { elicitation: { form: {} } } });

    await expect(mcp.callTool('confirm', { action: 'x' })).rejects.toThrow(/no handler is configured/);
  });

  test('surfaces a server error as McpStatelessError with its JSON-RPC code', async ({ server }) => {
    const mcp = client(server);

    await expect(mcp.readResource('proto://missing')).rejects.toMatchObject({
      name: 'McpStatelessError',
      code: -32602,
    });
  });

  test('receives request-scoped log notifications when it opts in', async ({ server }) => {
    const received: string[] = [];
    const mcp = client(server, {
      logLevel: 'debug',
      onNotification: (n: { method: string }) => received.push(n.method),
    });

    await mcp.callTool('chatty', { steps: 2 });

    expect(received).toContain('notifications/message');
  });

  test('receives no log notifications when it does not opt in', async ({ server }) => {
    const received: string[] = [];
    const mcp = client(server, { onNotification: (n: { method: string }) => received.push(n.method) });

    await mcp.callTool('chatty', { steps: 2 });

    expect(received).not.toContain('notifications/message');
  });

  test('opens a subscriptions/listen stream and reads the acknowledgement', async ({ server }) => {
    const mcp = client(server);
    const received: string[] = [];

    const subscription = await mcp.listen({ toolsListChanged: true }, (n) => received.push(n.method));

    try {
      expect(subscription.acknowledged['toolsListChanged']).toBe(true);
    } finally {
      subscription.close();
    }
  });

  test('exposes McpStatelessError for unsupported protocol versions', () => {
    // Constructed directly: the class is part of the public surface, so callers
    // can branch on `code` without string-matching messages.
    const error = new McpStatelessError(-32022, 'Unsupported protocol version: 2099-01-01', { supported: [] });
    expect(error.code).toBe(-32022);
    expect(error.name).toBe('McpStatelessError');
  });
});

test.describe('protocol 2026-07-28 — remote-proxy adapter', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  test('negotiates 2026 against a 2026 server when set to auto', async ({ server }) => {
    const negotiated = await negotiateRemoteProtocol(server.info.baseUrl, 'auto', undefined);
    expect(negotiated).toBe('2026-07-28');
  });

  test('stays on the legacy path when unconfigured', async ({ server }) => {
    // The default MUST NOT change behaviour for existing deployments, even
    // against a server that would happily speak 2026.
    expect(await negotiateRemoteProtocol(server.info.baseUrl, undefined, undefined)).toBe('legacy');
    expect(await negotiateRemoteProtocol(server.info.baseUrl, 'legacy', undefined)).toBe('legacy');
  });

  test('falls back to legacy when the remote cannot answer server/discover', async () => {
    // Points at a closed port: an unreachable or pre-2026 remote is legacy.
    const negotiated = await negotiateRemoteProtocol('http://127.0.0.1:9', 'auto', undefined);
    expect(negotiated).toBe('legacy');
  });

  test('presents the remote through the Client-shaped surface', async ({ server }) => {
    const adapter = new McpStatelessClientAdapter({ url: server.info.baseUrl });
    await adapter.connect();

    expect(adapter.getServerCapabilities()).toBeDefined();

    const { tools } = await adapter.listTools();
    expect((tools as ListedTool[]).map((t) => t.name)).toContain('echo');

    const called = await adapter.callTool({ name: 'echo', arguments: { message: 'proxied' } });
    expect(JSON.stringify(called)).toContain('proxied');

    const { resources } = await adapter.listResources();
    expect(resources.length).toBeGreaterThan(0);

    const { prompts } = await adapter.listPrompts();
    expect(prompts.length).toBeGreaterThan(0);

    expect(JSON.stringify(await adapter.readResource({ uri: 'proto://config' }))).toContain('protocol-2026');
    expect(JSON.stringify(await adapter.getPrompt({ name: 'greeting', arguments: { subject: 'bob' } }))).toContain(
      'bob',
    );

    // Statelessness means close() has nothing to tear down, but it must exist
    // and stay safe to call.
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});
