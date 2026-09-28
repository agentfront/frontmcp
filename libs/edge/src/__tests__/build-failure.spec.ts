/**
 * The edge module builds its server on the first request (V8 isolates forbid I/O at module
 * evaluation). A build that failed used to be thrown out of `fetch`, so the platform answered its
 * own opaque 500 (a missing secret included), and the next request built it again at once.
 *
 * Every failed build is now answered: a configuration fault as 500 `server_misconfigured`, anything
 * else as 503 `server_unavailable` with `Retry-After`, without the error's message. A failed build
 * is kept until its retry delay passes, on the worker and in a session Durable Object alike.
 */
import 'reflect-metadata';

import { App, LogLevel, ProviderScope, Tool, ToolContext } from '@frontmcp/sdk';

import { createEdgeMcp } from '../index';
import { createEdgeSessionDurableObject } from '../session-host';

@Tool({ name: 'lookup', inputSchema: {} })
class LookupTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

const remote = { refuse: true, connects: 0 };

class RemoteClient {}

@App({
  id: 'desk',
  name: 'Desk',
  tools: [LookupTool],
  providers: [
    {
      name: 'remote-client',
      provide: RemoteClient,
      scope: ProviderScope.GLOBAL,
      inject: () => [] as const,
      useFactory: async () => {
        remote.connects++;
        if (remote.refuse) throw new Error('connect ECONNREFUSED 10.0.0.7:5432 (secret-host.internal)');
        return new RemoteClient();
      },
    },
  ],
})
class DeskApp {}

const config = {
  info: { name: 'edge-build-failure', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
};

function initialize(): Request {
  return new Request('https://desk.example.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1.0.0' } },
    }),
  });
}

async function answer(response: Response) {
  const text = await response.text();
  const body = JSON.parse(text) as Record<string, unknown>;
  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    error: body['error'],
    code: body['code'],
    text,
  };
}

describe('the edge module when its server fails to build', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.assign(remote, { refuse: true, connects: 0 });
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('answers 503 server_unavailable from fetch, without rebuilding during the retry delay', async () => {
    const worker = createEdgeMcp(config as never);

    const first = await answer(await worker.fetch(initialize(), {}));
    const second = await answer(await worker.fetch(initialize(), {}));

    expect(
      [first, second].map(({ status, error, code, retryAfter }) => ({ status, error, code, retry: !!retryAfter })),
    ).toEqual([
      { status: 503, error: 'server_unavailable', code: 'SERVER_START_FAILED', retry: true },
      { status: 503, error: 'server_unavailable', code: 'SERVER_START_FAILED', retry: true },
    ]);
    expect(first.text).not.toContain('secret-host.internal');
    expect(remote.connects).toBe(1);
    // The operator reads the cause in the log, once per failed attempt.
    const edgeLogs = consoleError.mock.calls.filter(([message]) => String(message).startsWith('[frontmcp/edge]'));
    expect(edgeLogs).toHaveLength(1);
  });

  it('answers 500 server_misconfigured from fetch for a config the schema refuses', async () => {
    const worker = createEdgeMcp({ ...config, info: { name: 42, version: '1.0.0' } } as never);

    const { status, error, code } = await answer(await worker.fetch(initialize(), {}));

    expect({ status, error, code }).toEqual({ status: 500, error: 'server_misconfigured', code: 'CONFIG_INVALID' });
  });

  it('answers 503 from a session Durable Object whose scope fails to build, and recovers after the delay', async () => {
    let builds = 0;
    const SessionObject = createEdgeSessionDurableObject(
      async () => {
        builds++;
        if (remote.refuse) throw new Error('connect ECONNREFUSED 10.0.0.7:5432 (secret-host.internal)');
        const { FrontMcpInstance } = await import('@frontmcp/sdk');
        const instance = await FrontMcpInstance.createForGraph({ ...config, serve: false } as never);
        return instance.getPrimaryScope() as never;
      },
      () => undefined,
    );
    const session = new SessionObject({}, {});

    const refused = await answer(await session.fetch(initialize()));
    const refusedAgain = await answer(await session.fetch(initialize()));

    expect([refused.status, refusedAgain.status, refused.error]).toEqual([503, 503, 'server_unavailable']);
    expect(builds).toBe(1);

    remote.refuse = false;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const served = await session.fetch(initialize());

    expect(served.status).toBe(200);
    expect(builds).toBe(2);
  });
});
