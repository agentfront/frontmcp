/**
 * `remoteAuth` and the per-app retry options reach the wire (#766).
 *
 * The client connects over the real Streamable HTTP transport; only `fetch` is
 * replaced, by a minimal MCP server that records each request's headers.
 */
import { createMockLogger } from '../../__test-utils__/fixtures/flow.fixtures';
import { McpClientService } from '../mcp-client.service';
import type { McpConnectRequest } from '../mcp-client.types';

interface RecordedRequest {
  method: string;
  authorization: string | null;
  apiKey: string | null;
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function fakeMcpServer(options: { failCallsBeforeSuccess?: number } = {}) {
  const requests: RecordedRequest[] = [];
  let failuresLeft = options.failCallsBeforeSuccess ?? 0;
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (init?.method !== 'POST') return new Response(null, { status: 405 });
    const message = JSON.parse(String(init.body)) as { id?: number; method: string };
    const headers = new Headers(init.headers);
    requests.push({
      method: message.method,
      authorization: headers.get('authorization'),
      apiKey: headers.get('x-api-key'),
    });
    if (message.id === undefined) return new Response(null, { status: 202 });
    if (message.method === 'tools/call' && failuresLeft-- > 0) throw new Error('fetch failed: ECONNRESET');
    const results: Record<string, unknown> = {
      initialize: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'u', version: '1' },
      },
      'tools/list': { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] },
      'tools/call': { content: [{ type: 'text', text: 'ok' }] },
    };
    const result = results[message.method] ?? { resources: [], resourceTemplates: [], prompts: [] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { requests, fetchMock };
}

function connectRequest(overrides: Partial<McpConnectRequest>): McpConnectRequest {
  return { appId: 'upstream', name: 'upstream', transportType: 'http', url: 'http://remote.test/mcp', ...overrides };
}

describe('McpClientService — remoteAuth and retries', () => {
  let service: McpClientService;

  beforeEach(() => {
    service = new McpClientService(createMockLogger(), { enableHealthCheck: false, enableAutoReconnect: false });
  });

  afterEach(async () => {
    await service.dispose();
    jest.restoreAllMocks();
  });

  it('sends static credentials and transportOptions.headers with every request', async () => {
    const { requests } = fakeMcpServer();

    await service.connect(
      connectRequest({
        transportOptions: { headers: { 'x-api-key': 'team-a' } },
        auth: { mode: 'static', credentials: { type: 'bearer', value: 'static-token' } },
      }),
    );
    await service.callTool('upstream', 'echo', {});

    expect(requests.length).toBeGreaterThan(2);
    for (const request of requests) {
      expect(request).toEqual(expect.objectContaining({ authorization: 'Bearer static-token', apiKey: 'team-a' }));
    }
  });

  it("forwards the caller's token on its own calls only", async () => {
    const { requests } = fakeMcpServer();
    await service.connect(connectRequest({ auth: { mode: 'forward' } }));

    await service.callTool('upstream', 'echo', {}, { authInfo: { token: 'user-token' } });

    const call = requests.find((request) => request.method === 'tools/call');
    expect(call?.authorization).toBe('Bearer user-token');
    expect(requests.filter((request) => request.method !== 'tools/call').map((r) => r.authorization)).toEqual(
      requests.filter((request) => request.method !== 'tools/call').map(() => null),
    );
  });

  it('forwards one claim of the caller token with tokenClaim, under headerName', async () => {
    const { requests } = fakeMcpServer();
    await service.connect(
      connectRequest({ auth: { mode: 'forward', tokenClaim: 'upstream_token', headerName: 'x-api-key' } }),
    );

    await service.callTool('upstream', 'echo', {}, { authInfo: { token: jwt({ upstream_token: 'abc' }) } });

    expect(requests.find((request) => request.method === 'tools/call')?.apiKey).toBe('Bearer abc');
  });

  it('sends mapped credentials for the caller', async () => {
    const { requests } = fakeMcpServer();
    await service.connect(
      connectRequest({
        auth: { mode: 'mapped', mapper: (authInfo) => ({ type: 'apiKey', value: `key-for-${authInfo?.clientId}` }) },
      }),
    );

    await service.callTool('upstream', 'echo', {}, { authInfo: { clientId: 'desk' } });

    expect(requests.find((request) => request.method === 'tools/call')?.apiKey).toBe('key-for-desk');
  });

  it('retries a call retryAttempts times, waiting retryDelayMs', async () => {
    const { requests } = fakeMcpServer({ failCallsBeforeSuccess: 2 });
    await service.connect(connectRequest({ transportOptions: { retryAttempts: 2, retryDelayMs: 1 } }));

    await expect(service.callTool('upstream', 'echo', {})).resolves.toEqual(expect.objectContaining({}));
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(3);
  });

  it('does not retry with retryAttempts: 0', async () => {
    const { requests } = fakeMcpServer({ failCallsBeforeSuccess: 1 });
    await service.connect(connectRequest({ transportOptions: { retryAttempts: 0 } }));

    await expect(service.callTool('upstream', 'echo', {})).rejects.toThrow();
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(1);
  });
});
