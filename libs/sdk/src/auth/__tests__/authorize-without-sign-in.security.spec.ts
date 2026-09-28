/**
 * `/oauth/authorize` on a server that has no sign-in: no `auth` at all, an
 * explicit `auth: { mode: 'public' }` (the same configuration, written out),
 * and `mode: 'static'` (a pre-shared token, no authorization server).
 *
 * - No `auth` and public mode behave the same: the anonymous code goes only to
 *   a loopback `redirect_uri` (#260), and redeems for an anonymous token.
 * - Static mode refuses with an error page, never a redirect.
 * - None of them answers 500.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  decodeJwtPayload,
  disposeServers,
  httpGet,
  PKCE_VERIFIER,
  postForm,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

const HOST = 'desk.example.com';
const LOOPBACK_REDIRECT = 'http://127.0.0.1:5555/cb';
const ATTACKER_REDIRECT = 'https://attacker.example.net/cb';

type AuthConfig = FrontMcpConfigInput['auth'];

const servers: TestFetchServer[] = [];
let previousSecret: string | undefined;

beforeAll(() => {
  previousSecret = process.env['JWT_SECRET'];
  process.env['JWT_SECRET'] = 'k'.repeat(64);
});

afterAll(async () => {
  await disposeServers(servers);
  if (previousSecret === undefined) delete process.env['JWT_SECRET'];
  else process.env['JWT_SECRET'] = previousSecret;
});

async function serverWith(auth: AuthConfig): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name: 'desk', version: '1.0.0' },
    apps: [DeskApp],
    ...(auth ? { auth } : {}),
  });
  servers.push(server);
  return server;
}

function authorize(redirectUri: string): string {
  return `/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: 'desk-cli',
    redirect_uri: redirectUri,
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    state: 'client-state',
  })}`;
}

describe.each([
  ['no auth config', undefined],
  ['auth: { mode: "public" }', { mode: 'public' } as AuthConfig],
])('/oauth/authorize with %s', (_label, auth) => {
  it('redirects the anonymous code to a loopback redirect_uri, and the code redeems for an anonymous token', async () => {
    const server = await serverWith(auth);

    const response = await httpGet(server.handler, authorize(LOOPBACK_REDIRECT), HOST);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')?.startsWith(LOOPBACK_REDIRECT)).toBe(true);
    const params = redirectParams(response);
    expect(params.get('state')).toBe('client-state');

    const token = await postForm(
      server.handler,
      '/oauth/token',
      {
        grant_type: 'authorization_code',
        code: params.get('code') ?? '',
        client_id: 'desk-cli',
        redirect_uri: LOOPBACK_REDIRECT,
        code_verifier: PKCE_VERIFIER,
      },
      HOST,
    );
    expect(token.status).toBe(200);
    const body = (await token.json()) as Record<string, unknown>;
    expect(String(decodeJwtPayload(String(body['access_token']))['sub'])).toMatch(/^anon:/);
  });

  it('shows an error page, not a redirect, for a redirect_uri that is not loopback', async () => {
    const server = await serverWith(auth);

    const response = await httpGet(server.handler, authorize(ATTACKER_REDIRECT), HOST);

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('/oauth/authorize in static mode', () => {
  it('refuses with an error page: the server has no sign-in to run', async () => {
    const server = await serverWith({ mode: 'static', tokens: ['s'.repeat(32)] } as AuthConfig);

    const response = await httpGet(server.handler, authorize(LOOPBACK_REDIRECT), HOST);

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('does not sign users in');
  });
});
