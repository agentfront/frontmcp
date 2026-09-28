/**
 * On an edge isolate `createFetchHandler()` builds the server on its first request. Before, only a
 * recognized misconfiguration (a missing secret, a startup check) was answered: any other build
 * failure (an invalid config, a remote that refused the connection, a package that failed to load)
 * was thrown out of the handler, so the platform answered its own opaque 500, and every later
 * request built the server again.
 *
 * Every build failure is now answered: a configuration fault as 500 `server_misconfigured`,
 * anything else as 503 `server_unavailable` with `Retry-After`, without the error's message. A
 * failed build is kept and refuses requests until its retry delay passes; the first request after
 * it tries again, so a transient failure recovers.
 */
import 'reflect-metadata';

import { App, LogLevel, ProviderScope, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { createDeferredServerBuild } from '../../transport/web-fetch-handler';
import { FrontMcpInstance } from '../front-mcp';

@Tool({ name: 'lookup', inputSchema: {} })
class LookupTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

/** Connects to a remote at startup; `refuse` decides whether the remote answers. */
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

const config: FrontMcpConfigInput = {
  info: { name: 'fetch-build-failure', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
};

/** Creates the handler as module code on an edge isolate does; the first request comes after. */
async function createOnEdge(input: FrontMcpConfigInput) {
  const globals = globalThis as Record<string, unknown>;
  globals['EdgeRuntime'] = 'edge-runtime';
  try {
    return await FrontMcpInstance.createFetchHandler(input);
  } finally {
    delete globals['EdgeRuntime'];
  }
}

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
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  return { status: response.status, retryAfter: response.headers.get('retry-after'), body, text };
}

describe('createFetchHandler() on an edge isolate: a server that fails to build', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('answers 503 server_unavailable, waits before building again, and recovers', async () => {
    Object.assign(remote, { refuse: true, connects: 0 });
    const handler = await createOnEdge(config);

    const first = await answer(await handler(initialize()));
    const second = await answer(await handler(initialize()));

    expect(
      [first, second].map(({ status, retryAfter, body }) => ({ status, retryAfter: !!retryAfter, ...body })),
    ).toEqual(
      [first, second].map(() => ({
        status: 503,
        retryAfter: true,
        error: 'server_unavailable',
        code: 'SERVER_START_FAILED',
        message: expect.stringContaining('Retry-After'),
      })),
    );
    // The request refused within the retry delay didn't build the server again.
    expect(remote.connects).toBe(1);
    // The error itself, which names an internal host, is not echoed.
    expect(first.text).not.toContain('secret-host.internal');

    // The remote comes back; the first request after the delay builds the server.
    remote.refuse = false;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const recovered = await handler(initialize());

    expect(recovered.status).toBe(200);
    expect(remote.connects).toBe(2);
  });

  it('answers 500 server_misconfigured with CONFIG_INVALID for a config the schema refuses', async () => {
    const invalid = { ...config, info: { name: 42, version: '1.0.0' } } as unknown as FrontMcpConfigInput;
    const handler = await createOnEdge(invalid);

    const { status, body } = await answer(await handler(initialize()));

    expect({ status, error: body['error'], code: body['code'] }).toEqual({
      status: 500,
      error: 'server_misconfigured',
      code: 'CONFIG_INVALID',
    });
  });
});

describe('createDeferredServerBuild', () => {
  it('keeps a failure for 1 s, doubling to 60 s, and forgets it after a successful build', async () => {
    let clock = 0;
    let fail = true;
    let builds = 0;
    const onFailure = jest.fn();
    const server = createDeferredServerBuild(
      async () => {
        builds++;
        if (fail) throw new Error('down');
        return 'built';
      },
      { now: () => clock, onFailure },
    );
    const settle = (arg: void) =>
      server.get(arg).then(
        (value) => value,
        (error: Error) => `refused: ${error.message}`,
      );

    expect(server.retryAfterSeconds()).toBe(0);
    expect(await settle()).toBe('refused: down');
    expect(server.retryAfterSeconds()).toBe(1);
    clock = 999;
    expect(await settle()).toBe('refused: down');
    expect(builds).toBe(1);

    clock = 1000;
    expect(await settle()).toBe('refused: down');
    expect(builds).toBe(2);
    expect(server.retryAfterSeconds()).toBe(2);

    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      clock += server.retryAfterSeconds() * 1000;
      await settle();
      delays.push(server.retryAfterSeconds());
    }
    expect(delays).toEqual([4, 8, 16, 32, 60, 60, 60, 60]);
    expect(onFailure).toHaveBeenCalledTimes(builds);

    fail = false;
    clock += 60_000;
    expect(await settle()).toBe('built');
    expect(server.retryAfterSeconds()).toBe(0);
    expect(await settle()).toBe('built');
    expect(builds).toBe(11);
  });

  it('shares one build among requests that arrive while it runs', async () => {
    let builds = 0;
    let release: () => void = () => undefined;
    const server = createDeferredServerBuild(async () => {
      builds++;
      await new Promise<void>((resolve) => (release = resolve));
      return 'built';
    });

    const both = Promise.all([server.get(), server.get()]);
    release();

    expect(await both).toEqual(['built', 'built']);
    expect(builds).toBe(1);
  });
});
