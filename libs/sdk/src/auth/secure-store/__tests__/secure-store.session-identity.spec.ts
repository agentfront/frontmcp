/**
 * `this.secureStore` with `scope: 'session'` belongs to the session the server verified, never to
 * an `mcp-session-id` a client merely sends.
 *
 * The namespace was derived from `FrontMcpContext.sessionId`, which is that header as sent (or a
 * per-request `anon:` id when there is none). Under MCP 2026-07-28 and on the stateless web
 * transport nothing checks it, so a signed-in caller who sent another caller's id read and
 * overwrote that caller's secrets, and a caller who sent none lost its secrets after each request.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { SignJWT } from 'jose';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../../__test-utils__/helpers/oauth-flow.helpers';
import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { type LocalPrimaryAuth } from '../../instances/instance.local-primary-auth';

/** Stores `secret` when given, and answers the secret this caller's namespace holds. */
@Tool({ name: 'vault', inputSchema: { secret: z.string().optional() } })
class VaultTool extends ToolContext {
  async execute(input: { secret?: string }) {
    if (input.secret !== undefined) await this.secureStore.set('api-key', input.secret);
    return { secret: (await this.secureStore.get<string>('api-key')) ?? null };
  }
}

@App({ id: 'keys', name: 'Keys', tools: [VaultTool] })
class KeysApp {}

const JWT_SECRET = 's'.repeat(64);
const AUDIENCE = 'https://keys.example.com';
const config: FrontMcpConfigInput = {
  info: { name: 'secure-store-session-identity', version: '1.0.0' },
  apps: [KeysApp],
  logging: { level: LogLevel.Off },
  auth: { mode: 'local', expectedAudience: AUDIENCE, secureStore: { scope: 'session' } } as FrontMcpConfigInput['auth'],
};

const servers: TestFetchServer[] = [];
let previousSecret: string | undefined;

beforeAll(() => {
  previousSecret = process.env['JWT_SECRET'];
  process.env['JWT_SECRET'] = JWT_SECRET;
});

afterAll(async () => {
  await disposeServers(servers);
  if (previousSecret === undefined) delete process.env['JWT_SECRET'];
  else process.env['JWT_SECRET'] = previousSecret;
});

/** A token this server issued for `subject`. */
function tokenFor(scope: { auth: unknown }, subject: string): Promise<string> {
  const auth = scope.auth as LocalPrimaryAuth;
  return new SignJWT({ sub: subject, scope: 'openid' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(auth.issuer)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

type Outcome = { secret: string | null } | string;

function outcome(message: {
  result?: { isError?: boolean; structuredContent?: unknown; content?: Array<{ text?: string }> };
  error?: { message?: string };
}): Outcome {
  if (message.error) return `error: ${message.error.message}`;
  if (message.result?.isError) return `error: ${message.result.content?.map((part) => part.text).join(' ')}`;
  return message.result?.structuredContent as Outcome;
}

describe.each(['MCP 2026-07-28', 'the stateless web transport'] as const)(
  'a session-scoped secure store over %s',
  (transport) => {
    let server: TestFetchServer;
    let alice: string;
    let mallory: string;
    let anonymous: string;

    beforeAll(async () => {
      server = await createTestFetchServer(config);
      servers.push(server);
      const scope = server.instance.getScopes()[0];
      [alice, mallory, anonymous] = await Promise.all([
        tokenFor(scope, 'alice'),
        tokenFor(scope, 'mallory'),
        tokenFor(scope, 'anon:3c4d'),
      ]);
    });

    async function vault(token: string, args: Record<string, unknown>, sessionId?: string): Promise<Outcome> {
      const headers = { authorization: `Bearer ${token}`, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) };
      if (transport === 'MCP 2026-07-28') {
        const { message } = await rpc20260728(
          server.handler,
          'tools/call',
          { name: 'vault', arguments: args },
          { headers },
        );
        return outcome(message);
      }
      const response = await server.handler(
        new Request('http://localhost/', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2025-06-18',
            ...headers,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'vault', arguments: args },
          }),
        }),
      );
      const text = await response.text();
      const data = text
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length);
      return outcome(JSON.parse(data ?? text));
    }

    it('does not let a caller read another caller’s secret by sending its mcp-session-id', async () => {
      const victimSession = `victim-read-${transport === 'MCP 2026-07-28' ? '2026' : 'web'}`;
      await vault(alice, { secret: 'sk-alice' }, victimSession);

      expect(await vault(mallory, {}, victimSession)).toEqual({ secret: null });
    });

    it('does not let a caller overwrite another caller’s secret by sending its mcp-session-id', async () => {
      const victimSession = `victim-write-${transport === 'MCP 2026-07-28' ? '2026' : 'web'}`;
      await vault(alice, { secret: 'sk-alice' }, victimSession);

      await vault(mallory, { secret: 'sk-mallory' }, victimSession);

      expect(await vault(alice, {}, victimSession)).toEqual({ secret: 'sk-alice' });
    });

    it('keeps a signed-in caller’s secret across its requests without a session', async () => {
      await vault(alice, { secret: 'sk-alice-2' });

      expect(await vault(alice, {})).toEqual({ secret: 'sk-alice-2' });
    });

    it('refuses an anonymous caller without a verified session', async () => {
      expect(await vault(anonymous, { secret: 'sk-anon' })).toEqual(
        expect.stringContaining('needs a verified session or a signed-in caller'),
      );
    });
  },
);

describe('a session-scoped secure store for clients with a session on the Node server', () => {
  let node: http.Server;
  let base: string;
  let alice: string;
  let requestId = 1;

  beforeAll(async () => {
    const instance = await FrontMcpInstance.createForGraph(config);
    const app = (await FrontMcpInstance.createHandler(config)) as http.RequestListener;
    alice = await tokenFor(instance.getScopes()[0], 'alice');
    node = http.createServer(app);
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      node.close(() => resolve());
      node.closeAllConnections();
    });
    // Let the server finish closing the sessions of the connections it just dropped.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  function post(body: Record<string, unknown>, sessionId?: string): Promise<Response> {
    return fetch(`${base}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        authorization: `Bearer ${alice}`,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function openSession(): Promise<string> {
    const clientInfo = { name: 'secure-store-spec', version: '1' };
    const response = await post({
      jsonrpc: '2.0',
      id: requestId++,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo },
    });
    await response.text();
    const sessionId = response.headers.get('mcp-session-id');
    if (!sessionId) throw new Error(`initialize returned no session (HTTP ${response.status})`);
    await (await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)).text();
    return sessionId;
  }

  async function vault(sessionId: string, args: Record<string, unknown>): Promise<Outcome> {
    const response = await post(
      { jsonrpc: '2.0', id: requestId++, method: 'tools/call', params: { name: 'vault', arguments: args } },
      sessionId,
    );
    const text = await response.text();
    const data = text
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice('data: '.length);
    return outcome(JSON.parse(data ?? text));
  }

  it('keeps a secret within its session, apart from the same user’s other session', async () => {
    const [first, second] = [await openSession(), await openSession()];
    await vault(first, { secret: 'sk-first' });

    expect({ first: await vault(first, {}), second: await vault(second, {}) }).toEqual({
      first: { secret: 'sk-first' },
      second: { secret: null },
    });
  });
});
