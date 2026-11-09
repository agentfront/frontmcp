/**
 * Over a session, the client asks for the server's log messages with `logging/setLevel` after `initialize`.
 */
import type { LoggingLevel } from '@frontmcp/protocol';

import { McpTestClient } from '../mcp-test-client';

interface SentMessage {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

function stubSessionServer(capabilities: Record<string, unknown>): SentMessage[] {
  const sent: SentMessage[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    const message = JSON.parse(String(init?.body)) as SentMessage;
    sent.push(message);
    if (message.id === undefined) return new Response(null, { status: 202 });
    const result =
      message.method === 'initialize'
        ? { protocolVersion: '2025-06-18', capabilities, serverInfo: { name: 'test', version: '1.0.0' } }
        : {};
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
    });
  }) as typeof fetch;
  return sent;
}

async function connectedClient(mcpLogLevel?: LoggingLevel | false): Promise<McpTestClient> {
  const client = McpTestClient.create({ baseUrl: 'http://localhost:3011', publicMode: true, mcpLogLevel }).build();
  await client.connect();
  await client.disconnect();
  return client;
}

describe('McpTestClient log level', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("asks for every log message by default, once the server's initialize result says it logs", async () => {
    const sent = stubSessionServer({ logging: {} });

    await connectedClient();

    expect(sent.map(({ method }) => method)).toEqual(['initialize', 'notifications/initialized', 'logging/setLevel']);
    expect(sent[2].params).toEqual({ level: 'debug' });
  });

  it('asks for the configured level', async () => {
    const sent = stubSessionServer({ logging: {} });

    await connectedClient('warning');

    expect(sent.find(({ method }) => method === 'logging/setLevel')?.params).toEqual({ level: 'warning' });
  });

  it('asks for none with mcpLogLevel false', async () => {
    const sent = stubSessionServer({ logging: {} });

    await connectedClient(false);

    expect(sent.map(({ method }) => method)).not.toContain('logging/setLevel');
  });

  it('asks for none from a server without the logging capability', async () => {
    const sent = stubSessionServer({});

    await connectedClient();

    expect(sent.map(({ method }) => method)).not.toContain('logging/setLevel');
  });
});
