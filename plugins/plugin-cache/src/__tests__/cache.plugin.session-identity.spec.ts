/** The cache keys by session only when the server verified it; principals key on every transport (#597). */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type FlowCtxOf } from '@frontmcp/sdk';

import CachePlugin from '../cache.plugin';
import { CacheStoreToken } from '../cache.symbol';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

interface RequestContextFixture {
  sessionId: string;
  verifiedSessionId: string | undefined;
}

function createHarness() {
  const plugin = new CachePlugin({ type: 'memory', toolPatterns: ['test:*'] });
  const store = {
    getValue: jest.fn().mockResolvedValue(undefined),
    setValue: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const resolve = (token: unknown): unknown => (token === CacheStoreToken ? store : { getStore: () => undefined });
  (plugin as unknown as { get: (token: unknown) => unknown }).get = resolve;
  return { plugin, store };
}

function flowCtxWithoutPrincipal(requestContext: RequestContextFixture): FlowCtxOf<'tools:call-tool'> {
  return {
    state: {
      tool: { fullName: 'test:getReport', name: 'test:getReport', safeParseOutput: () => ({ success: true }) },
      toolContext: {
        metadata: { cache: true },
        input: {},
        output: { report: 'r' },
        authInfo: undefined,
        tryGetContext: () => requestContext,
        respond: jest.fn(),
      },
    },
  } as unknown as FlowCtxOf<'tools:call-tool'>;
}

describe('CachePlugin — session identity (#597)', () => {
  it('keys a caller without a principal by the session the server verified', async () => {
    const { plugin, store } = createHarness();
    const session = { sessionId: 'session-1', verifiedSessionId: 'session-1' };

    await plugin.willWriteCache(flowCtxWithoutPrincipal(session));
    await plugin.willReadCache(flowCtxWithoutPrincipal(session));

    expect(store.getValue.mock.calls[0][0]).toBe(store.setValue.mock.calls[0][0]);
  });

  it('does not key by a session id the server did not verify', async () => {
    const { plugin, store } = createHarness();
    const presented = { sessionId: 'session-1', verifiedSessionId: undefined };

    await plugin.willWriteCache(flowCtxWithoutPrincipal(presented));
    await plugin.willReadCache(flowCtxWithoutPrincipal(presented));

    expect(store.getValue.mock.calls[0][0]).not.toBe(store.setValue.mock.calls[0][0]);
  });
});

let executions = 0;

@Tool({ name: 'get_report', description: 'Returns the caller report', inputSchema: {}, cache: true })
class GetReportTool extends ToolContext {
  async execute() {
    executions += 1;
    return { owner: this.getAuthInfo().clientId ?? 'nobody', execution: executions };
  }
}

@App({ id: 'reports', name: 'Reports', plugins: [CachePlugin.init({ type: 'memory' })], tools: [GetReportTool] })
class ReportsApp {}

describe('CachePlugin over stateless HTTP without mcp-session-id (#597)', () => {
  const issuer = 'https://auth.example.com';
  let signToken: (subject: string) => Promise<string>;
  let handler: (request: Request) => Promise<Response>;
  let requestId = 1;

  async function getReport(subject: string): Promise<string> {
    const response = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${await signToken(subject)}`,
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'get_report',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestId++,
          method: 'tools/call',
          params: {
            name: 'get_report',
            arguments: {},
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'cache-spec', version: '1.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    );
    return response.text();
  }

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'cache-spec', alg: 'RS256', use: 'sig' };
    signToken = (subject) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'cache-spec' })
        .setIssuer(issuer)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey);
    handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'cache-stateless-session', version: '1.0.0' },
      apps: [ReportsApp],
      auth: { mode: 'transparent', provider: issuer, providerConfig: { jwks: { keys: [jwk] } } },
      logging: { level: LogLevel.Off },
    });
  });

  beforeEach(() => {
    executions = 0;
  });

  it('serves a principal its own entry in a later request', async () => {
    await getReport('alice');

    expect(await getReport('alice')).toContain('\\"execution\\":1');
  });

  it('does not serve one principal the entry cached for another', async () => {
    await getReport('carol');

    const response = await getReport('dave');

    expect(response).toContain('\\"owner\\":\\"dave\\"');
    expect(response).toContain('\\"execution\\":2');
  });
});
