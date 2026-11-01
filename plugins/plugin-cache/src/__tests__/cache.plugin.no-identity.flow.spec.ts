/** A caller with no identity is neither served nor stored an entry: no later call could build its key again. */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import CachePlugin from '../cache.plugin';
import CacheMemoryProvider from '../providers/cache-memory.provider';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

let executions = 0;

@Tool({ name: 'get_catalog', description: 'Returns the catalog', inputSchema: {}, cache: true })
class GetCatalogTool extends ToolContext {
  async execute() {
    executions += 1;
    return { execution: executions };
  }
}

@App({ id: 'catalog', name: 'Catalog', plugins: [CachePlugin.init({ type: 'memory' })], tools: [GetCatalogTool] })
class CatalogApp {}

let requestId = 1;

function callWithoutToken(): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': 'get_catalog',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestId++,
      method: 'tools/call',
      params: {
        name: 'get_catalog',
        arguments: {},
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'cache-spec', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
}

describe.each<[string, { auth?: { mode: 'public' } }]>([
  ['no auth configured', {}],
  ['public auth', { auth: { mode: 'public' } }],
])('CachePlugin over MCP 2026-07-28 without a token (%s)', (_label, serverOptions) => {
  let handler: (request: Request) => Promise<Response>;
  let getValue: jest.SpyInstance;
  let setValue: jest.SpyInstance;

  beforeAll(async () => {
    handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'cache-no-identity', version: '1.0.0' },
      apps: [CatalogApp],
      logging: { level: LogLevel.Off },
      ...serverOptions,
    });
  });

  beforeEach(() => {
    executions = 0;
    getValue = jest.spyOn(CacheMemoryProvider.prototype, 'getValue');
    setValue = jest.spyOn(CacheMemoryProvider.prototype, 'setValue');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs the tool on every call and neither reads nor stores an entry', async () => {
    for (let call = 0; call < 3; call++) {
      const response = await handler(callWithoutToken());
      expect(response.status).toBe(200);
      await response.text();
    }

    expect(executions).toBe(3);
    expect(getValue).not.toHaveBeenCalled();
    expect(setValue).not.toHaveBeenCalled();
  });
});
