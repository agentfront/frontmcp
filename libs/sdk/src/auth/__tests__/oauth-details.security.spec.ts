/**
 * OAuth details a client relies on, driven over the fetch handler:
 *
 * - a `dcr.allowedClientIds` refusal reaches a registered client at its own
 *   registered `redirect_uri`, as RFC 6749 §4.1.2.1 describes, and is an error
 *   page only when no redirect_uri was validated for the client (#260);
 * - both discovery documents advertise the scopes `allowedScopes` grants (#262);
 * - a transparent-mode token without `exp` is refused with a reason that says
 *   so (#272), while other refusals stay generic.
 */
import 'reflect-metadata';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  callToolWithToken,
  disposeServers,
  httpGet,
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

const REGISTERED_CLIENT = 'desk-client';
const REGISTERED_REDIRECT = 'http://127.0.0.1:5555/cb';
const ATTACKER_REDIRECT = 'https://attacker.example.net/cb';
const HOST = 'desk.example.com';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const servers: TestFetchServer[] = [];

async function serverWith(auth: AuthConfig): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name: 'oauth-details', version: '1.0.0' },
    apps: [DeskApp],
    auth,
  });
  servers.push(server);
  return server;
}

function localAuth(extra: Record<string, unknown> = {}, dcr: Record<string, unknown> = {}): AuthConfig {
  return {
    mode: 'local',
    dcr: { clients: [{ clientId: REGISTERED_CLIENT, redirectUris: [REGISTERED_REDIRECT] }], ...dcr },
    ...extra,
  } as AuthConfig;
}

afterAll(async () => {
  await disposeServers(servers);
});

describe('a dcr.allowedClientIds refusal', () => {
  it("is sent to a registered client's own redirect_uri as unauthorized_client", async () => {
    const server = await serverWith(localAuth({}, { allowedClientIds: ['desk-web'] }));

    const response = await httpGet(
      server.handler,
      authorizePath({ client_id: REGISTERED_CLIENT, redirect_uri: REGISTERED_REDIRECT, state: 'x' }),
      HOST,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')?.startsWith(REGISTERED_REDIRECT)).toBe(true);
    const params = redirectParams(response);
    expect(params.get('error')).toBe('unauthorized_client');
    expect(params.get('state')).toBe('x');
    expect(params.get('code')).toBeNull();
  });

  it('is an error page when the redirect_uri is not one the client registered', async () => {
    const server = await serverWith(localAuth({}, { allowedClientIds: ['desk-web'] }));

    const response = await httpGet(
      server.handler,
      authorizePath({ client_id: REGISTERED_CLIENT, redirect_uri: ATTACKER_REDIRECT, state: 'x' }),
      HOST,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('is an error page for an unregistered client whose redirect_uri nobody validated', async () => {
    const server = await serverWith(localAuth({ requireRegisteredClients: false }, { allowedClientIds: ['known'] }));

    const response = await httpGet(
      server.handler,
      authorizePath({ client_id: 'made-up', redirect_uri: ATTACKER_REDIRECT, state: 'x' }),
      HOST,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('still lets a listed, registered client sign in', async () => {
    const server = await serverWith(localAuth({}, { allowedClientIds: [REGISTERED_CLIENT] }));

    const response = await httpGet(
      server.handler,
      authorizePath({ client_id: REGISTERED_CLIENT, redirect_uri: REGISTERED_REDIRECT, state: 'x' }),
      HOST,
    );

    expect(response.status).toBe(200);
  });
});

describe('discovery advertises the scopes allowedScopes grants', () => {
  async function scopesSupported(server: TestFetchServer): Promise<{ as: unknown; prm: unknown }> {
    const as = await httpGet(server.handler, '/.well-known/oauth-authorization-server', HOST);
    const prm = await httpGet(server.handler, '/.well-known/oauth-protected-resource', HOST);
    expect(as.status).toBe(200);
    expect(prm.status).toBe(200);
    return {
      as: ((await as.json()) as Record<string, unknown>)['scopes_supported'],
      prm: ((await prm.json()) as Record<string, unknown>)['scopes_supported'],
    };
  }

  it('advertises the default grant when allowedScopes is not set', async () => {
    const server = await serverWith(localAuth());

    const expected = ['openid', 'profile', 'email', 'offline_access'];
    expect(await scopesSupported(server)).toEqual({ as: expected, prm: expected });
  });

  it.each([
    ['local', localAuth({ allowedScopes: ['openid', 'tickets:read', 'reports:*'] })],
    [
      'remote',
      {
        mode: 'remote',
        provider: 'https://idp.example.com',
        clientId: 'desk-upstream',
        allowedScopes: ['openid', 'tickets:read', 'reports:*'],
      } as AuthConfig,
    ],
  ])('%s mode: advertises the literal allowedScopes entries, not the globs', async (_mode, auth) => {
    const server = await serverWith(auth);

    const expected = ['openid', 'tickets:read'];
    expect(await scopesSupported(server)).toEqual({ as: expected, prm: expected });
  });
});

describe('a transparent-mode token without exp', () => {
  it('is refused with a reason that names the missing exp', async () => {
    const issuer = await createTestJwtIssuer('https://idp.example.com');
    const server = await serverWith({
      mode: 'transparent',
      provider: issuer.issuer,
      providerConfig: { jwks: issuer.jwks },
      expectedAudience: `http://${HOST}`,
    } as AuthConfig);
    const withoutExp = await issuer.sign({ aud: `http://${HOST}` }, 'user-1', { exp: false });

    const call = await callToolWithToken(server.handler, 'whoami', withoutExp, HOST);

    expect(call.status).toBe(401);
    expect(call.wwwAuthenticate).toContain('invalid_token');
    expect(call.wwwAuthenticate).toMatch(/missing required \\?"exp\\?" claim/);
    expect(call.wwwAuthenticate).not.toContain('no_provider_verified');
  });

  it('keeps the generic reason for a token the provider did not sign, with or without exp', async () => {
    const issuer = await createTestJwtIssuer('https://idp.example.com');
    const forger = await createTestJwtIssuer('https://idp.example.com');
    const server = await serverWith({
      mode: 'transparent',
      provider: issuer.issuer,
      providerConfig: { jwks: issuer.jwks },
      expectedAudience: `http://${HOST}`,
    } as AuthConfig);

    for (const exp of [true, false]) {
      const forged = await forger.sign({ aud: `http://${HOST}` }, 'user-1', { exp });
      const call = await callToolWithToken(server.handler, 'whoami', forged, HOST);
      expect(call.status).toBe(401);
      expect(call.wwwAuthenticate).toContain('no_provider_verified');
      expect(call.wwwAuthenticate).not.toContain('missing required');
    }
  });
});
