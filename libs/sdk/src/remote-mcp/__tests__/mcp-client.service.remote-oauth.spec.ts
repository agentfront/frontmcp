/**
 * `remoteAuth: { mode: 'oauth', clientId, clientSecret }`: client credentials from the remote's authorization
 * server, found through its protected resource metadata, on every request; renewed on expiry and on a 401.
 *
 * Only `fetch` is replaced: by the remote's authorization server and a minimal MCP server that wants its token.
 */
import { createMockLogger } from '../../__test-utils__/fixtures/flow.fixtures';
import { frontMcpRemoteAppMetadataSchema } from '../../common';
import { RemoteAuthError, RemoteConnectionError } from '../../errors';
import { McpClientService } from '../mcp-client.service';
import type { McpConnectRequest, McpRemoteAuthConfig } from '../mcp-client.types';

interface TokenRequest {
  authorization: string | null;
  body: URLSearchParams;
}

interface FakeOptions {
  expiresIn?: number;
  tokenStatus?: number;
  /** The authorization server the remote's protected resource metadata names. */
  namedServer?: string;
  /** The resource the remote's protected resource metadata names. */
  resource?: string;
  /** The token endpoint the authorization servers publish, instead of their own `/token`. */
  tokenEndpoint?: string;
}

function fakeRemoteWithAuthServer(options: FakeOptions = {}) {
  const tokenRequests: TokenRequest[] = [];
  const mcpAuthorizations: Array<string | null> = [];
  const accepted = new Set<string>();
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url.href === 'http://remote.test/.well-known/oauth-protected-resource/mcp') {
      return json({
        resource: options.resource ?? 'http://remote.test/mcp',
        authorization_servers: [options.namedServer ?? 'http://auth.test'],
      });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json({ issuer: url.origin, token_endpoint: options.tokenEndpoint ?? `${url.origin}/token` });
    }
    if (url.pathname === '/token' || url.href === 'http://tokens.test/issue') {
      const headers = new Headers(init?.headers);
      tokenRequests.push({
        authorization: headers.get('authorization'),
        body: new URLSearchParams(String(init?.body)),
      });
      if (options.tokenStatus) return json({ error: 'invalid_client' }, options.tokenStatus);
      const token = `token-${tokenRequests.length}`;
      accepted.add(token);
      return json({ access_token: token, token_type: 'Bearer', expires_in: options.expiresIn ?? 3600 });
    }
    if (url.host !== 'remote.test' || init?.method !== 'POST') return new Response(null, { status: 404 });

    const authorization = new Headers(init.headers).get('authorization');
    mcpAuthorizations.push(authorization);
    if (!authorization || !accepted.has(authorization.replace('Bearer ', ''))) {
      return new Response(null, { status: 401 });
    }
    const message = JSON.parse(String(init.body)) as { id?: number; method: string };
    if (message.id === undefined) return new Response(null, { status: 202 });
    const results: Record<string, unknown> = {
      initialize: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'u', version: '1' },
      },
      'tools/list': { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] },
      'tools/call': { content: [{ type: 'text', text: 'ok' }] },
    };
    return json({ jsonrpc: '2.0', id: message.id, result: results[message.method] ?? {} });
  });
  return { fetchMock, tokenRequests, mcpAuthorizations, revoke: (token: string) => accepted.delete(token) };
}

const credentials = {
  mode: 'oauth',
  clientId: 'help-desk',
  clientSecret: 's3cret',
  scope: 'status:read',
  issuer: 'http://auth.test',
} as const;
const { issuer: _issuer, ...withoutIssuer } = credentials;

function connectRequest(auth: McpRemoteAuthConfig): McpConnectRequest {
  return {
    appId: 'status',
    name: 'status',
    transportType: 'http',
    url: 'http://remote.test/mcp',
    transportOptions: { fallbackToSSE: false },
    auth,
  };
}

describe("McpClientService — remoteAuth: { mode: 'oauth' }", () => {
  const logger = createMockLogger();
  let service: McpClientService;

  beforeEach(() => {
    service = new McpClientService(logger, { enableHealthCheck: false, enableAutoReconnect: false });
  });

  afterEach(async () => {
    await service.dispose();
    jest.restoreAllMocks();
  });

  it("sends a token from the remote's authorization server with every request, connecting included", async () => {
    const { tokenRequests, mcpAuthorizations } = fakeRemoteWithAuthServer();

    await service.connect(connectRequest(credentials));
    await service.callTool('status', 'echo', {});

    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.authorization).toBe(`Basic ${Buffer.from('help-desk:s3cret').toString('base64')}`);
    expect(Object.fromEntries(tokenRequests[0]?.body ?? [])).toEqual({
      grant_type: 'client_credentials',
      resource: 'http://remote.test/mcp',
      scope: 'status:read',
    });
    expect(mcpAuthorizations.length).toBeGreaterThan(2);
    expect(new Set(mcpAuthorizations)).toEqual(new Set(['Bearer token-1']));
  });

  it('gets a new token when the remote refuses the one it has, and sends the request again', async () => {
    const { tokenRequests, revoke } = fakeRemoteWithAuthServer();
    await service.connect(connectRequest(credentials));
    revoke('token-1');

    await expect(service.callTool('status', 'echo', {})).resolves.toEqual(expect.objectContaining({}));
    expect(tokenRequests).toHaveLength(2);
  });

  it('gets a new token before the one it has expires', async () => {
    const { tokenRequests, mcpAuthorizations } = fakeRemoteWithAuthServer({ expiresIn: 10 });

    await service.connect(connectRequest(credentials));

    expect(tokenRequests.length).toBeGreaterThan(1);
    expect(new Set(mcpAuthorizations).size).toBe(mcpAuthorizations.length);
  });

  it('asks the tokenUrl it is given', async () => {
    const { tokenRequests, fetchMock } = fakeRemoteWithAuthServer();

    await service.connect(connectRequest({ ...credentials, tokenUrl: 'http://tokens.test/issue' }));

    expect(tokenRequests).toHaveLength(1);
    const asked = fetchMock.mock.calls.map(([input]) => String(input));
    expect(asked).toContain('http://tokens.test/issue');
    expect(asked).not.toContain('http://auth.test/token');
  });

  it("uses the remote's own authorization server when it is on the remote's origin, with no issuer set", async () => {
    const { tokenRequests, fetchMock } = fakeRemoteWithAuthServer({ namedServer: 'http://remote.test' });

    await service.connect(connectRequest(withoutIssuer));

    expect(tokenRequests).toHaveLength(1);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain('http://remote.test/token');
  });

  it('sends the client secret to the issuer it is given, not to the server the remote names', async () => {
    const { tokenRequests, fetchMock } = fakeRemoteWithAuthServer({ namedServer: 'http://elsewhere.test' });

    await service.connect(connectRequest(credentials));

    expect(tokenRequests).toHaveLength(1);
    const asked = fetchMock.mock.calls.map(([input]) => new URL(String(input)).host);
    expect(asked).toContain('auth.test');
    expect(asked).not.toContain('elsewhere.test');
  });

  it('sends nothing to an authorization server the remote names on another origin, with no issuer set', async () => {
    const { tokenRequests, fetchMock } = fakeRemoteWithAuthServer();

    const connecting = service.connect(connectRequest(withoutIssuer));

    await expect(connecting).rejects.toMatchObject({ originalError: expect.any(RemoteAuthError) });
    await expect(connecting).rejects.toThrow(
      /names the authorization server http:\/\/auth\.test, which is not on http:\/\/remote\.test.*set remoteAuth\.issuer/,
    );
    expect(tokenRequests).toHaveLength(0);
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).host)).not.toContain('auth.test');
  });

  it("sends nothing to a token endpoint off the remote's origin that the remote's own server publishes", async () => {
    const { tokenRequests } = fakeRemoteWithAuthServer({
      namedServer: 'http://remote.test',
      tokenEndpoint: 'http://elsewhere.test/token',
    });

    const connecting = service.connect(connectRequest(withoutIssuer));

    await expect(connecting).rejects.toThrow(/publishes the token endpoint http:\/\/elsewhere\.test\/token/);
    expect(tokenRequests).toHaveLength(0);
  });

  it('asks no token for a resource the remote names on another origin', async () => {
    const { tokenRequests } = fakeRemoteWithAuthServer({ resource: 'http://payroll.test/api' });

    const connecting = service.connect(connectRequest(credentials));

    await expect(connecting).rejects.toThrow(/names the resource http:\/\/payroll\.test\/api, which is not on/);
    expect(tokenRequests).toHaveLength(0);
  });

  it('does not start when the authorization server refuses the client', async () => {
    fakeRemoteWithAuthServer({ tokenStatus: 401 });

    const connecting = service.connect(connectRequest(credentials));

    await expect(connecting).rejects.toThrow(RemoteConnectionError);
    await expect(connecting).rejects.toMatchObject({
      originalError: expect.any(RemoteAuthError),
    });
    await expect(connecting).rejects.toThrow('the token endpoint answered HTTP 401: invalid_client');
  });

  it('sends nothing without clientId and clientSecret, and warns', async () => {
    const { tokenRequests } = fakeRemoteWithAuthServer();

    await expect(service.connect(connectRequest({ mode: 'oauth' }))).rejects.toThrow(RemoteConnectionError);
    expect(tokenRequests).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'remoteAuth oauth for status has no clientId and clientSecret, so no credentials are sent',
    );
  });
});

describe('remoteAuth oauth config', () => {
  const app = { name: 'status', urlType: 'url', url: 'https://status.example/mcp', standalone: false };

  it('keeps the client credentials', () => {
    const parsed = frontMcpRemoteAppMetadataSchema.parse({ ...app, remoteAuth: credentials });

    expect(parsed.remoteAuth).toEqual(credentials);
  });

  it('refuses a clientId without a clientSecret', () => {
    expect(() =>
      frontMcpRemoteAppMetadataSchema.parse({ ...app, remoteAuth: { mode: 'oauth', clientId: 'help-desk' } }),
    ).toThrow('remoteAuth oauth needs both clientId and clientSecret, or neither');
  });
});
