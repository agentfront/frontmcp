/**
 * `remoteAuth` and the per-app retry options reach the wire (#766).
 *
 * The client connects over the real Streamable HTTP transport; only `fetch` is
 * replaced, by a minimal MCP server that records each request's headers.
 */
import { createMockLogger } from '../../__test-utils__/fixtures/flow.fixtures';
import { RemoteAuthError } from '../../errors';
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

function fakeMcpServer(options: { failCallsBeforeSuccess?: number; failWithStatus?: number; hang?: boolean } = {}) {
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
    if (message.method === 'tools/call' && failuresLeft-- > 0) {
      if (options.hang) return new Promise<Response>(() => undefined);
      if (options.failWithStatus) return new Response('boom', { status: options.failWithStatus });
      throw new Error('fetch failed: ECONNRESET');
    }
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

  it('does not follow a redirect while credentials ride along', async () => {
    const { fetchMock } = fakeMcpServer();

    await service.connect(
      connectRequest({ auth: { mode: 'static', credentials: { type: 'bearer', value: 'static-token' } } }),
    );
    await service.callTool('upstream', 'echo', {});

    const credentialedCalls = fetchMock.mock.calls.filter(([, init]) =>
      new Headers(init?.headers).has('authorization'),
    );
    expect(credentialedCalls.length).toBeGreaterThan(0);
    for (const [, init] of credentialedCalls) expect(init?.redirect).toBe('manual');
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

  it('fails the call with RemoteAuthError when the mapper throws', async () => {
    fakeMcpServer();
    await service.connect(
      connectRequest({
        auth: {
          mode: 'mapped',
          mapper: () => {
            throw new Error('no key for this caller');
          },
        },
      }),
    );

    await expect(service.callTool('upstream', 'echo', {})).rejects.toThrow(RemoteAuthError);
  });

  it('fails a call the remote refused with HTTP 401 with RemoteAuthError, without retrying it', async () => {
    const { requests } = fakeMcpServer({ failCallsBeforeSuccess: 1, failWithStatus: 401 });
    await service.connect(connectRequest({ transportOptions: { retryAttempts: 2, retryDelayMs: 1 } }));

    await expect(service.callTool('upstream', 'echo', {})).rejects.toThrow(
      'Authentication failed for remote server "upstream": the remote server refused the credentials (HTTP 401)',
    );
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(1);
  });

  it('retries a call retryAttempts times, waiting retryDelayMs', async () => {
    const { requests } = fakeMcpServer({ failCallsBeforeSuccess: 2 });
    await service.connect(connectRequest({ transportOptions: { retryAttempts: 2, retryDelayMs: 1 } }));

    await expect(service.callTool('upstream', 'echo', {})).resolves.toEqual(expect.objectContaining({}));
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(3);
  });

  it.each([503, 429, 408])(
    'retries a call the remote answered with HTTP %i, whatever the body says',
    async (status) => {
      const { requests } = fakeMcpServer({ failCallsBeforeSuccess: 2, failWithStatus: status });
      await service.connect(connectRequest({ transportOptions: { retryAttempts: 2, retryDelayMs: 1 } }));

      await expect(service.callTool('upstream', 'echo', {})).resolves.toEqual(expect.objectContaining({}));
      expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(3);
    },
  );

  it('retries a call that ran past transportOptions.timeout', async () => {
    const { requests } = fakeMcpServer({ failCallsBeforeSuccess: 1, hang: true });
    await service.connect(connectRequest({ transportOptions: { timeout: 50, retryAttempts: 2, retryDelayMs: 1 } }));

    await expect(service.callTool('upstream', 'echo', {})).resolves.toEqual(expect.objectContaining({}));
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(2);
  });

  it('clears the call timeout once the call settles', async () => {
    fakeMcpServer();
    await service.connect(connectRequest({ transportOptions: { timeout: 43_210 } }));
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    await service.callTool('upstream', 'echo', {});

    const callTimeoutIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 43_210);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[callTimeoutIndex]?.value);
  });

  it('does not retry a call the remote rejected with HTTP 400', async () => {
    const { requests } = fakeMcpServer({ failCallsBeforeSuccess: 1, failWithStatus: 400 });
    await service.connect(connectRequest({ transportOptions: { retryAttempts: 2, retryDelayMs: 1 } }));

    await expect(service.callTool('upstream', 'echo', {})).rejects.toThrow('boom');
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(1);
  });

  it('does not retry with retryAttempts: 0', async () => {
    const { requests } = fakeMcpServer({ failCallsBeforeSuccess: 1 });
    await service.connect(connectRequest({ transportOptions: { retryAttempts: 0 } }));

    await expect(service.callTool('upstream', 'echo', {})).rejects.toThrow();
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(1);
  });
});
