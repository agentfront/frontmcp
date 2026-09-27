/**
 * `expectedAudience` in local and remote mode: the tokens FrontMCP issues are
 * accepted only when their `aud` names one of the configured audiences, in
 * place of the URL the request arrived at (as in transparent mode). Without it,
 * a token is accepted when its `aud` is the request's resource URL (#269).
 *
 * Driven over the fetch handler: sign in on the built-in page (local mode), or
 * present a token signed with the server's secret (remote mode, whose sign-in
 * needs an upstream provider), then call a tool with it.
 */
import 'reflect-metadata';

import { SignJWT } from 'jose';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  callToolWithToken,
  disposeServers,
  exchangeCode,
  httpGet,
  inputValue,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { type LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

const JWT_SECRET = 'e'.repeat(64);
const CLIENT_ID = 'desk-client';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
/** The name clients are meant to use; the only configured audience. */
const PUBLIC_HOST = 'mcp.desk.example.com';
const PUBLIC_RESOURCE = `http://${PUBLIC_HOST}`;
/** Another name the same server answers to (an internal hostname, a spoofed Host). */
const OTHER_HOST = 'desk.internal';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const servers: TestFetchServer[] = [];
let previousSecret: string | undefined;

beforeAll(() => {
  previousSecret = process.env['JWT_SECRET'];
  process.env['JWT_SECRET'] = JWT_SECRET;
});

afterAll(async () => {
  await disposeServers(servers);
  if (previousSecret === undefined) delete process.env['JWT_SECRET'];
  else process.env['JWT_SECRET'] = previousSecret;
});

async function serverWith(name: string, auth: AuthConfig): Promise<TestFetchServer> {
  const server = await createTestFetchServer({ info: { name, version: '1.0.0' }, apps: [DeskApp], auth });
  servers.push(server);
  return server;
}

/** Sign in on the built-in page at `host` and redeem the code; the token's `aud` is `http://<host>`. */
async function signIn(server: TestFetchServer, host: string): Promise<string> {
  const page = await httpGet(
    server.handler,
    authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state: 's' }),
    host,
  );
  const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
  const callback = await httpGet(
    server.handler,
    `/oauth/callback?${new URLSearchParams({ pending_auth_id: pendingAuthId, email: 'nour@example.com' })}`,
    host,
  );
  const code = redirectParams(callback).get('code') ?? '';
  const tokens = await exchangeCode(server.handler, { code, clientId: CLIENT_ID, redirectUri: REDIRECT_URI }, host);
  expect(tokens.status).toBe(200);
  return String(tokens.body['access_token']);
}

/** A token signed with the server's own secret and issuer, for `audience`. */
function gatewayToken(server: TestFetchServer, audience: string): Promise<string> {
  const auth = server.instance.getScopes()[0].auth as unknown as LocalPrimaryAuth;
  return new SignJWT({ sub: 'user-1', scope: 'openid' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(auth.issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

describe('local mode with expectedAudience', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await serverWith('desk-local', {
      mode: 'local',
      dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
      expectedAudience: PUBLIC_RESOURCE,
    } as AuthConfig);
  });

  it('refuses a token issued for a resource that is not an expected audience', async () => {
    const access = await signIn(server, OTHER_HOST);

    const call = await callToolWithToken(server.handler, 'whoami', access, OTHER_HOST);

    expect(call.status).toBe(401);
    expect(call.wwwAuthenticate).toContain('invalid_token');
  });

  it('serves a token issued for an expected audience', async () => {
    const access = await signIn(server, PUBLIC_HOST);

    const call = await callToolWithToken(server.handler, 'whoami', access, PUBLIC_HOST);

    expect(call.status).toBe(200);
    expect(call.result?.['sub']).toEqual(expect.any(String));
  });

  it('checks the audience in place of the request URL, so any name of the server serves it', async () => {
    const access = await signIn(server, PUBLIC_HOST);

    const call = await callToolWithToken(server.handler, 'whoami', access, OTHER_HOST);

    expect(call.status).toBe(200);
  });

  it('accepts any audience of a list', async () => {
    const listed = await serverWith('desk-local-list', {
      mode: 'local',
      dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
      expectedAudience: ['https://api.desk.example.com', PUBLIC_RESOURCE],
    } as AuthConfig);
    const access = await signIn(listed, PUBLIC_HOST);

    expect((await callToolWithToken(listed.handler, 'whoami', access, PUBLIC_HOST)).status).toBe(200);
    expect((await callToolWithToken(listed.handler, 'whoami', access, OTHER_HOST)).status).toBe(200);
  });
});

describe('remote mode with expectedAudience', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await serverWith('desk-remote', {
      mode: 'remote',
      provider: 'https://idp.example.com',
      clientId: 'desk-upstream',
      clientSecret: 'upstream-secret',
      expectedAudience: PUBLIC_RESOURCE,
    } as AuthConfig);
  });

  it('refuses a token for the request URL when that is not an expected audience', async () => {
    const token = await gatewayToken(server, `http://${OTHER_HOST}`);

    const call = await callToolWithToken(server.handler, 'whoami', token, OTHER_HOST);

    expect(call.status).toBe(401);
  });

  it('serves a token for an expected audience', async () => {
    const token = await gatewayToken(server, PUBLIC_RESOURCE);

    expect((await callToolWithToken(server.handler, 'whoami', token, PUBLIC_HOST)).status).toBe(200);
  });
});

describe('without expectedAudience', () => {
  it('still binds a token to the URL the request arrived at (#269)', async () => {
    const server = await serverWith('desk-default', {
      mode: 'local',
      dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
    } as AuthConfig);
    const access = await signIn(server, PUBLIC_HOST);

    expect((await callToolWithToken(server.handler, 'whoami', access, PUBLIC_HOST)).status).toBe(200);
    expect((await callToolWithToken(server.handler, 'whoami', access, OTHER_HOST)).status).toBe(401);
  });
});
