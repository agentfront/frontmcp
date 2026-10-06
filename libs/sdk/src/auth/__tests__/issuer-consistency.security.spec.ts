/**
 * One issuer for every entry point (#629).
 *
 * The issuer is what a client checks three times: it discovers it in
 * `/.well-known/oauth-authorization-server` (and in the protected resource
 * metadata's `authorization_servers`), it compares it with the RFC 9207 `iss`
 * on the authorization response, success or error, and it finds it as the
 * `iss` of the tokens. All of them must name the same issuer, on FrontMCP's
 * Node server and under `createFetchHandler()` alike, in the documented order:
 * `issuer` / `local.issuer`, then `FRONTMCP_PUBLIC_URL`, then
 * `FRONTMCP_PUBLIC_HOST` (the boot-time issuer's host), then the request.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  callToolWithToken,
  decodeJwtPayload,
  disposeServers,
  httpGet,
  postForm,
  redirectParams,
  runProviderCallback,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput, type HttpOutput } from '../../common';
import { type Scope } from '../../scope/scope.instance';
import { renderHttpOutputToWebResponse } from '../../transport/web-response.renderer';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

const JWT_SECRET = 'k'.repeat(64);
const CLIENT_ID = 'desk-client';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const servers: TestFetchServer[] = [];
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['JWT_SECRET', 'FRONTMCP_PUBLIC_URL', 'FRONTMCP_PUBLIC_HOST', 'PORT'] as const;

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env['JWT_SECRET'] = JWT_SECRET;
});

afterEach(() => {
  delete process.env['FRONTMCP_PUBLIC_URL'];
  delete process.env['FRONTMCP_PUBLIC_HOST'];
  delete process.env['PORT'];
});

afterAll(async () => {
  await disposeServers(servers);
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function localAuth(extra: Record<string, unknown> = {}): AuthConfig {
  return {
    mode: 'local',
    allowDefaultPublic: true,
    dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
    ...extra,
  } as AuthConfig;
}

async function serverWith(auth: AuthConfig): Promise<{ server: TestFetchServer; scope: Scope }> {
  const server = await createTestFetchServer({
    info: { name: 'issuer-desk', version: '1.0.0' },
    apps: [DeskApp],
    auth,
  });
  servers.push(server);
  return { server, scope: server.instance.getScopes()[0] as Scope };
}

/**
 * Run an HTTP flow with the request shape FrontMCP's Node server hands it (no
 * Web `Request` behind it), and render the answer as a Web `Response`.
 */
async function viaNode(
  scope: Scope,
  flow: string,
  init: {
    method?: 'GET' | 'POST';
    path: string;
    host: string;
    query?: Record<string, string>;
    form?: Record<string, string>;
  },
): Promise<Response> {
  const query = init.query ?? {};
  const search = new URLSearchParams(query).toString();
  const request = {
    method: init.method ?? 'GET',
    path: init.path,
    url: search ? `${init.path}?${search}` : init.path,
    protocol: 'http',
    headers: init.form ? { host: init.host, 'content-type': 'application/x-www-form-urlencoded' } : { host: init.host },
    query,
    params: {},
    body: init.form,
  };
  const output = (await scope.runFlow(flow as never, { request, response: {} } as never)) as HttpOutput | undefined;
  if (!output) throw new Error(`${flow} produced no response`);
  return renderHttpOutputToWebResponse(output) as Response;
}

/** The four places a client meets the issuer, as the Node server answers them at `host`. */
async function issuersViaNode(scope: Scope, host: string) {
  const metadata = (await (
    await viaNode(scope, 'well-known.oauth-authorization-server', {
      path: '/.well-known/oauth-authorization-server',
      host,
    })
  ).json()) as Record<string, unknown>;
  const prm = (await (
    await viaNode(scope, 'well-known.oauth-protected-resource', { path: '/.well-known/oauth-protected-resource', host })
  ).json()) as Record<string, unknown>;
  const errorRedirect = await viaNode(scope, 'oauth:authorize', {
    path: '/oauth/authorize',
    host,
    query: Object.fromEntries(
      new URLSearchParams(
        authorizePath({
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          state: 's',
          resource: 'https://another.example.com/mcp',
        }).split('?')[1],
      ),
    ),
  });
  const token = (await (
    await viaNode(scope, 'oauth:token', {
      method: 'POST',
      path: '/oauth/token',
      host,
      form: { grant_type: 'anonymous', client_id: CLIENT_ID },
    })
  ).json()) as Record<string, unknown>;
  return {
    discovered: metadata['issuer'],
    authorizationServer: (prm['authorization_servers'] as string[] | undefined)?.[0],
    errorRedirectIss: redirectParams(errorRedirect).get('iss'),
    tokenIss: decodeJwtPayload(String(token['access_token']))['iss'],
    metadata,
  };
}

/** The same four, through the fetch handler at `host`. */
async function issuersViaFetch(server: TestFetchServer, host: string) {
  const metadata = (await (
    await httpGet(server.handler, '/.well-known/oauth-authorization-server', host)
  ).json()) as Record<string, unknown>;
  const prm = (await (await httpGet(server.handler, '/.well-known/oauth-protected-resource', host)).json()) as Record<
    string,
    unknown
  >;
  const errorRedirect = await httpGet(
    server.handler,
    authorizePath({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      state: 's',
      resource: 'https://another.example.com/mcp',
    }),
    host,
  );
  const token = (await (
    await postForm(server.handler, '/oauth/token', { grant_type: 'anonymous', client_id: CLIENT_ID }, host)
  ).json()) as Record<string, unknown>;
  return {
    discovered: metadata['issuer'],
    authorizationServer: (prm['authorization_servers'] as string[] | undefined)?.[0],
    errorRedirectIss: redirectParams(errorRedirect).get('iss'),
    tokenIss: decodeJwtPayload(String(token['access_token']))['iss'],
    metadata,
  };
}

describe('one issuer for every entry point (#629)', () => {
  it('on the Node server, follows the request when nothing is pinned, everywhere', async () => {
    const { scope } = await serverWith(localAuth());

    const seen = await issuersViaNode(scope, 'mcp.example.com');

    expect(seen).toMatchObject({
      discovered: 'http://mcp.example.com',
      authorizationServer: 'http://mcp.example.com',
      errorRedirectIss: 'http://mcp.example.com',
      tokenIss: 'http://mcp.example.com',
    });
  });

  it('under the fetch handler, follows the request when nothing is pinned, everywhere', async () => {
    const { server } = await serverWith(localAuth());

    const seen = await issuersViaFetch(server, 'desk.example.com');

    expect(seen).toMatchObject({
      discovered: 'http://desk.example.com',
      authorizationServer: 'http://desk.example.com',
      errorRedirectIss: 'http://desk.example.com',
      tokenIss: 'http://desk.example.com',
    });
  });

  it('uses local.issuer everywhere, on both entry points', async () => {
    const { server, scope } = await serverWith(localAuth({ local: { issuer: 'https://auth.example.com' } }));

    for (const seen of [
      await issuersViaNode(scope, 'mcp.example.com'),
      await issuersViaFetch(server, 'desk.example.com'),
    ]) {
      expect(seen).toMatchObject({
        discovered: 'https://auth.example.com',
        authorizationServer: 'https://auth.example.com',
        errorRedirectIss: 'https://auth.example.com',
        tokenIss: 'https://auth.example.com',
      });
    }
  });

  it('uses FRONTMCP_PUBLIC_URL everywhere, before FRONTMCP_PUBLIC_HOST', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example.com';
    process.env['FRONTMCP_PUBLIC_HOST'] = 'boot.example.com';
    const { server, scope } = await serverWith(localAuth());

    for (const seen of [
      await issuersViaNode(scope, 'other.example.com'),
      await issuersViaFetch(server, 'desk.example.com'),
    ]) {
      expect(seen).toMatchObject({
        discovered: 'https://mcp.example.com',
        authorizationServer: 'https://mcp.example.com',
        errorRedirectIss: 'https://mcp.example.com',
        tokenIss: 'https://mcp.example.com',
      });
    }
  });

  it('uses the FRONTMCP_PUBLIC_HOST boot-time issuer, on the default server port, everywhere when it is the only pin', async () => {
    process.env['FRONTMCP_PUBLIC_HOST'] = 'boot.example.com';
    const { server, scope } = await serverWith(localAuth());

    for (const seen of [
      await issuersViaNode(scope, 'mcp.example.com'),
      await issuersViaFetch(server, 'desk.example.com'),
    ]) {
      expect(seen).toMatchObject({
        discovered: 'http://boot.example.com:3000',
        authorizationServer: 'http://boot.example.com:3000',
        errorRedirectIss: 'http://boot.example.com:3000',
        tokenIss: 'http://boot.example.com:3000',
      });
    }
  });

  it('advertises that authorization responses carry iss (RFC 9207 §3)', async () => {
    const { server } = await serverWith(localAuth());

    const { metadata } = await issuersViaFetch(server, 'desk.example.com');

    expect(metadata['authorization_response_iss_parameter_supported']).toBe(true);
  });

  it('accepts a token minted at one expectedAudience address at another', async () => {
    const { server } = await serverWith(
      localAuth({ expectedAudience: ['http://a.example.com', 'http://b.example.com'] }),
    );
    const token = (await (
      await postForm(
        server.handler,
        '/oauth/token',
        { grant_type: 'anonymous', client_id: CLIENT_ID, resource: 'http://a.example.com' },
        'a.example.com',
      )
    ).json()) as Record<string, unknown>;

    const atB = await callToolWithToken(server.handler, 'whoami', String(token['access_token']), 'b.example.com');

    expect(atB.status).toBe(200);
  });

  it('still refuses a token minted at an address that is not listed', async () => {
    const { server } = await serverWith(localAuth({ expectedAudience: ['http://b.example.com'] }));
    const token = (await (
      await postForm(
        server.handler,
        '/oauth/token',
        { grant_type: 'anonymous', client_id: CLIENT_ID },
        'evil.example.com',
      )
    ).json()) as Record<string, unknown>;

    const atB = await callToolWithToken(server.handler, 'whoami', String(token['access_token']), 'b.example.com');

    expect(atB.status).toBe(401);
  });
});

describe('remote mode: the final authorization response names the same issuer (#629)', () => {
  const IDP = 'https://idp.example.com';
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== IDP) return realFetch(input, init);
      if (url.pathname === '/token') {
        return Response.json({ access_token: 'idp-access-token', token_type: 'Bearer', expires_in: 3600 });
      }
      if (url.pathname === '/userinfo') return Response.json({ sub: 'auth0|nour', email: 'nour@example.com' });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('names the pinned FRONTMCP_PUBLIC_URL issuer, as discovery does, not the boot-time one', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'http://desk.example.com';
    const { server, scope } = await serverWith({
      mode: 'remote',
      provider: IDP,
      clientId: 'desk-upstream',
      clientSecret: 'upstream-secret',
      requireRegisteredClients: false,
      providerConfig: { id: 'idp', jwks: { keys: [] } },
    } as AuthConfig);
    const host = 'desk.example.com';
    const discovered = (
      (await (await httpGet(server.handler, '/.well-known/oauth-authorization-server', host)).json()) as {
        issuer: string;
      }
    ).issuer;

    const toProvider = await httpGet(
      server.handler,
      authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state: 'client-state' }),
      host,
    );
    const providerState = redirectParams(toProvider).get('state') ?? '';
    const callback = await runProviderCallback(scope, 'idp', { code: 'idp-code', state: providerState }, host);

    expect(callback.status).toBe(302);
    expect(redirectParams(callback).get('code')).toBeTruthy();
    expect(discovered).toBe('http://desk.example.com');
    expect(redirectParams(callback).get('iss')).toBe(discovered);
  });
});
