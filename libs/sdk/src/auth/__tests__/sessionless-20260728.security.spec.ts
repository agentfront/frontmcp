/**
 * MCP 2026-07-28 requests are not in a session (#624 G360, #629).
 *
 * `session:verify` minted an encrypted anonymous session for every anonymous
 * or static-key request, which needs `MCP_SESSION_SECRET`. Under 2026-07-28
 * that session was never presented again, so in production an anonymous or
 * static-key 2026-07-28 call failed with `500 SESSION_SECRET_REQUIRED` for a
 * session it would never use. The tool also saw two different per-request
 * ids: `this.context.sessionId` and `this.authInfo.sessionId`.
 *
 * Kept in its own file: the session encryption key is cached per module
 * registry once any session is minted, which would hide the production check.
 */
import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

@Tool({ name: 'where', inputSchema: {} })
class WhereTool extends ToolContext {
  async execute() {
    return {
      contextSessionId: this.context.sessionId,
      verifiedSessionId: this.context.verifiedSessionId ?? null,
      authInfoSessionId: this.authInfo?.sessionId ?? null,
      sub: this.auth.user.sub,
    };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhereTool] })
class DeskApp {}

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;
const STATIC_TOKEN = 's'.repeat(40);

const servers: TestFetchServer[] = [];
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ['NODE_ENV', 'MCP_SESSION_SECRET', 'JWT_SECRET']) saved[key] = process.env[key];
  process.env['NODE_ENV'] = 'production';
  delete process.env['MCP_SESSION_SECRET'];
  process.env['JWT_SECRET'] = 'k'.repeat(64);
});

afterAll(async () => {
  await disposeServers(servers);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function serverWith(auth: AuthConfig): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name: 'sessionless', version: '1.0.0' },
    apps: [DeskApp],
    auth,
  });
  servers.push(server);
  return server;
}

async function where(server: TestFetchServer, headers: Record<string, string> = {}) {
  const response = await rpc20260728(server.handler, 'tools/call', { name: 'where', arguments: {} }, { headers });
  return {
    status: response.status,
    error: response.message.error,
    result: (response.message.result as { structuredContent?: Record<string, unknown> } | undefined)?.structuredContent,
  };
}

describe('MCP 2026-07-28 requests need no session (#629)', () => {
  it('serves an anonymous (public mode) call in production without MCP_SESSION_SECRET', async () => {
    const server = await serverWith({ mode: 'public' } as AuthConfig);

    const first = await where(server);

    expect(first.error).toBeUndefined();
    expect(first.status).toBe(200);
  });

  it('serves a static-key call in production without MCP_SESSION_SECRET', async () => {
    const server = await serverWith({ mode: 'static', tokens: [STATIC_TOKEN] } as AuthConfig);

    const first = await where(server, { authorization: `Bearer ${STATIC_TOKEN}` });

    expect(first.error).toBeUndefined();
    expect(first.status).toBe(200);
    expect(String(first.result?.['sub'])).toMatch(/^static:/);
  });

  it('gives the tool one per-request id, never a verified session', async () => {
    const server = await serverWith({ mode: 'public' } as AuthConfig);

    const first = await where(server);
    const second = await where(server);

    expect(first.result?.['verifiedSessionId']).toBeNull();
    expect(first.result?.['authInfoSessionId']).toBe(first.result?.['contextSessionId']);
    expect(second.result?.['contextSessionId']).not.toBe(first.result?.['contextSessionId']);
  });
});
