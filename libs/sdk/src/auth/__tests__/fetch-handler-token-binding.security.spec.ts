/**
 * Tokens issued through the Web fetch handler (`createFetchHandler`, the edge
 * adapter, a Durable Object session host) are bound to the address they were
 * issued at, as #269 binds them for the Node server.
 *
 * A Web `Request` carries its address in its URL, not in a `Host` header, so
 * the requests here are built the way a Worker, Deno or Bun receives them (and
 * as `new Request(url)` builds them): with a full URL and no `Host` header.
 * The resource URL (`aud`) and, unless one is configured, the issuer (`iss`)
 * come from that URL, and the same derivation checks them when the token comes
 * back. A token is never bound to a placeholder such as `http://undefined`.
 */
import 'reflect-metadata';

import { SignJWT } from 'jose';

import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  decodeJwtPayload,
  disposeServers,
  inputValue,
  PKCE_VERIFIER,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub, isAnonymous: this.auth.isAnonymous };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

const JWT_SECRET = 'k'.repeat(64);
const DESK = 'https://desk.example.com';
const BILLING = 'https://billing.example.com';
const CLIENT_ID = 'desk-client';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const servers: TestFetchServer[] = [];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ['JWT_SECRET', 'FRONTMCP_PUBLIC_URL', 'FRONTMCP_PUBLIC_HOST', 'FRONTMCP_TRUST_PROXY']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env['JWT_SECRET'] = JWT_SECRET;
});

afterEach(() => {
  delete process.env['FRONTMCP_PUBLIC_URL'];
});

afterAll(async () => {
  await disposeServers(servers);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function serverWith(auth: AuthConfig): Promise<TestFetchServer> {
  const server = await createTestFetchServer({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp], auth });
  servers.push(server);
  return server;
}

/** `grant_type=anonymous` at `<origin>/oauth/token`, as a client reaches a Worker. */
async function anonymousToken(
  server: TestFetchServer,
  origin: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const response = await server.handler(
    new Request(`${origin}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders },
      body: new URLSearchParams({ grant_type: 'anonymous', client_id: 'desk-cli' }).toString(),
    }),
  );
  expect(response.status).toBe(200);
  return String(((await response.json()) as Record<string, unknown>)['access_token']);
}

/** Call `whoami` over MCP 2026-07-28 at `<origin>/`. */
async function callWhoAmI(server: TestFetchServer, origin: string, token: string): Promise<number> {
  const response = await server.handler(
    new Request(`${origin}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026_07_28,
        'mcp-method': 'tools/call',
        'mcp-name': 'whoami',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'whoami',
          arguments: {},
          _meta: {
            [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
            [MCP_20260728_META.clientInfo]: { name: 'spec-client', version: '1.0.0' },
            [MCP_20260728_META.clientCapabilities]: {},
          },
        },
      }),
    }),
  );
  await response.text();
  return response.status;
}

/** Sign in on the built-in page at `origin` and redeem the code, keeping the sign-in cookie as a browser does. */
async function signIn(server: TestFetchServer, origin: string): Promise<string> {
  const page = await server.handler(
    new Request(
      `${origin}${authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state: 's' })}`,
    ),
  );
  expect(page.status).toBe(200);
  const cookie = (page.headers.get('set-cookie') ?? '').split(';')[0];
  const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
  const callback = await server.handler(
    new Request(`${origin}/oauth/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin },
      body: new URLSearchParams({ pending_auth_id: pendingAuthId, email: 'nour@example.com' }).toString(),
    }),
  );
  const code = redirectParams(callback).get('code') ?? '';
  const tokens = await server.handler(
    new Request(`${origin}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: PKCE_VERIFIER,
      }).toString(),
    }),
  );
  expect(tokens.status).toBe(200);
  return String(((await tokens.json()) as Record<string, unknown>)['access_token']);
}

const localAuth = (extra: Record<string, unknown> = {}): AuthConfig =>
  ({
    mode: 'local',
    dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
    ...extra,
  }) as AuthConfig;

describe('tokens issued through the fetch handler are bound to the address they were issued at', () => {
  it('an anonymous token names the request URL as its audience and issuer', async () => {
    const server = await serverWith({ mode: 'public' });

    const claims = decodeJwtPayload(await anonymousToken(server, DESK));

    expect(claims['aud']).toBe(DESK);
    expect(claims['iss']).toBe(DESK);
  });

  it('binds a token to the request URL, not to a Host header that disagrees with it', async () => {
    const server = await serverWith({ mode: 'public' });

    const token = await anonymousToken(server, DESK, { host: 'evil.example' });
    const claims = decodeJwtPayload(token);

    expect(claims['aud']).toBe(DESK);
    expect(claims['iss']).toBe(DESK);
    expect(await callWhoAmI(server, DESK, token)).toBe(200);
  });

  it('serves an anonymous token at the address it was issued at, and refuses it at another', async () => {
    const server = await serverWith({ mode: 'public' });
    const token = await anonymousToken(server, DESK);

    expect(await callWhoAmI(server, DESK, token)).toBe(200);
    expect(await callWhoAmI(server, BILLING, token)).toBe(401);
  });

  it('refuses a token bound to the placeholder address another deployment put on its tokens', async () => {
    const server = await serverWith({ mode: 'public' });
    const now = Math.floor(Date.now() / 1000);
    // What a fetch-handler deployment sharing JWT_SECRET issued before this fix.
    const placeholder = await new SignJWT({ sub: 'anon:other', anonymous: true, scope: 'anonymous' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('http://localhost:3001')
      .setAudience('http://undefined')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(new TextEncoder().encode(JWT_SECRET));

    expect(await callWhoAmI(server, DESK, placeholder)).toBe(401);
  });

  it('local mode: a signed-in token is bound to the address the client signed in at', async () => {
    const server = await serverWith(localAuth());

    const token = await signIn(server, DESK);
    const claims = decodeJwtPayload(token);

    expect(claims['aud']).toBe(DESK);
    expect(claims['iss']).toBe(DESK);
    expect(await callWhoAmI(server, DESK, token)).toBe(200);
    expect(await callWhoAmI(server, BILLING, token)).toBe(401);
  });

  it('refuses a sign-in form posted from another site, as the Node server does', async () => {
    const server = await serverWith(localAuth());
    const page = await server.handler(
      new Request(
        `${DESK}${authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state: 's' })}`,
      ),
    );
    const cookie = (page.headers.get('set-cookie') ?? '').split(';')[0];
    const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';

    const callback = await server.handler(
      new Request(`${DESK}/oauth/callback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie,
          origin: 'https://attacker.example.net',
        },
        body: new URLSearchParams({ pending_auth_id: pendingAuthId, email: 'nour@example.com' }).toString(),
      }),
    );

    expect(callback.status).toBe(400);
    expect(callback.headers.get('location')).toBeNull();
  });

  it('names the address on the authorization response (RFC 9207) as it names it on the token', async () => {
    const server = await createTestFetchServer({ info: { name: 'no-auth', version: '1.0.0' }, apps: [DeskApp] });
    servers.push(server);

    const response = await server.handler(
      new Request(`${DESK}/oauth/authorize?${new URLSearchParams({ redirect_uri: REDIRECT_URI, state: 's' })}`),
    );

    expect(redirectParams(response).get('iss')).toBe(DESK);
  });

  it('binds tokens to FRONTMCP_PUBLIC_URL when it is pinned, whatever address the request used', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example.com';
    const server = await serverWith({ mode: 'public' });

    const claims = decodeJwtPayload(await anonymousToken(server, DESK));

    expect(claims['aud']).toBe('https://mcp.example.com');
    expect(claims['iss']).toBe('https://mcp.example.com');
  });

  it('keeps a configured local.issuer as the issuer', async () => {
    const server = await serverWith(localAuth({ local: { issuer: 'https://auth.desk.example.com' } }));

    const token = await signIn(server, DESK);

    expect(decodeJwtPayload(token)['iss']).toBe('https://auth.desk.example.com');
    expect(decodeJwtPayload(token)['aud']).toBe(DESK);
    expect(await callWhoAmI(server, DESK, token)).toBe(200);
  });
});
