/**
 * The auth pages name a client by its `client_name` (#1505). A client that registered through DCR
 * (`POST /oauth/register` with `client_name`, as ChatGPT registers as "ChatGPT") was named by its random `client_id`:
 * the first sign-in page read only a CIMD document's name, the page shown again after a failed sign-in always passed
 * the `client_id` (so a CIMD client lost its name there too), and both consent screens did.
 *
 * The authorize flow now resolves the name once and keeps it on the pending authorization. The name comes from an
 * unauthenticated registration, so every built-in page escapes it.
 */
import 'reflect-metadata';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CimdService, type ClientMetadataDocument } from '@frontmcp/auth';
import { escapeHtml, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  disposeServers,
  httpGet,
  inputValue,
  postForm,
  redirectParams,
  runProviderCallback,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput, type LoginRenderContext } from '../../common';
import { type Scope } from '../../scope/scope.instance';
import { CLIENT_NAME_DISPLAY_MAX } from '../client-display-name';
import { type LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

@Tool({ name: 'list_tickets', inputSchema: {} })
class ListTicketsTool extends ToolContext {
  async execute() {
    return { tickets: [] };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ListTicketsTool] })
class DeskApp {}

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const HOST = 'desk.example.com';
const ORIGIN = `http://${HOST}`;
const REDIRECT = 'http://127.0.0.1:5555/cb';
const DESK_KEY = 'desk-key-4521';
const CIMD_CLIENT = 'https://client.example.com/oauth/metadata.json';
const GITHUB = 'https://github.example.com';
const HOSTILE_NAME = '<img src=x onerror=alert(1)>';

const COMPONENT = `
import React from 'react';
export default function Page() {
  return React.createElement('p', null, 'custom consent');
}
`;

const servers: TestFetchServer[] = [];
let dir: string;
let consentPage: string;

/** What every `login.render` call and every `authenticate()` call was given, in order. */
const rendered: LoginRenderContext[] = [];
const authenticated: Array<string | undefined> = [];

const realFetch = globalThis.fetch;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'client-name-pages-'));
  consentPage = join(dir, 'consent.tsx');
  await writeFile(consentPage, COMPONENT);
  // The upstream provider of the federated sign-in.
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

beforeEach(() => {
  rendered.length = 0;
  authenticated.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await disposeServers(servers);
  await rm(dir, { recursive: true, force: true });
});

async function serverWith(name: string, auth: Record<string, unknown>): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name, version: '1.0.0' },
    apps: [DeskApp],
    auth: { mode: 'local', ...auth } as AuthConfig,
  });
  servers.push(server);
  return server;
}

const deskKeyAuthenticate = async ({ fields }: { fields: Record<string, string> }, ctx: { clientName?: string }) => {
  authenticated.push(ctx.clientName);
  return fields['deskKey'] === DESK_KEY
    ? { ok: true as const, sub: 'user-nour' }
    : { ok: false as const, message: 'Unknown desk key' };
};

/** A `login.render` page that prints the client's name, escaped, and records the context it was given. */
function renderServer(): Promise<TestFetchServer> {
  return serverWith('client-name-render', {
    login: {
      fields: { deskKey: { type: 'password', label: 'Desk key', required: true } },
      render: (ctx: LoginRenderContext) => {
        rendered.push(ctx);
        return `<!doctype html><h1>Sign in to ${escapeHtml(ctx.clientName)}</h1>
${ctx.error ? `<p role="alert">${escapeHtml(ctx.error)}</p>` : ''}
<form method="POST" action="${escapeHtml(ctx.callbackPath)}">
<input type="hidden" name="pending_auth_id" value="${escapeHtml(ctx.pendingAuthId)}">
</form>`;
      },
    },
    authenticate: deskKeyAuthenticate,
  });
}

/** The built-in sign-in page, with a desk key field checked by `authenticate()`. */
function builtInServer(): Promise<TestFetchServer> {
  return serverWith('client-name-built-in', {
    login: { fields: { deskKey: { type: 'password', label: 'Desk key', required: true } } },
    authenticate: deskKeyAuthenticate,
  });
}

/** The built-in sign-in page, then the tool consent screen (or a custom one). */
function consentServer(ui?: Record<string, string>): Promise<TestFetchServer> {
  return serverWith('client-name-consent', {
    consent: { enabled: true, rememberConsent: false },
    ...(ui ? { ui } : {}),
  });
}

/** A sign-in through an upstream provider, then the consent screen of the provider callback. */
function federatedServer(): Promise<TestFetchServer> {
  return serverWith('client-name-federated', {
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
  });
}

/** Register a client through DCR; returns the registration the server answered with. */
async function register(server: TestFetchServer, clientName?: string): Promise<Record<string, unknown>> {
  const response = await server.handler(
    new Request(`${ORIGIN}/oauth/register`, {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [REDIRECT],
        ...(clientName !== undefined ? { client_name: clientName } : {}),
      }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as Record<string, unknown>;
}

async function registerId(server: TestFetchServer, clientName?: string): Promise<string> {
  return String((await register(server, clientName))['client_id']);
}

/** Open the sign-in page for `clientId`. */
async function openSignIn(server: TestFetchServer, clientId: string): Promise<{ html: string; pendingAuthId: string }> {
  const response = await httpGet(
    server.handler,
    authorizePath({ client_id: clientId, redirect_uri: REDIRECT, state: 'st' }),
    HOST,
  );
  expect(response.status).toBe(200);
  const html = await response.text();
  const pendingAuthId = inputValue(html, 'pending_auth_id');
  if (!pendingAuthId) throw new Error('no pending_auth_id on the sign-in page');
  return { html, pendingAuthId };
}

/** Submit the sign-in form, as the browser that opened it. */
function submitSignIn(server: TestFetchServer, fields: Record<string, string>): Promise<Response> {
  return postForm(server.handler, '/oauth/callback', fields, HOST, { origin: ORIGIN });
}

/** Sign in with a wrong desk key; returns the page shown again. */
async function failSignIn(server: TestFetchServer, pendingAuthId: string): Promise<string> {
  const response = await submitSignIn(server, { pending_auth_id: pendingAuthId, deskKey: 'wrong-key' });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('Unknown desk key');
  return html;
}

const localAuthOf = (server: TestFetchServer) => (server.instance.getScopes()[0] as Scope).auth as LocalPrimaryAuth;

/** The `AuthFlowState` a custom `auth.ui` page carries in `window.__FRONTMCP_AUTH__`. */
function flowState(html: string): Record<string, unknown> {
  const match = /window\["__FRONTMCP_AUTH__"\] = (.*);<\/script>/.exec(html);
  if (!match) throw new Error('not an auth.ui page');
  return JSON.parse(match[1]) as Record<string, unknown>;
}

/** Sign in with an email on the built-in page of a consent server; returns the consent page. */
async function reachConsent(server: TestFetchServer, clientId: string): Promise<string> {
  const { pendingAuthId } = await openSignIn(server, clientId);
  const response = await submitSignIn(server, { pending_auth_id: pendingAuthId, email: 'nour@example.com' });
  expect(response.status).toBe(200);
  return response.text();
}

describe('a client registered through DCR is named by its client_name (#1505)', () => {
  it('on the first login.render page', async () => {
    const server = await renderServer();
    const clientId = await registerId(server, 'ChatGPT');

    const { html } = await openSignIn(server, clientId);

    expect(rendered.map((ctx) => ctx.clientName)).toEqual(['ChatGPT']);
    expect(rendered[0].clientId).toBe(clientId);
    expect(html).toContain('<h1>Sign in to ChatGPT</h1>');
  });

  it('on the login.render page shown again after a failed sign-in, and in the authenticate() context', async () => {
    const server = await renderServer();
    const clientId = await registerId(server, 'ChatGPT');
    const { pendingAuthId } = await openSignIn(server, clientId);

    const retry = await failSignIn(server, pendingAuthId);

    expect(rendered.map((ctx) => ctx.clientName)).toEqual(['ChatGPT', 'ChatGPT']);
    expect(rendered[1].error).toBe('Unknown desk key');
    expect(authenticated).toEqual(['ChatGPT']);
    expect(retry).toContain('<h1>Sign in to ChatGPT</h1>');
  });

  it('on the page shown again once the registration left memory: the name is kept on the pending authorization', async () => {
    const server = await renderServer();
    const clientId = await registerId(server, 'ChatGPT');
    const { pendingAuthId } = await openSignIn(server, clientId);
    const registry = localAuthOf(server).dcrClientRegistry;
    const get = jest.spyOn(registry, 'get').mockReturnValue(undefined);
    const load = jest.spyOn(registry, 'load').mockResolvedValue(undefined);

    await failSignIn(server, pendingAuthId);

    expect(rendered.map((ctx) => ctx.clientName)).toEqual(['ChatGPT', 'ChatGPT']);
    expect(authenticated).toEqual(['ChatGPT']);
    expect(get).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('on a page shown again for a pending authorization written without the name, from the registration', async () => {
    const server = await renderServer();
    const clientId = await registerId(server, 'ChatGPT');
    const { pendingAuthId } = await openSignIn(server, clientId);
    const store = localAuthOf(server).authorizationStore;
    const record = await store.getPendingAuthorization(pendingAuthId);
    if (!record) throw new Error('no pending authorization');
    delete record.clientName;
    await store.storePendingAuthorization(record);

    await failSignIn(server, pendingAuthId);

    expect(rendered.map((ctx) => ctx.clientName)).toEqual(['ChatGPT', 'ChatGPT']);
  });

  it('by its client_id when it registered no name', async () => {
    const server = await renderServer();
    const clientId = await registerId(server);
    const { pendingAuthId } = await openSignIn(server, clientId);

    await failSignIn(server, pendingAuthId);

    expect(rendered.map((ctx) => ctx.clientName)).toEqual([clientId, clientId]);
  });

  it('on the built-in sign-in page', async () => {
    const server = await builtInServer();
    const clientId = await registerId(server, 'ChatGPT');

    const { html } = await openSignIn(server, clientId);

    expect(html).toContain('Authorize access to ChatGPT');
    expect(html).not.toContain(clientId);
  });

  it('on the built-in consent screen', async () => {
    const server = await consentServer();
    const clientId = await registerId(server, 'ChatGPT');

    const consent = await reachConsent(server, clientId);

    expect(consent).toContain('Choose which tools ChatGPT can access');
    expect(consent).not.toContain(clientId);
  });

  it('in the state of a custom consent page', async () => {
    const server = await consentServer({ consent: consentPage });
    const clientId = await registerId(server, 'ChatGPT');

    const state = flowState(await reachConsent(server, clientId));

    expect(state['slot']).toBe('consent');
    expect(state['clientId']).toBe(clientId);
    expect(state['clientName']).toBe('ChatGPT');
  });

  it('on the consent screen of a sign-in through an upstream provider, from the federated session', async () => {
    const server = await federatedServer();
    const clientId = await registerId(server, 'ChatGPT');
    const scope = server.instance.getScopes()[0] as Scope;
    const { pendingAuthId } = await openSignIn(server, clientId);
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
    // The name travels on the federated session: the registration is not read again.
    const registry = localAuthOf(server).dcrClientRegistry;
    jest.spyOn(registry, 'get').mockReturnValue(undefined);
    jest.spyOn(registry, 'load').mockResolvedValue(undefined);

    const consent = await runProviderCallback(scope, 'github', { code: 'gh-code', state: providerState }, HOST);

    expect(consent.status).toBe(200);
    const html = await consent.text();
    expect(html).toContain('Choose which tools ChatGPT can access');
    expect(html).not.toContain(clientId);
  });
});

describe('a CIMD client (#1505)', () => {
  beforeEach(() => {
    const document: ClientMetadataDocument = {
      client_id: CIMD_CLIENT,
      client_name: 'Desk companion',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
    jest.spyOn(CimdService.prototype, 'resolveClientMetadata').mockImplementation(async (clientId) => ({
      isCimdClient: true,
      metadata: { ...document, client_id: clientId },
      fromCache: true,
    }));
  });

  it('keeps its client_name on the page shown again after a failed sign-in', async () => {
    const server = await renderServer();
    const { pendingAuthId } = await openSignIn(server, CIMD_CLIENT);

    const retry = await failSignIn(server, pendingAuthId);

    expect(rendered.map((ctx) => ctx.clientName)).toEqual(['Desk companion', 'Desk companion']);
    expect(authenticated).toEqual(['Desk companion']);
    expect(retry).toContain('<h1>Sign in to Desk companion</h1>');
  });
});

describe('a client_name sent to /oauth/register is shown as text only (#1505)', () => {
  it('is escaped on the built-in sign-in page and on the page shown again', async () => {
    const server = await builtInServer();
    const clientId = await registerId(server, HOSTILE_NAME);
    const { html, pendingAuthId } = await openSignIn(server, clientId);

    const retry = await failSignIn(server, pendingAuthId);

    for (const page of [html, retry]) {
      expect(page).toContain(`Authorize access to ${escapeHtml(HOSTILE_NAME)}`);
      expect(page).not.toContain('<img src=x');
    }
  });

  it('is escaped on the built-in consent screen', async () => {
    const server = await consentServer();
    const clientId = await registerId(server, HOSTILE_NAME);

    const consent = await reachConsent(server, clientId);

    expect(consent).toContain(`Choose which tools ${escapeHtml(HOSTILE_NAME)} can access`);
    expect(consent).not.toContain('<img src=x');
  });

  it('is cut for display, while the registration keeps what the client sent', async () => {
    const server = await renderServer();
    const longName = `Desk ${'companion '.repeat(40)}`.trim();
    const registration = await register(server, longName);

    await openSignIn(server, String(registration['client_id']));

    expect(registration['client_name']).toBe(longName);
    const shown = rendered[0].clientName;
    expect(Array.from(shown)).toHaveLength(CLIENT_NAME_DISPLAY_MAX);
    expect(shown.endsWith('…')).toBe(true);
    expect(longName.startsWith(shown.slice(0, -1))).toBe(true);
  });
});
