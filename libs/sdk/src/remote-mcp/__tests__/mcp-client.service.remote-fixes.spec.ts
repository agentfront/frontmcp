/**
 * A legacy remote's `Retry-After`, per-connection `refreshInterval`, refreshes that notice a changed list,
 * `timeout` on every request, and the circuit breaker's public error.
 *
 * The client connects over the real Streamable HTTP transport; only `fetch` is replaced, by a minimal MCP server.
 */
import { createMockLogger } from '../../__test-utils__/fixtures/flow.fixtures';
import type { FrontMcpLogger } from '../../common';
import { PublicMcpError, RemoteConnectionError, RemoteTimeoutError } from '../../errors';
import { McpClientService } from '../mcp-client.service';
import type { McpConnectRequest } from '../mcp-client.types';
import { CircuitOpenError } from '../resilience';

interface FakeRemote {
  /** Methods the remote never answers. */
  hang?: string[];
  /** The `tools/call` answers, in order, until one is a success. */
  callFailures?: Response[];
  tools?: () => Array<Record<string, unknown>>;
}

function fakeRemote(remote: FakeRemote = {}) {
  const callFailures = [...(remote.callFailures ?? [])];
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (init?.method !== 'POST') return new Response(null, { status: 405 });
    const message = JSON.parse(String(init.body)) as { id?: number; method: string };
    if (message.id === undefined) return new Response(null, { status: 202 });
    if (remote.hang?.includes(message.method)) return new Promise<Response>(() => undefined);
    if (message.method === 'tools/call' && callFailures.length > 0) return callFailures.shift() as Response;
    const results: Record<string, unknown> = {
      initialize: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'u', version: '1' },
      },
      'tools/list': { tools: remote.tools?.() ?? [{ name: 'echo', inputSchema: { type: 'object' } }] },
      'tools/call': { content: [{ type: 'text', text: 'ok' }] },
      'resources/list': { resources: [] },
      'resources/templates/list': { resourceTemplates: [] },
      'prompts/list': { prompts: [{ name: 'greet' }] },
    };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: results[message.method] ?? {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function connectRequest(overrides: Partial<McpConnectRequest> = {}): McpConnectRequest {
  return { appId: 'upstream', name: 'upstream', transportType: 'http', url: 'http://remote.test/mcp', ...overrides };
}

describe('McpClientService — remote app fixes', () => {
  let logger: FrontMcpLogger;
  let service: McpClientService;

  beforeEach(() => {
    logger = createMockLogger();
    service = new McpClientService(logger, { enableHealthCheck: false, enableAutoReconnect: false });
  });

  afterEach(async () => {
    await service.dispose();
    jest.restoreAllMocks();
  });

  it("waits the Retry-After of a legacy remote's refusal instead of the backoff", async () => {
    fakeRemote({ callFailures: [new Response('busy', { status: 503, headers: { 'retry-after': '0' } })] });
    await service.connect(connectRequest({ transportOptions: { retryAttempts: 1, retryDelayMs: 2_000 } }));

    await expect(service.callTool('upstream', 'echo', {})).resolves.toEqual(expect.objectContaining({}));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/^Retry 1 for tool echo on upstream after 0ms/));
  });

  it("refreshes each connection at its own refreshInterval, and notices a list whose length didn't change", async () => {
    let description = 'Echoes';
    fakeRemote({ tools: () => [{ name: 'echo', description, inputSchema: { type: 'object' } }] });
    const changed = new Promise((resolve) => service.onCapabilityChange(resolve));

    await service.connect(connectRequest({ refreshInterval: 20 }));
    description = 'Echoes the message';

    await expect(changed).resolves.toEqual(
      expect.objectContaining({ appId: 'upstream', kind: 'tools', previousCount: 1, newCount: 1 }),
    );
  });

  it('does not refresh a connection whose refreshInterval is 0', async () => {
    fakeRemote();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    await service.connect(connectRequest({ refreshInterval: 0 }));

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('limits connecting to the timeout', async () => {
    fakeRemote({ hang: ['initialize'] });

    const connecting = service.connect(connectRequest({ transportOptions: { timeout: 50, fallbackToSSE: false } }));

    await expect(connecting).rejects.toThrow(RemoteConnectionError);
    await expect(connecting).rejects.toThrow('Remote operation "connect" on "upstream" timed out after 50ms');
  });

  it('limits resource reads and prompts to the timeout', async () => {
    fakeRemote({ hang: ['resources/read', 'prompts/get'] });
    await service.connect(connectRequest({ transportOptions: { timeout: 50 } }));

    await expect(service.readResource('upstream', 'status://now')).rejects.toThrow(RemoteTimeoutError);
    await expect(service.getPrompt('upstream', 'greet', {})).rejects.toThrow(
      'Remote operation "greet" on "upstream" timed out after 50ms',
    );
  });

  it('fails calls with a public REMOTE_CIRCUIT_OPEN error while the circuit is open', async () => {
    fakeRemote();
    await service.connect(connectRequest());
    const breaker = (
      service as unknown as { circuitBreakerManager: { getBreaker(id: string): unknown } }
    ).circuitBreakerManager.getBreaker('upstream') as { recordFailure(error: Error): void };
    for (let failure = 0; failure < 5; failure++) breaker.recordFailure(new Error('boom'));

    const call = service.callTool('upstream', 'echo', {});

    await expect(call).rejects.toThrow(CircuitOpenError);
    await expect(call).rejects.toThrow(PublicMcpError);
    await expect(call).rejects.toMatchObject({ code: 'REMOTE_CIRCUIT_OPEN', statusCode: 503 });
  });
});
