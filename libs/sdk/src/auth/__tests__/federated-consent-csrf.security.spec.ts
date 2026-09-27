/**
 * The consent screen of a federated sign-in (local mode with `providers` and
 * `consent.enabled`) is submitted to `/oauth/provider/_consent/callback`. The
 * federated session id it carries is no secret: it travels to the provider in
 * every upstream `state`. So the submission must also carry the screen's CSRF
 * token, from a POSTed form: a consent in a URL, or without the token, never
 * completes the sign-in.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  disposeServers,
  httpGet,
  inputValue,
  redirectParams,
  runProviderCallback,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { type Scope } from '../../scope/scope.instance';

@Tool({ name: 'list_repos', inputSchema: {} })
class ListReposTool extends ToolContext {
  async execute() {
    return { repos: [] };
  }
}

@App({ id: 'code', name: 'Code', tools: [ListReposTool] })
class CodeApp {}

const GITHUB = 'https://github.example.com';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
const HOST = 'code.example.com';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== GITHUB) return realFetch(input, init);
    if (url.pathname === '/token') {
      return Response.json({ access_token: 'gh-access-token', token_type: 'Bearer', expires_in: 3600 });
    }
    if (url.pathname === '/userinfo') {
      return Response.json({ sub: 'gh|nour', email: 'nour@example.com', name: 'Nour' });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

const servers: TestFetchServer[] = [];

afterAll(async () => {
  globalThis.fetch = realFetch;
  await disposeServers(servers);
});

/** Sign in through GitHub up to the consent screen; returns what that screen carries. */
async function reachConsentScreen(): Promise<{
  scope: Scope;
  html: string;
  session: string;
  csrf: string;
  tool: string;
}> {
  const server = await createTestFetchServer({
    info: { name: 'federated-consent', version: '1.0.0' },
    apps: [CodeApp],
    auth: {
      mode: 'local',
      dcr: { clients: [{ clientId: 'code-client', redirectUris: [REDIRECT_URI] }] },
      providers: [
        {
          id: 'github',
          authorizeUrl: `${GITHUB}/authorize`,
          tokenUrl: `${GITHUB}/token`,
          userInfoEndpoint: `${GITHUB}/userinfo`,
          clientId: 'gh-client',
        },
      ],
      consent: { enabled: true, rememberConsent: false },
    } as AuthConfig,
  });
  servers.push(server);
  const scope = server.instance.getScopes()[0] as Scope;

  const page = await httpGet(
    server.handler,
    authorizePath({ client_id: 'code-client', redirect_uri: REDIRECT_URI, state: 's' }),
    HOST,
  );
  const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
  const toProvider = await httpGet(
    server.handler,
    `/oauth/callback?${new URLSearchParams({
      pending_auth_id: pendingAuthId,
      federated: 'true',
      providers: 'github',
      email: 'nour@example.com',
    })}`,
    HOST,
  );
  const providerState = redirectParams(toProvider).get('state') ?? '';

  const consent = await runProviderCallback(scope, 'github', { code: 'gh-code', state: providerState }, HOST);
  expect(consent.status).toBe(200);
  const html = await consent.text();
  const tool = /name="tools" value="([^"]+)"/.exec(html)?.[1] ?? '';
  return {
    scope,
    html,
    session: inputValue(html, 'consent_session') ?? '',
    csrf: inputValue(html, 'csrf') ?? '',
    tool,
  };
}

describe('federated consent submission', () => {
  it('renders a POST form carrying a CSRF token', async () => {
    const { html, session, csrf, tool } = await reachConsentScreen();

    expect(html).toMatch(/<form method="POST"[^>]*action="[^"]*\/oauth\/provider\/_consent\/callback"/);
    expect(session).not.toBe('');
    expect(csrf.length).toBeGreaterThanOrEqual(32);
    expect(tool).not.toBe('');
  });

  it('refuses a consent sent in the query string', async () => {
    const { scope, session, csrf, tool } = await reachConsentScreen();

    const response = await runProviderCallback(
      scope,
      '_consent',
      { consent_session: session, consent_submitted: '1', tools: tool, csrf },
      HOST,
    );

    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(400);
  });

  it('refuses a POSTed consent without the CSRF token', async () => {
    const { scope, session, tool } = await reachConsentScreen();

    const response = await runProviderCallback(scope, '_consent', {}, HOST, {
      consent_session: session,
      consent_submitted: '1',
      tools: tool,
    });

    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(400);
  });

  it('refuses a POSTed consent with a wrong CSRF token', async () => {
    const { scope, session, csrf, tool } = await reachConsentScreen();

    const response = await runProviderCallback(scope, '_consent', {}, HOST, {
      consent_session: session,
      consent_submitted: '1',
      tools: tool,
      csrf: `${csrf.slice(0, -1)}${csrf.endsWith('A') ? 'B' : 'A'}`,
    });

    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(400);
  });

  it('completes the sign-in when the consent page is submitted', async () => {
    const { scope, session, csrf, tool } = await reachConsentScreen();

    const response = await runProviderCallback(scope, '_consent', {}, HOST, {
      consent_session: session,
      consent_submitted: '1',
      tools: tool,
      csrf,
    });

    expect(response.status).toBe(302);
    expect(redirectParams(response).get('code')).toEqual(expect.any(String));
  });
});
