// A remote connection reads only the MCP client exports it uses, so the CommonJS build loads no unused transport (#951)
import { createMockLogger } from '../../__test-utils__/fixtures/flow.fixtures';
import { McpClientService } from '../mcp-client.service';

const mockReadExports: string[] = [];

jest.mock('#protocol-client', () => {
  const actual = jest.requireActual('@frontmcp/protocol/client');
  const recording = {};
  for (const name of ['Client', 'StreamableHTTPClientTransport', 'SSEClientTransport', 'StdioClientTransport']) {
    Object.defineProperty(recording, name, {
      enumerable: true,
      get: () => {
        mockReadExports.push(name);
        return actual[name];
      },
    });
  }
  return { loadProtocolClient: async () => recording };
});

function fakeMcpServer(): void {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (init?.method !== 'POST') return new Response(null, { status: 405 });
    const message = JSON.parse(String(init.body)) as { id?: number; method: string };
    if (message.id === undefined) return new Response(null, { status: 202 });
    const result =
      message.method === 'initialize'
        ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'u', version: '1' } }
        : { tools: [], resources: [], resourceTemplates: [], prompts: [] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('McpClientService — MCP client exports read on connect', () => {
  let service: McpClientService;

  beforeEach(() => {
    mockReadExports.length = 0;
    service = new McpClientService(createMockLogger(), { enableHealthCheck: false, enableAutoReconnect: false });
  });

  afterEach(async () => {
    await service.dispose();
    jest.restoreAllMocks();
  });

  it('reads the Streamable HTTP transport, not the SSE one, for an HTTP remote that connects', async () => {
    fakeMcpServer();

    await service.connect({
      appId: 'upstream',
      name: 'upstream',
      transportType: 'http',
      url: 'http://remote.test/mcp',
    });

    expect(new Set(mockReadExports)).toEqual(new Set(['Client', 'StreamableHTTPClientTransport']));
  });
});
