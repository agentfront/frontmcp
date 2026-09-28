/**
 * A Durable Object's persistent MCP session (edge `createEdgeSessionDurableObject`)
 * is addressed by the `mcp-session-id` the client sends, a plain id that
 * `session:verify` cannot check against the caller's token. The session belongs
 * to the caller that opened it: another caller who presents its id is answered
 * as MCP answers an unknown session (404), on every method, and the owner's
 * session is left alone.
 *
 * Driven the way the Durable Object runs it: `runHttpRequestFlowWeb` with the
 * session's persistent server + transport.
 */
import 'reflect-metadata';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  type TestFetchServer,
  type TestJwtIssuer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { type Scope } from '../../scope/scope.instance';
import { runHttpRequestFlowWeb } from '../web-fetch-handler';
import { buildPersistentWebStandardMcp, type WebStandardMcpPair } from '../web-standard-mcp';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

const PROTOCOL = '2025-06-18';

const servers: TestFetchServer[] = [];

afterAll(async () => {
  await disposeServers(servers);
});

async function persistentSession(
  auth: FrontMcpConfigInput['auth'] | undefined,
  sessionId: string,
): Promise<{ scope: Scope; pair: WebStandardMcpPair }> {
  const server = await createTestFetchServer({
    info: { name: 'persistent-session-owner', version: '1.0.0' },
    apps: [DeskApp],
    ...(auth ? { auth } : {}),
  });
  servers.push(server);
  const scope = server.instance.getScopes()[0] as Scope;
  return { scope, pair: await buildPersistentWebStandardMcp(scope, { sessionId }) };
}

type Send = (method: 'GET' | 'POST' | 'DELETE', token: string | undefined, body?: unknown) => Promise<Response>;

function sender(scope: Scope, pair: WebStandardMcpPair, sessionId: string): Send {
  return async (method, token, body) => {
    const headers: Record<string, string> = {
      accept: method === 'GET' ? 'text/event-stream' : 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers['authorization'] = `Bearer ${token}`;
    const isInitialize = (body as { method?: string } | undefined)?.method === 'initialize';
    if (!isInitialize) headers['mcp-session-id'] = sessionId;
    const response = await runHttpRequestFlowWeb(
      scope,
      new Request('http://localhost/', {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      { persistent: pair },
    );
    if (!response) throw new Error('the flow produced no response');
    return response;
  };
}

/** Initialize the session as its owner would. */
async function open(send: Send, token: string | undefined): Promise<void> {
  const init = await send('POST', token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'owner', version: '1.0.0' } },
  });
  expect(init.status).toBe(200);
  await init.body?.cancel();
  const initialized = await send('POST', token, { jsonrpc: '2.0', method: 'notifications/initialized' });
  expect(initialized.status).toBe(202);
}

async function listTools(send: Send, token: string | undefined): Promise<Response> {
  return send('POST', token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
}

async function expectSessionNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  const body = (await response.json()) as { error?: { code?: number; message?: string } };
  expect(body.error).toEqual({ code: -32001, message: 'Session not found' });
}

describe('persistent session ownership', () => {
  let issuer: TestJwtIssuer;

  beforeAll(async () => {
    issuer = await createTestJwtIssuer();
  });

  const transparent = (): FrontMcpConfigInput['auth'] => ({
    mode: 'transparent',
    provider: issuer.issuer,
    providerConfig: { jwks: issuer.jwks },
  });

  it('serves the caller that opened the session', async () => {
    const { scope, pair } = await persistentSession(transparent(), 'sess-owner');
    const send = sender(scope, pair, 'sess-owner');
    const nour = await issuer.sign({}, 'nour');
    await open(send, nour);

    const response = await listTools(send, nour);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"ping"');
  });

  it('answers another caller as an unknown session, on POST, GET and DELETE', async () => {
    const { scope, pair } = await persistentSession(transparent(), 'sess-stranger');
    const send = sender(scope, pair, 'sess-stranger');
    const nour = await issuer.sign({}, 'nour');
    const mallory = await issuer.sign({}, 'mallory');
    await open(send, nour);

    await expectSessionNotFound(await listTools(send, mallory));
    await expectSessionNotFound(await send('GET', mallory));
    await expectSessionNotFound(await send('DELETE', mallory));

    // The owner's session is untouched.
    const after = await listTools(send, nour);
    expect(after.status).toBe(200);
    expect(await after.text()).toContain('"ping"');
  });

  it('keeps serving the same user after a token refresh', async () => {
    const { scope, pair } = await persistentSession(transparent(), 'sess-refresh');
    const send = sender(scope, pair, 'sess-refresh');
    await open(send, await issuer.sign({}, 'nour'));

    const refreshed = await issuer.sign({ refreshed: true }, 'nour');
    const response = await listTools(send, refreshed);

    expect(response.status).toBe(200);
  });

  it('lets the owner end the session', async () => {
    const { scope, pair } = await persistentSession(transparent(), 'sess-delete');
    const send = sender(scope, pair, 'sess-delete');
    const nour = await issuer.sign({}, 'nour');
    await open(send, nour);

    const response = await send('DELETE', nour);

    expect(response.status).toBe(200);
  });

  it('in public mode, has no caller identity to bind, so the session id stays the credential', async () => {
    const { scope, pair } = await persistentSession(undefined, 'sess-public');
    const send = sender(scope, pair, 'sess-public');
    await open(send, undefined);

    const response = await listTools(send, undefined);

    expect(response.status).toBe(200);
  });
});
