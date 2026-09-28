/**
 * Stateful MCP on Workers end to end: the worker's session router, the
 * Durable Object class, and the real SDK (`http:request` flow + persistent
 * transport). The router addresses the Durable Object by the `mcp-session-id`
 * the client sends, so the session must refuse anyone but the caller that
 * opened it: another caller who presents its id is answered as an unknown
 * session (404), and the owner's session carries on.
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import { createEdgeSessionDurableObject, createEdgeSessionRouter } from '../session-host';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

const ISSUER = 'https://auth.example.com';
const PROTOCOL = '2025-06-18';

/** The scope a Durable Object serves (as `createEdgeSessionDurableObject` types it). */
type Scope = Awaited<ReturnType<Parameters<typeof createEdgeSessionDurableObject>[0]>>;

let signToken: (sub: string) => Promise<string>;
let jwks: { keys: JWK[] };
let instance: FrontMcpInstance;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
  signToken = (sub) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
  instance = await FrontMcpInstance.createForGraph({
    info: { name: 'edge-sessions', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    auth: { mode: 'transparent', provider: ISSUER, providerConfig: { jwks } },
  } as never);
});

/** A Worker `env` whose Durable Object namespace keeps one real instance per session name. */
function workerEnv(): { SESSIONS: unknown } {
  const scope = instance.getScopes()[0] as unknown as Scope;
  const SessionObject = createEdgeSessionDurableObject(
    async () => scope,
    () => undefined,
  );
  const objects = new Map<string, InstanceType<typeof SessionObject>>();
  const env = {
    SESSIONS: {
      idFromName: (name: string) => name,
      get: (id: unknown) => {
        const name = String(id);
        let object = objects.get(name);
        if (!object) {
          object = new SessionObject(undefined, env);
          objects.set(name, object);
        }
        return object;
      },
    },
  };
  return env;
}

async function send(
  env: unknown,
  token: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; sessionId?: string; body?: unknown },
): Promise<Response> {
  const router = createEdgeSessionRouter('SESSIONS');
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: init.method === 'GET' ? 'text/event-stream' : 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL,
  };
  if (init.sessionId) headers['mcp-session-id'] = init.sessionId;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const response = await router(
    new Request('https://worker.example.com/', {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }),
    env,
  );
  if (!response) throw new Error('the router did not route the request to a Durable Object');
  return response;
}

async function openSession(env: unknown, token: string): Promise<string> {
  const init = await send(env, token, {
    method: 'POST',
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'owner', version: '1.0.0' } },
    },
  });
  expect(init.status).toBe(200);
  const sessionId = init.headers.get('mcp-session-id') ?? '';
  expect(sessionId).not.toBe('');
  await init.body?.cancel();
  const initialized = await send(env, token, {
    method: 'POST',
    sessionId,
    body: { jsonrpc: '2.0', method: 'notifications/initialized' },
  });
  expect(initialized.status).toBe(202);
  return sessionId;
}

const toolsList = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

describe('Durable Object session ownership', () => {
  it('refuses another caller who presents the session id, on POST, GET and DELETE', async () => {
    const env = workerEnv();
    const nour = await signToken('nour');
    const mallory = await signToken('mallory');
    const sessionId = await openSession(env, nour);

    for (const method of ['POST', 'GET', 'DELETE'] as const) {
      const response = await send(env, mallory, {
        method,
        sessionId,
        ...(method === 'POST' ? { body: toolsList } : {}),
      });
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error?: { message?: string } }).error?.message).toBe('Session not found');
    }

    const ownerCall = await send(env, nour, { method: 'POST', sessionId, body: toolsList });
    expect(ownerCall.status).toBe(200);
    expect(await ownerCall.text()).toContain('"ping"');
  });

  it('lets the owner end its session', async () => {
    const env = workerEnv();
    const nour = await signToken('nour');
    const sessionId = await openSession(env, nour);

    const response = await send(env, nour, { method: 'DELETE', sessionId });

    expect(response.status).toBe(200);
  });
});
