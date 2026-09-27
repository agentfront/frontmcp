/**
 * `/oauth/authorize` client, redirect and scope checks, driven over the fetch
 * handler the way a browser and an OAuth client reach them.
 *
 * - An error is only ever redirected to a redirect_uri the server has
 *   validated for the client; anything else gets an error page (no open
 *   redirect, #260).
 * - Unknown client ids are refused by default (`requireRegisteredClients`
 *   defaults to true, #261).
 * - The server grants only the scopes it allows, not whatever the client asks
 *   for (#262).
 */
import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  decodeJwtPayload,
  disposeServers,
  exchangeCode,
  httpGet,
  inputValue,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub, isAnonymous: this.auth.isAnonymous, scopes: [...this.auth.scopes] };
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
    info: { name: 'authorize-checks', version: '1.0.0' },
    apps: [DeskApp],
    auth,
  });
  servers.push(server);
  return server;
}

function localAuth(extra: Record<string, unknown> = {}): AuthConfig {
  return {
    mode: 'local',
    dcr: { clients: [{ clientId: REGISTERED_CLIENT, redirectUris: [REGISTERED_REDIRECT] }] },
    ...extra,
  } as AuthConfig;
}

afterAll(async () => {
  await disposeServers(servers);
});

/** Sign in on the built-in page and redeem the code; returns the minted access token. */
async function signIn(server: TestFetchServer, scope: string): Promise<{ token: string; grantedScope: unknown }> {
  const page = await httpGet(
    server.handler,
    authorizePath({ client_id: REGISTERED_CLIENT, redirect_uri: REGISTERED_REDIRECT, scope, state: 's1' }),
    HOST,
  );
  expect(page.status).toBe(200);
  const pendingAuthId = inputValue(await page.text(), 'pending_auth_id');
  expect(pendingAuthId).toBeDefined();

  const callback = await httpGet(
    server.handler,
    `/oauth/callback?${new URLSearchParams({ pending_auth_id: pendingAuthId ?? '', email: 'nour@example.com' })}`,
    HOST,
  );
  expect(callback.status).toBe(302);
  const code = redirectParams(callback).get('code') ?? '';

  const tokens = await exchangeCode(
    server.handler,
    { code, clientId: REGISTERED_CLIENT, redirectUri: REGISTERED_REDIRECT },
    HOST,
  );
  expect(tokens.status).toBe(200);
  return { token: String(tokens.body['access_token']), grantedScope: tokens.body['scope'] };
}

describe('/oauth/authorize never redirects an error to an unvalidated redirect_uri (#260)', () => {
  const badResource = 'https://other.example.org/mcp';

  it.each(['local', 'remote'] as const)(
    '%s mode: a bad resource for an unknown client gets an error page, not a 302 to its redirect_uri',
    async (mode) => {
      const server = await serverWith(
        mode === 'local'
          ? localAuth({ requireRegisteredClients: true })
          : ({
              mode: 'remote',
              provider: 'https://idp.example.com',
              clientId: 'desk-upstream',
              requireRegisteredClients: true,
            } as AuthConfig),
      );

      const response = await httpGet(
        server.handler,
        authorizePath({ client_id: 'made-up', redirect_uri: ATTACKER_REDIRECT, resource: badResource, state: 'x' }),
        HOST,
      );

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBe(400);
    },
  );

  it('still reports a bad resource to a registered client at its registered redirect_uri', async () => {
    const server = await serverWith(localAuth());

    const response = await httpGet(
      server.handler,
      authorizePath({
        client_id: REGISTERED_CLIENT,
        redirect_uri: REGISTERED_REDIRECT,
        resource: badResource,
        state: 'x',
      }),
      HOST,
    );

    expect(response.status).toBe(302);
    const params = redirectParams(response);
    expect(response.headers.get('location')?.startsWith(REGISTERED_REDIRECT)).toBe(true);
    expect(params.get('error')).toBe('invalid_request');
    expect(params.get('state')).toBe('x');
  });

  it('a server with no auth config does not redirect to an arbitrary redirect_uri', async () => {
    const server = await createTestFetchServer({ info: { name: 'no-auth', version: '1.0.0' }, apps: [DeskApp] });
    servers.push(server);

    const response = await httpGet(
      server.handler,
      `/oauth/authorize?redirect_uri=${encodeURIComponent(ATTACKER_REDIRECT)}`,
      HOST,
    );

    expect(response.headers.get('location')?.startsWith('https://attacker.example.net')).not.toBe(true);
  });

  it('does not redirect a client_id-allowlist refusal to a redirect_uri nobody validated', async () => {
    const server = await serverWith(
      localAuth({ requireRegisteredClients: false, dcr: { allowedClientIds: ['known'] } }),
    );

    const response = await httpGet(
      server.handler,
      authorizePath({ client_id: 'made-up', redirect_uri: ATTACKER_REDIRECT, state: 'x' }),
      HOST,
    );

    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(400);
  });
});

describe('unknown client ids are refused by default (#261)', () => {
  it('refuses an unregistered client_id with an arbitrary redirect_uri under the default config', async () => {
    const server = await serverWith({ mode: 'local' });

    const response = await httpGet(
      server.handler,
      authorizePath({ client_id: 'made-up', redirect_uri: ATTACKER_REDIRECT, state: 'x' }),
      HOST,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('Unknown client_id');
  });

  it('refuses an unregistered client_id even when its redirect_uri is on dcr.allowedRedirectUris', async () => {
    const server = await serverWith(localAuth({ dcr: { allowedRedirectUris: ['https://tools.example.com/*'] } }));

    const response = await httpGet(
      server.handler,
      authorizePath({ client_id: 'made-up', redirect_uri: 'https://tools.example.com/cb', state: 'x' }),
      HOST,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Unknown client_id');
  });

  it('serves the sign-in page to a registered client', async () => {
    const server = await serverWith(localAuth());

    const response = await httpGet(
      server.handler,
      authorizePath({ client_id: REGISTERED_CLIENT, redirect_uri: REGISTERED_REDIRECT, state: 'x' }),
      HOST,
    );

    expect(response.status).toBe(200);
  });

  it('lets unknown clients in only with an explicit requireRegisteredClients: false', async () => {
    const server = await serverWith({ mode: 'local', requireRegisteredClients: false } as AuthConfig);

    const response = await httpGet(
      server.handler,
      authorizePath({ client_id: 'made-up', redirect_uri: 'http://127.0.0.1:7777/cb', state: 'x' }),
      HOST,
    );

    expect(response.status).toBe(200);
  });
});

describe('the server grants only the scopes it allows (#262)', () => {
  async function callWhoAmI(server: TestFetchServer, token: string) {
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'whoami', arguments: {} },
      { headers: { authorization: `Bearer ${token}`, host: HOST } },
    );
    return (message.result as { structuredContent?: Record<string, unknown> } | undefined)?.structuredContent;
  }

  it('drops a scope the client asked for that the server does not allow', async () => {
    const server = await serverWith(localAuth());

    const { token, grantedScope } = await signIn(server, 'openid admin');

    expect(grantedScope).toBe('openid');
    expect(decodeJwtPayload(token)['scope']).toBe('openid');
    expect((await callWhoAmI(server, token))?.['scopes']).toEqual(['openid']);
  });

  it('grants the scopes listed in allowedScopes (exact and glob) and nothing else', async () => {
    const server = await serverWith(localAuth({ allowedScopes: ['tickets:*', 'reports:read'] }));

    const { token, grantedScope } = await signIn(server, 'tickets:read reports:read reports:write admin');

    expect(grantedScope).toBe('tickets:read reports:read');
    expect((await callWhoAmI(server, token))?.['scopes']).toEqual(['tickets:read', 'reports:read']);
  });

  it('shows only the scopes it will grant on the sign-in page', async () => {
    const server = await serverWith(localAuth({ allowedScopes: ['tickets:read'] }));

    const page = await httpGet(
      server.handler,
      authorizePath({
        client_id: REGISTERED_CLIENT,
        redirect_uri: REGISTERED_REDIRECT,
        scope: 'tickets:read admin',
        state: 's',
      }),
      HOST,
    );
    const html = await page.text();

    expect(html).toContain('tickets:read');
    expect(html).not.toContain('admin');
  });
});
