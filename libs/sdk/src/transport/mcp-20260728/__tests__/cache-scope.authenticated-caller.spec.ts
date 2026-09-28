/**
 * A 2026-07-28 result is `cacheScope: 'public'` only for a caller who did not authenticate.
 *
 * A static-key caller (`auth: { mode: 'static' }`) authenticates with the server's key, but its
 * verified authorization carries no bearer token (the key is not a token the SDK forwards), so the
 * handler counted it as anonymous and marked its results `public`: a shared cache could then serve
 * them to callers without the key. The same flag decides who may own a task, so such a caller was
 * also refused tasks as an unauthenticated one.
 */
import 'reflect-metadata';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';

@Tool({ name: 'lookup_order', inputSchema: {} })
class LookupOrderTool extends ToolContext {
  async execute() {
    return { order: 'o-1' };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [LookupOrderTool] })
class DeskApp {}

const STATIC_KEY = 'sk-desk-static-key-0001';
const CACHEABLE: Array<[string]> = [
  ['tools/list'],
  ['resources/list'],
  ['resources/templates/list'],
  ['prompts/list'],
  ['server/discover'],
];

function server(
  auth?: FrontMcpConfigInput['auth'],
  extra: Partial<FrontMcpConfigInput> = {},
): Promise<TestFetchServer> {
  return createTestFetchServer({
    info: { name: 'cache-scope-authenticated', version: '1.0.0' },
    apps: [DeskApp],
    ...(auth ? { auth } : {}),
    ...extra,
  });
}

async function cacheScopeOf(target: TestFetchServer, method: string, headers: Record<string, string> = {}) {
  const { message } = await rpc20260728(target.handler, method, {}, { headers });
  if (message.error) throw new Error(`${method} failed: ${JSON.stringify(message.error)}`);
  return message.result?.['cacheScope'];
}

describe('cacheScope of 2026-07-28 results for an authenticated caller', () => {
  let staticServer: TestFetchServer;

  beforeAll(async () => {
    staticServer = await server({ mode: 'static', tokens: [STATIC_KEY] });
  });

  it.each(CACHEABLE)('%s is private for a caller that authenticated with a static key', async (method) => {
    expect(await cacheScopeOf(staticServer, method, { authorization: `Bearer ${STATIC_KEY}` })).toBe('private');
  });

  it.each(CACHEABLE)('%s is private for a caller with a verified bearer token', async (method) => {
    const issuer = await createTestJwtIssuer();
    const transparent = await server({
      mode: 'transparent',
      provider: issuer.issuer,
      providerConfig: { jwks: issuer.jwks },
    });
    const token = await issuer.sign({}, 'nour');

    expect(await cacheScopeOf(transparent, method, { authorization: `Bearer ${token}` })).toBe('private');
  });

  it.each(CACHEABLE)('%s stays public for an anonymous caller when nothing shapes it per caller', async (method) => {
    const publicServer = await server();

    expect(await cacheScopeOf(publicServer, method)).toBe('public');
  });
});

describe('task ownership under 2026-07-28 for a static-key caller', () => {
  it('is granted to the key, as to any authenticated caller', async () => {
    const tasksServer = await server({ mode: 'static', tokens: [STATIC_KEY] }, { tasks: { enabled: true } });

    const { message } = await rpc20260728(
      tasksServer.handler,
      'tasks/get',
      { taskId: 'no-such-task' },
      {
        headers: { authorization: `Bearer ${STATIC_KEY}` },
        capabilities: { extensions: { 'io.modelcontextprotocol/tasks': {} } },
      },
    );

    expect(message.error?.message).toBe('Task not found');
  });
});
