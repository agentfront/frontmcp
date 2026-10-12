/**
 * A disposed server can be collected (#821): `dispose()` stops every interval the server started (the
 * provider registries' session cleanup, the in-memory auth stores, the task store's and the auth
 * layer's storage sweepers), and a `Plugin.init()` record keeps no reference to the server that
 * installed it.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import { mkdtemp, rm } from '@frontmcp/utils';

import {
  App,
  DynamicPlugin,
  frontMcpMetadataSchema,
  Job,
  JobContext,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Tool,
  ToolContext,
  Workflow,
  type LogRecord,
  type PluginType,
} from '../../common';
import { create } from '../../direct/create';
import { Scope } from '../../scope/scope.instance';
import { FrontMcpInstance } from '../front-mcp';
import { DEFAULT_SHUTDOWN_DEADLINE_MS } from '../shutdown-signals';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@Job({ name: 'count', inputSchema: {}, outputSchema: { counted: z.boolean() } })
class CountJob extends JobContext {
  async execute() {
    return { counted: true };
  }
}

@Workflow({ name: 'count-flow', steps: [{ id: 'count', jobName: 'count' }] })
class CountFlow {}

@Plugin({ name: 'counter' })
class CounterPlugin extends DynamicPlugin<{ start: number }> {
  constructor(readonly options: { start: number }) {
    super();
  }
}

type IntervalHandle = Parameters<typeof clearInterval>[0];

/** Where each interval started while `run` ran, for the ones still running when it returned. */
async function intervalsLeftRunning(run: () => Promise<void>): Promise<string[]> {
  const running = new Map<IntervalHandle, string>();
  const nativeSetInterval = globalThis.setInterval;
  const nativeClearInterval = globalThis.clearInterval;
  globalThis.setInterval = ((handler: () => void, ms?: number, ...args: unknown[]) => {
    const timer = nativeSetInterval(handler, ms, ...args);
    running.set(timer, (new Error().stack ?? '').split('\n').slice(2, 5).join(' <-'));
    return timer;
  }) as typeof setInterval;
  globalThis.clearInterval = ((timer?: IntervalHandle) => {
    running.delete(timer);
    nativeClearInterval(timer);
  }) as typeof clearInterval;
  try {
    await run();
  } finally {
    globalThis.setInterval = nativeSetInterval;
    globalThis.clearInterval = nativeClearInterval;
    for (const timer of running.keys()) nativeClearInterval(timer);
  }
  return [...running.values()];
}

async function serveHelpDesk(options: Record<string, unknown> = {}, plugins: PluginType[] = []) {
  @App({ id: 'help-desk', name: 'Help Desk', tools: [PingTool], jobs: [CountJob], workflows: [CountFlow], plugins })
  class HelpDeskApp {}
  return FrontMcpInstance.createDirect({
    info: { name: 'help-desk', version: '1.0.0' },
    apps: [HelpDeskApp],
    logging: { level: LogLevel.Off },
    ...options,
  });
}

describe('dispose() releases the server (#821)', () => {
  it.each([
    ['a public server with an app plugin, jobs and a workflow', {}],
    ['a server in local auth mode (credential vault and secure store)', { auth: { mode: 'local' } }],
  ])('stops every interval started by %s', async (_label, options) => {
    const left = await intervalsLeftRunning(async () => {
      const server = await serveHelpDesk(options, [CounterPlugin.init({ start: 1 })]);
      await server.listTools();
      await server.callTool('execute_job', { name: 'count' });
      await server.dispose();
    });

    expect(left).toEqual([]);
  });

  it('stops the in-memory auth stores once persistent token storage replaces them', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-dispose-'));
    let server: Awaited<ReturnType<typeof serveHelpDesk>> | undefined;
    try {
      const leftWhileServing = await intervalsLeftRunning(async () => {
        server = await serveHelpDesk({
          auth: { mode: 'local', tokenStorage: { sqlite: { path: path.join(directory, 'tokens.sqlite') } } },
        });
      });

      expect(
        leftWhileServing.filter((startedAt) => /federated-auth\.session|orchestrated-token\.store/.test(startedAt)),
      ).toEqual([]);
    } finally {
      await server?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stops every interval a create() server started', async () => {
    const left = await intervalsLeftRunning(async () => {
      const server = await create({
        info: { name: 'help-desk', version: '1.0.0' },
        tools: [PingTool],
        logging: { level: LogLevel.Off },
      });
      await server.callTool('ping', {});
      await server.dispose();
    });

    expect(left).toEqual([]);
  });

  it("leaves no reference to the disposed server on a Plugin.init() record's instance", async () => {
    const record = CounterPlugin.init({ start: 1 });

    const first = await serveHelpDesk({}, [record]);
    await first.dispose();
    expect(Object.prototype.hasOwnProperty.call((record as { useValue: object }).useValue, 'get')).toBe(false);

    const second = await serveHelpDesk({}, [record]);
    await expect(second.listTools()).resolves.toEqual(expect.objectContaining({ tools: expect.any(Array) }));
    await second.dispose();
    expect(Object.prototype.hasOwnProperty.call((record as { useValue: object }).useValue, 'get')).toBe(false);
  });
});

@App({ id: 'locked-desk', name: 'Locked Desk', tools: [PingTool] })
class LockedDeskApp {}

/** Local auth in production without a JWT_SECRET: the scope starts building, then fails (JWT_SECRET_REQUIRED). */
const unstartableConfig = {
  info: { name: 'locked-desk', version: '1.0.0' },
  apps: [LockedDeskApp],
  auth: { mode: 'local' as const },
  logging: { level: LogLevel.Off },
};

const loggedErrors: string[] = [];

@LogTransport({ name: 'ReleaseErrorCapture', description: 'Keeps the error logs for assertions' })
class ErrorCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Error) loggedErrors.push(record.message);
  }
}

const mcpRequest = () =>
  new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

describe('a server that fails to start releases what it built', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalJwtSecret = process.env['JWT_SECRET'];

  beforeEach(() => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['JWT_SECRET'];
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
    if (originalJwtSecret === undefined) delete process.env['JWT_SECRET'];
    else process.env['JWT_SECRET'] = originalJwtSecret;
  });

  it.each([
    ['createDirect()', () => FrontMcpInstance.createDirect(unstartableConfig)],
    ['createForGraph()', () => FrontMcpInstance.createForGraph(unstartableConfig)],
    ['createForCli()', () => FrontMcpInstance.createForCli(unstartableConfig)],
    ['createFetchHandler()', () => FrontMcpInstance.createFetchHandler(unstartableConfig)],
  ])('%s disposes the scope that failed and leaves no interval running', async (_label, start) => {
    const dispose = jest.spyOn(Scope.prototype, 'dispose');

    const left = await intervalsLeftRunning(async () => {
      await expect(start()).rejects.toMatchObject({ code: 'JWT_SECRET_REQUIRED' });
    });

    expect(left).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('releases each failed deferred build on an edge runtime before the next one', async () => {
    const startedAt = Date.now();
    let minutesLater = 0;
    // Each request comes after the retry delay, so each one builds the server again.
    jest.spyOn(Date, 'now').mockImplementation(() => startedAt + minutesLater * 60_000);
    const build = jest.spyOn(FrontMcpInstance.prototype, 'initialize');
    const globals = globalThis as Record<string, unknown>;
    globals['EdgeRuntime'] = 'edge-runtime';
    let handler: Awaited<ReturnType<typeof FrontMcpInstance.createFetchHandler>>;
    try {
      handler = await FrontMcpInstance.createFetchHandler(unstartableConfig);
    } finally {
      delete globals['EdgeRuntime'];
    }

    const left = await intervalsLeftRunning(async () => {
      for (minutesLater of [0, 5, 10]) {
        const response = await handler(mcpRequest());
        expect(response.status).toBe(500);
      }
    });

    expect(build).toHaveBeenCalledTimes(3);
    expect(left).toEqual([]);
  });

  it('fails with the startup error once the shutdown deadline passes, when releasing never settles', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    let releasing = false;
    jest.spyOn(Scope.prototype, 'dispose').mockImplementation(() => {
      releasing = true;
      return new Promise<void>(() => undefined);
    });
    loggedErrors.length = 0;
    let outcome: unknown;
    void FrontMcpInstance.createDirect({ ...unstartableConfig, logging: { transports: [ErrorCapture] } }).catch(
      (error: unknown) => {
        outcome = error;
      },
    );
    while (!releasing) await new Promise((resolve) => setImmediate(resolve));

    await jest.advanceTimersByTimeAsync(DEFAULT_SHUTDOWN_DEADLINE_MS - 1);
    expect(outcome).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);

    expect(outcome).toMatchObject({ code: 'JWT_SECRET_REQUIRED' });
    expect(loggedErrors).toContain(
      `Releasing a server that failed to start did not finish within ${DEFAULT_SHUTDOWN_DEADLINE_MS} ms`,
    );
  });

  it('disposes the failed scope when shutdown() was called while the start was still running', async () => {
    const dispose = jest.spyOn(Scope.prototype, 'dispose');

    const left = await intervalsLeftRunning(async () => {
      const instance = new FrontMcpInstance(frontMcpMetadataSchema.parse(unstartableConfig));
      const shutdown = instance.shutdown();
      await expect(instance.ready).rejects.toMatchObject({ code: 'JWT_SECRET_REQUIRED' });
      await shutdown.catch(() => undefined);
    });

    expect(left).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects with the startup error when releasing the partial server fails too, and logs that failure', async () => {
    const dispose = jest.spyOn(Scope.prototype, 'dispose').mockRejectedValue(new Error('dispose failed'));
    loggedErrors.length = 0;

    await expect(
      FrontMcpInstance.createDirect({ ...unstartableConfig, logging: { transports: [ErrorCapture] } }),
    ).rejects.toMatchObject({ code: 'JWT_SECRET_REQUIRED' });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(loggedErrors).toContain('Graceful shutdown: scope dispose failed');
  });
});
