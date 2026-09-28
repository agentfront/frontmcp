/**
 * A sign-in through an `auth.ui` page, submitted the way a browser submits it:
 * the page's form goes to `/oauth/callback` with the `Origin` / `Referer` the
 * page's `Referrer-Policy` lets through (the callback refuses a submission
 * whose `Origin` isn't this server), and the redirect that answers it is
 * followed only if the page's CSP `form-action` allows it (browsers apply
 * `form-action` to the redirects of a form submission).
 *
 * The built-in pages are the reference: they POST, send
 * `Referrer-Policy: same-origin` and set no `form-action`.
 */
import 'reflect-metadata';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  defaultBrowser,
  disposeServers,
  httpGet,
  inputValue,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { type WebFetchHandler } from '../../transport/web-fetch-handler';

@Tool({ name: 'list_tickets', inputSchema: {} })
class ListTicketsTool extends ToolContext {
  async execute() {
    return { tickets: [] };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ListTicketsTool] })
class DeskApp {}

const HOST = 'desk.example.com';
const CLIENT_ID = 'desk-client';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
const GITHUB = 'https://github.example.com';

const COMPONENT = `
import React from 'react';
export default function Page() {
  return React.createElement('p', null, 'custom page');
}
`;

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

let dir: string;
let page: string;
const servers: TestFetchServer[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'auth-ui-signin-'));
  page = join(dir, 'page.tsx');
  await writeFile(page, COMPONENT);
});

afterAll(async () => {
  await disposeServers(servers);
  await rm(dir, { recursive: true, force: true });
});

async function serverWith(name: string, auth: Record<string, unknown>): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name, version: '1.0.0' },
    apps: [DeskApp],
    auth: {
      mode: 'local',
      dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
      ...auth,
    } as AuthConfig,
  });
  servers.push(server);
  return server;
}

// ---------------------------------------------------------------------------
// What the browser does
// ---------------------------------------------------------------------------

/** A page as the browser holds it: where it came from, its headers and its markup. */
interface LoadedPage {
  url: URL;
  headers: Headers;
  html: string;
}

async function load(response: Response, url: URL): Promise<LoadedPage> {
  expect(response.status).toBe(200);
  return { url, headers: response.headers, html: await response.text() };
}

async function open(handler: WebFetchHandler, pathAndQuery: string): Promise<LoadedPage> {
  return load(await httpGet(handler, pathAndQuery, HOST), new URL(`http://${HOST}${pathAndQuery}`));
}

/** The `AuthFlowState` an `auth.ui` page carries in `window.__FRONTMCP_AUTH__`. */
function flowState(loaded: LoadedPage): Record<string, unknown> {
  const match = /window\["__FRONTMCP_AUTH__"\] = (.*);<\/script>/.exec(loaded.html);
  if (!match) throw new Error('not an auth.ui page');
  return JSON.parse(match[1]) as Record<string, unknown>;
}

/**
 * Submit a form of `from` to `action` as a browser does: a same-origin POST
 * carries `Origin` (`null` under `Referrer-Policy: no-referrer`), a GET none;
 * `Referer` follows the policy; the browser's cookies go along (the page was
 * loaded by the helpers' default browser).
 */
async function submitForm(
  handler: WebFetchHandler,
  from: LoadedPage,
  action: string,
  method: string,
  fields: Record<string, string>,
): Promise<Response> {
  const target = new URL(action, from.url);
  const policy = from.headers.get('referrer-policy') ?? 'strict-origin-when-cross-origin';
  const headers: Record<string, string> = { host: target.host };
  if (policy !== 'no-referrer') headers['referer'] = from.url.href;
  const body = new URLSearchParams(fields);
  let request: Request;
  if (method.toUpperCase() === 'POST') {
    headers['origin'] = policy === 'no-referrer' ? 'null' : from.url.origin;
    headers['content-type'] = 'application/x-www-form-urlencoded';
    request = new Request(target, { method: 'POST', headers, body: body.toString() });
  } else {
    for (const [key, value] of body) target.searchParams.append(key, value);
    request = new Request(target, { method: 'GET', headers });
  }
  const cookie = defaultBrowser.header(target.host, target.pathname);
  if (cookie) request.headers.set('cookie', cookie);
  const response = await handler(request);
  defaultBrowser.store(target.host, response);
  return response;
}

/**
 * Whether the page's CSP `form-action` lets a submission of its form end at
 * `target` (CSP3 source matching; after a redirect the path is not compared).
 * `form-action` does not fall back to `default-src`: without it anything goes.
 */
function formActionAllows(from: LoadedPage, target: URL): boolean {
  const csp = from.headers.get('content-security-policy');
  const directive = csp
    ?.split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === 'form-action');
  if (!directive) return true;
  return directive.slice(1).some((source) => {
    if (source === "'self'") return target.origin === from.url.origin;
    if (source === '*') return true;
    if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return target.protocol === source.toLowerCase();
    const host = /^([a-z][a-z0-9+.-]*):\/\/([^/:]+)(?::(\d+|\*))?/i.exec(source);
    if (!host) return false;
    const [, scheme, name, port] = host;
    const defaultPort = (s: string) => (s === 'https:' ? '443' : s === 'http:' ? '80' : '');
    return (
      `${scheme.toLowerCase()}:` === target.protocol &&
      name.toLowerCase() === target.hostname &&
      (port === '*' || (port ?? defaultPort(target.protocol)) === (target.port || defaultPort(target.protocol)))
    );
  });
}

/** The redirect a submission answered with, and whether the page's `form-action` lets the browser follow it. */
function followRedirect(from: LoadedPage, response: Response): { location: URL; followed: boolean } {
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get('location') ?? '');
  return { location, followed: formActionAllows(from, location) };
}

// ---------------------------------------------------------------------------

describe('an auth.ui sign-in page', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await serverWith('desk-auth-ui', { ui: { login: page } });
  });

  async function signInPage(): Promise<{ loaded: LoadedPage; state: Record<string, unknown> }> {
    const loaded = await open(
      server.handler,
      authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state: 's' }),
    );
    return { loaded, state: flowState(loaded) };
  }

  function signInFields(state: Record<string, unknown>): Record<string, string> {
    return {
      pending_auth_id: String(state['pendingAuthId']),
      csrf: String(state['csrfToken']),
      email: 'n@example.com',
    };
  }

  it('submits its form by POST, so the sign-in stays out of URLs', async () => {
    const { state } = await signInPage();

    expect(state['submitMethod']).toBe('POST');
  });

  it('completes a sign-in submitted the way its form submits', async () => {
    const { loaded, state } = await signInPage();

    const response = await submitForm(
      server.handler,
      loaded,
      String(state['submitUrl']),
      String(state['submitMethod'] ?? 'GET'),
      signInFields(state),
    );
    const { location, followed } = followRedirect(loaded, response);

    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
    expect(location.searchParams.get('code')).toEqual(expect.any(String));
    expect(followed).toBe(true);
  });

  it('gives a POSTed sign-in its Origin, which the callback accepts', async () => {
    const { loaded, state } = await signInPage();

    const response = await submitForm(server.handler, loaded, String(state['submitUrl']), 'POST', signInFields(state));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain(REDIRECT_URI);
    expect(loaded.headers.get('referrer-policy')).toBe('same-origin');
  });

  it("lets its form lead only to this server and the client's redirect_uri", async () => {
    const { loaded } = await signInPage();

    expect(formActionAllows(loaded, new URL(`http://${HOST}/oauth/callback`))).toBe(true);
    expect(formActionAllows(loaded, new URL(`${REDIRECT_URI}?code=c`))).toBe(true);
    expect(formActionAllows(loaded, new URL('https://evil.example.com/collect'))).toBe(false);
    expect(formActionAllows(loaded, new URL('http://127.0.0.1:6666/cb'))).toBe(false);
    expect(loaded.headers.get('cache-control')).toBe('no-store');
  });
});

describe('an auth.ui consent page', () => {
  it('completes the sign-in when its form is submitted', async () => {
    const server = await serverWith('desk-auth-ui-consent', {
      ui: { consent: page },
      consent: { enabled: true, rememberConsent: false },
    });
    const signIn = await open(
      server.handler,
      authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state: 's' }),
    );
    const consentResponse = await submitForm(server.handler, signIn, `/oauth/callback`, 'POST', {
      pending_auth_id: inputValue(signIn.html, 'pending_auth_id') ?? '',
      email: 'n@example.com',
    });
    const consent = await load(consentResponse, new URL(`http://${HOST}/oauth/callback`));
    const state = flowState(consent);

    const response = await submitForm(
      server.handler,
      consent,
      String(state['submitUrl']),
      String(state['submitMethod'] ?? 'GET'),
      {
        pending_auth_id: String(state['pendingAuthId']),
        csrf: String(state['csrfToken']),
        consent_submitted: '1',
        tools: 'list_tickets',
      },
    );
    const { location, followed } = followRedirect(consent, response);

    expect(location.searchParams.get('code')).toEqual(expect.any(String));
    expect(followed).toBe(true);
  });
});

describe('an auth.ui provider-selection page', () => {
  it('lets its form lead to the chosen provider', async () => {
    const server = await serverWith('desk-auth-ui-federated', {
      ui: { federated: page },
      providers: [
        {
          id: 'github',
          authorizeUrl: `${GITHUB}/authorize`,
          tokenUrl: `${GITHUB}/token`,
          userInfoEndpoint: `${GITHUB}/userinfo`,
          clientId: 'gh-client',
        },
      ],
    });
    const loaded = await open(
      server.handler,
      authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state: 's' }),
    );
    const state = flowState(loaded);

    const response = await submitForm(
      server.handler,
      loaded,
      String(state['submitUrl']),
      String(state['submitMethod'] ?? 'GET'),
      {
        pending_auth_id: String(state['pendingAuthId']),
        csrf: String(state['csrfToken']),
        federated: 'true',
        providers: 'github',
        email: 'n@example.com',
      },
    );
    const { location, followed } = followRedirect(loaded, response);

    expect(location.origin).toBe(GITHUB);
    expect(followed).toBe(true);
    expect(formActionAllows(loaded, new URL('https://evil.example.com/collect'))).toBe(false);
  });
});

describe('a built-in sign-in page', () => {
  it('completes a POSTed sign-in, and sets no form-action that would stop the redirect', async () => {
    const server = await serverWith('desk-built-in', {});
    const loaded = await open(
      server.handler,
      authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state: 's' }),
    );

    const response = await submitForm(server.handler, loaded, '/oauth/callback', 'POST', {
      pending_auth_id: inputValue(loaded.html, 'pending_auth_id') ?? '',
      email: 'n@example.com',
    });
    const { location, followed } = followRedirect(loaded, response);

    expect(location.searchParams.get('code')).toEqual(expect.any(String));
    expect(followed).toBe(true);
  });
});
