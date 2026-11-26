/**
 * Clients registered through `POST /oauth/register` survive a restart on a SQLite `tokenStorage` (#1478): ChatGPT and
 * Claude register once and keep their `client_id`, so a server that forgot it after a restart refused every
 * `/oauth/authorize` they sent, and the person had to add the connector again.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  disposeServers,
  httpGet,
  inputValue,
  PKCE_VERIFIER,
  postForm,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, FlowHooksOf, Plugin, Tool, ToolContext, type FlowCtxOf, type FrontMcpConfigInput } from '../../common';
import { type Scope } from '../../scope/scope.instance';

const RegisterHook = FlowHooksOf('oauth:register');

const seenRegistrations: Array<{ clientId?: string; secret?: string; redirectUris?: string[] }> = [];

@Plugin({ name: 'registration-audit' })
class RegistrationAuditPlugin {
  @RegisterHook.Did('registerClient')
  audit(ctx: FlowCtxOf<'oauth:register'>) {
    const registered = ctx.state.registered;
    seenRegistrations.push({
      clientId: registered?.client_id,
      secret: registered?.client_secret,
      redirectUris: registered?.redirect_uris,
    });
  }
}

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

const REDIRECT = 'http://127.0.0.1:5555/cb';
const HOST = 'desk.example.com';

type TokenStorage = NonNullable<Extract<FrontMcpConfigInput['auth'], { mode: 'local' }>['tokenStorage']>;

describe('DCR clients after a restart (#1478)', () => {
  let directory: string;
  let servers: TestFetchServer[];

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-dcr-clients-'));
    servers = [];
    seenRegistrations.length = 0;
  });

  afterEach(async () => {
    await disposeServers(servers);
    await rm(directory, { recursive: true, force: true });
  });

  async function startServer(tokenStorage: TokenStorage, dcr?: { enabled: boolean }): Promise<TestFetchServer> {
    const server = await createTestFetchServer({
      info: { name: 'dcr-restart', version: '1.0.0' },
      apps: [DeskApp],
      plugins: [RegistrationAuditPlugin],
      auth: { mode: 'local', tokenStorage, dcr },
    });
    servers.push(server);
    return server;
  }

  /** Stop `server`, as a restart does. */
  async function stop(server: TestFetchServer): Promise<void> {
    await disposeServers([server]);
    servers = servers.filter((s) => s !== server);
  }

  async function register(server: TestFetchServer, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await server.handler(
      new Request(`http://${HOST}/oauth/register`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(201);
    return (await response.json()) as Record<string, unknown>;
  }

  function authorize(server: TestFetchServer, clientId: string, redirectUri = REDIRECT): Promise<Response> {
    return httpGet(server.handler, authorizePath({ client_id: clientId, redirect_uri: redirectUri, state: 's' }), HOST);
  }

  /** Sign in on the login page and return the authorization code. */
  async function signIn(server: TestFetchServer, clientId: string): Promise<string> {
    const page = await authorize(server, clientId);
    expect(page.status).toBe(200);
    const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
    const callback = await httpGet(
      server.handler,
      `/oauth/callback?${new URLSearchParams({ pending_auth_id: pendingAuthId, email: 'nour@example.com' })}`,
      HOST,
    );
    expect(callback.status).toBe(302);
    return redirectParams(callback).get('code') ?? '';
  }

  async function token(server: TestFetchServer, form: Record<string, string>) {
    const response = await postForm(server.handler, '/oauth/token', form, HOST);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const sqlite = (): TokenStorage => ({ sqlite: { path: path.join(directory, 'tokens.sqlite') } });

  it('authorizes a client registered before a restart on the same SQLite file', async () => {
    const first = await startServer(sqlite());
    const { client_id } = await register(first, { redirect_uris: [REDIRECT], client_name: 'ChatGPT' });
    await stop(first);

    const restarted = await startServer(sqlite());
    const page = await authorize(restarted, String(client_id));

    expect(page.status).toBe(200);
    expect(inputValue(await page.text(), 'pending_auth_id')).toBeDefined();
  });

  it('checks the redirect_uri a client registered before a restart', async () => {
    const first = await startServer(sqlite());
    const { client_id } = await register(first, { redirect_uris: [REDIRECT] });
    await stop(first);

    const restarted = await startServer(sqlite());
    const page = await authorize(restarted, String(client_id), 'http://127.0.0.1:5555/other');

    expect(page.status).toBe(400);
    expect(page.headers.get('location')).toBeNull();
  });

  it('authenticates a confidential client with its secret after a restart, and refuses a wrong one', async () => {
    const first = await startServer(sqlite());
    const registration = await register(first, {
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'client_secret_post',
    });
    const clientId = String(registration['client_id']);
    const secret = String(registration['client_secret']);
    await stop(first);

    const restarted = await startServer(sqlite());
    const code = await signIn(restarted, clientId);
    const exchange = { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT };
    expect(
      (await token(restarted, { ...exchange, code_verifier: PKCE_VERIFIER, client_secret: 'wrong' })).body,
    ).toEqual(expect.objectContaining({ error: 'invalid_client' }));

    const issued = await token(restarted, { ...exchange, code_verifier: PKCE_VERIFIER, client_secret: secret });
    expect(issued.status).toBe(200);
    await stop(restarted);

    const again = await startServer(sqlite());
    const refreshed = await token(again, {
      grant_type: 'refresh_token',
      refresh_token: String(issued.body['refresh_token']),
      client_id: clientId,
      client_secret: secret,
    });
    expect(refreshed.status).toBe(200);
  });

  it('keeps a client for another lifetime after each token grant', async () => {
    const server = await startServer(sqlite());
    const clientId = String((await register(server, { redirect_uris: [REDIRECT] }))['client_id']);
    const storage = (server.instance.getScopes()[0] as Scope).auth.tokenStorageAdapter;
    await storage?.expire(`oauth:client:${clientId}`, 5);

    const code = await signIn(server, clientId);
    const issued = await token(server, {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: PKCE_VERIFIER,
    });

    expect(issued.status).toBe(200);
    expect(await storage?.ttl(`oauth:client:${clientId}`)).toBeGreaterThan(30 * 24 * 3600 - 10);
  });

  it('refuses a client registered before a restart once DCR is off', async () => {
    const first = await startServer(sqlite());
    const { client_id } = await register(first, { redirect_uris: [REDIRECT] });
    await stop(first);

    const restarted = await startServer(sqlite(), { enabled: false });
    expect((await authorize(restarted, String(client_id))).status).toBe(400);
  });

  it('forgets a client at a restart with the memory token storage, as before', async () => {
    const first = await startServer('memory');
    const { client_id } = await register(first, { redirect_uris: [REDIRECT] });
    expect((await authorize(first, String(client_id))).status).toBe(200);
    await stop(first);

    const restarted = await startServer('memory');
    expect((await authorize(restarted, String(client_id))).status).toBe(400);
  });

  it("gives a Did('registerClient') hook the accepted registration", async () => {
    const server = await startServer(sqlite());
    const registration = await register(server, {
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'client_secret_basic',
    });

    expect(seenRegistrations).toEqual([
      { clientId: registration['client_id'], secret: registration['client_secret'], redirectUris: [REDIRECT] },
    ]);
  });
});
