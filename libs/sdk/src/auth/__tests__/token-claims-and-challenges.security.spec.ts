/**
 * Token handling at the HTTP edge (#766):
 *
 * - a static server with a bare-token header (`scheme: ''`) answers 401 with no
 *   `WWW-Authenticate` header, not an empty one;
 * - `requiredScopes` reads the `scp` claim (Entra ID, Okta) as well as `scope`;
 * - a token with no `sub` takes its subject from `client_id` (RFC 9068 §2.2)
 *   instead of reading as anonymous.
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub, isAnonymous: this.auth.isAnonymous, scopes: this.auth.scopes };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

const ORIGIN = 'https://desk.example.com';
const IDP = 'https://idp.example.com';

const servers: TestFetchServer[] = [];
let privateKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
});

afterAll(async () => {
  await disposeServers(servers);
});

async function serverWith(auth: NonNullable<FrontMcpConfigInput['auth']>): Promise<TestFetchServer> {
  const server = await createTestFetchServer({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp], auth });
  servers.push(server);
  return server;
}

function transparentAuth(extra: Record<string, unknown> = {}) {
  return {
    mode: 'transparent',
    provider: IDP,
    expectedAudience: ORIGIN,
    providerConfig: { jwks: { keys: [jwk] } },
    ...extra,
  } as NonNullable<FrontMcpConfigInput['auth']>;
}

function idpToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(IDP)
    .setAudience(ORIGIN)
    .setExpirationTime('10m')
    .sign(privateKey);
}

function mcpPost(server: TestFetchServer, body: object, token?: string): Promise<Response> {
  return server.handler(
    new Request(`${ORIGIN}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spec', version: '1' } },
};

describe('token claims and challenges', () => {
  it('answers a static bare-token server 401 with no WWW-Authenticate header', async () => {
    const server = await serverWith({ mode: 'static', tokens: ['k'.repeat(32)], header: 'x-api-key', scheme: '' });

    const response = await mcpPost(server, initialize);

    expect(response.status).toBe(401);
    expect(response.headers.has('www-authenticate')).toBe(false);
  });

  it('accepts requiredScopes granted in an scp claim, and refuses them when absent', async () => {
    const server = await serverWith(transparentAuth({ requiredScopes: ['tickets.read'] }));

    const granted = await mcpPost(server, initialize, await idpToken({ sub: 'nour', scp: ['tickets.read'] }));
    const grantedAsString = await mcpPost(server, initialize, await idpToken({ sub: 'nour', scp: 'tickets.read' }));
    const refused = await mcpPost(server, initialize, await idpToken({ sub: 'nour', scp: ['other'] }));

    expect(granted.status).toBe(200);
    expect(grantedAsString.status).toBe(200);
    expect(refused.status).toBe(403);
  });

  it('gives this.auth.scopes the scopes of an scp claim', async () => {
    const server = await serverWith(transparentAuth());
    const token = await idpToken({ sub: 'nour', scp: ['tickets:read', 'tickets:write'] });

    const init = await mcpPost(server, initialize, token);
    const sessionId = init.headers.get('mcp-session-id') ?? '';
    const call = await server.handler(
      new Request(`${ORIGIN}/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId,
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'whoami', arguments: {} },
        }),
      }),
    );

    expect(await call.text()).toContain('\\"scopes\\":[\\"tickets:read\\",\\"tickets:write\\"]');
  });

  it('leaves a caller with a verified token unrestricted by publicAccess', async () => {
    const server = await serverWith(transparentAuth({ allowAnonymous: true, publicAccess: { tools: [] } }));
    const token = await idpToken({ sub: 'nour' });

    const init = await mcpPost(server, initialize, token);
    const sessionId = init.headers.get('mcp-session-id') ?? '';
    const call = await server.handler(
      new Request(`${ORIGIN}/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId,
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'whoami', arguments: {} },
        }),
      }),
    );

    const anonymousInit = await mcpPost(server, initialize);
    const anonymousCall = await server.handler(
      new Request(`${ORIGIN}/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': anonymousInit.headers.get('mcp-session-id') ?? '',
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'whoami', arguments: {} },
        }),
      }),
    );

    const text = await call.text();
    expect(text).not.toContain('not available to anonymous callers');
    expect(text).toContain('\\"sub\\":\\"nour\\"');
    expect(await anonymousCall.text()).toContain('not available to anonymous callers');
  });

  it('names a token with no sub by its client_id instead of reading it as anonymous', async () => {
    const server = await serverWith(transparentAuth());
    const token = await idpToken({ client_id: 'billing-service' });

    const init = await mcpPost(server, initialize, token);
    const sessionId = init.headers.get('mcp-session-id') ?? '';
    const call = await server.handler(
      new Request(`${ORIGIN}/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId,
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'whoami', arguments: {} },
        }),
      }),
    );

    const text = await call.text();
    expect(text).toContain('\\"sub\\":\\"billing-service\\"');
    expect(text).toContain('\\"isAnonymous\\":false');
  });
});
