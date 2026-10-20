import { join } from 'path';

import { StdioJsonRpcProcess, type JsonRpcMessage } from './helpers/stdio-json-rpc';

const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';
const SERVER_INFO = { name: 'Stdio Transport E2E', version: '0.1.0' };

const projectPath = join(__dirname, '..');
const entrypointPath = join(projectPath, 'src/stdio-elicitation-entrypoint.ts');

let nextId = 1;

function modernRequest(
  method: string,
  params: Record<string, unknown> = {},
  meta: Record<string, unknown> = {},
): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_KEY]: '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'stdio-e2e', version: '1.0.0' },
        [CLIENT_CAPABILITIES_KEY]: {},
        ...meta,
      },
    },
  };
}

function legacyRequest(method: string, params: Record<string, unknown> = {}): JsonRpcMessage {
  return { jsonrpc: '2.0', id: nextId++, method, params };
}

describe('Stdio transport serving MCP 2026-07-28', () => {
  let server: StdioJsonRpcProcess;

  beforeAll(() => {
    server = StdioJsonRpcProcess.start(entrypointPath, projectPath);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('answers server/discover with the five supported revisions', async () => {
    const { result, error } = await server.request(modernRequest('server/discover'));

    expect(error).toBeUndefined();
    expect(result?.['supportedVersions']).toEqual([
      '2026-07-28',
      '2025-11-25',
      '2025-06-18',
      '2025-03-26',
      '2024-11-05',
    ]);
    expect(result?.['resultType']).toBe('complete');
  }, 60_000);

  it('answers a stateless tools/call with resultType "complete" and the serverInfo _meta', async () => {
    const { result, error } = await server.request(
      modernRequest('tools/call', { name: 'create-note', arguments: { title: 'Stateless', content: 'over stdio' } }),
    );

    expect(error).toBeUndefined();
    expect(result?.['resultType']).toBe('complete');
    expect(result?._meta?.[SERVER_INFO_KEY]).toEqual(SERVER_INFO);
    expect(result?.['structuredContent']).toMatchObject({ title: 'Stateless', content: 'over stdio' });
  });

  it('asks for confirmation with input_required, and completes the retry that answers it', async () => {
    const capabilities = { [CLIENT_CAPABILITIES_KEY]: { elicitation: { form: {} } } };
    const params = { name: 'clear-notes', arguments: {} };

    const interim = await server.request(modernRequest('tools/call', params, capabilities));
    expect(interim.result?.['resultType']).toBe('input_required');
    const inputRequests = interim.result?.['inputRequests'] as Record<string, { method: string }>;
    const [key] = Object.keys(inputRequests);
    expect(inputRequests[key].method).toBe('elicitation/create');
    expect(typeof interim.result?.['requestState']).toBe('string');

    const final = await server.request(
      modernRequest(
        'tools/call',
        {
          ...params,
          inputResponses: { [key]: { action: 'accept', content: { confirmed: true } } },
          requestState: interim.result?.['requestState'],
        },
        capabilities,
      ),
    );

    expect(final.error).toBeUndefined();
    expect(final.result?.['resultType']).toBe('complete');
    expect(final.result?.['structuredContent']).toEqual({ cleared: 1 });
  });

  it('answers -32021 when the tool elicits from a client without the elicitation capability', async () => {
    const { error } = await server.request(modernRequest('tools/call', { name: 'clear-notes', arguments: {} }));

    expect(error?.code).toBe(-32021);
    expect(error?.data?.['requiredCapabilities']).toEqual({ elicitation: { form: {} } });
  });

  it('answers -32022 with the supported revisions for a revision it does not speak', async () => {
    const { error } = await server.request(modernRequest('tools/list', {}, { [PROTOCOL_VERSION_KEY]: '1900-01-01' }));

    expect(error?.code).toBe(-32022);
    expect(error?.data?.['supported']).toContain('2026-07-28');
    expect(error?.data?.['requested']).toBe('1900-01-01');
  });

  it('writes nothing but JSON-RPC to stdout', () => {
    for (const line of server.stdoutLines) {
      expect(JSON.parse(line)).toHaveProperty('jsonrpc', '2.0');
    }
  });
});

describe('Stdio transport serving an initialize session', () => {
  let server: StdioJsonRpcProcess;

  beforeAll(() => {
    server = StdioJsonRpcProcess.start(entrypointPath, projectPath);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('negotiates the requested revision and answers tools/call as before', async () => {
    const initialize = await server.request(
      legacyRequest('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'stdio-e2e-legacy', version: '1.0.0' },
      }),
    );
    expect(initialize.result?.['protocolVersion']).toBe('2025-11-25');
    server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const { result, error } = await server.request(
      legacyRequest('tools/call', { name: 'create-note', arguments: { title: 'Session', content: 'legacy' } }),
    );

    expect(error).toBeUndefined();
    expect(result?.['structuredContent']).toMatchObject({ title: 'Session', content: 'legacy' });
    expect(result?.['resultType']).toBeUndefined();
    expect(result?._meta?.[SERVER_INFO_KEY]).toBeUndefined();
  }, 60_000);

  it('serves a 2026-07-28 request on the same connection, and keeps unversioned ones in the session', async () => {
    const modern = await server.request(modernRequest('tools/call', { name: 'list-notes', arguments: {} }));
    const legacy = await server.request(legacyRequest('tools/call', { name: 'list-notes', arguments: {} }));

    expect(modern.result?.['resultType']).toBe('complete');
    expect(legacy.result?.['resultType']).toBeUndefined();
    expect(legacy.result?.['structuredContent']).toMatchObject({ count: 1 });
  });
});
