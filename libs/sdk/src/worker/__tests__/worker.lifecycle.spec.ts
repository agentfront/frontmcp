import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createMemoryStorage, createStorage, resetRuntimeContext, type RootStorage } from '@frontmcp/utils';

import {
  App,
  LogLevel,
  Worker,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
  type WorkerRunContext,
} from '../../common';
import { ClusterScopeNeedsRedisError, ProviderBootstrapError, WorkerNameConflictError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { createContainer, type FrontMcpContainer } from '../../provider/create-container';
import type { Scope } from '../../scope/scope.instance';
import { workerHealth } from '../worker.lifecycle';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, createStorage: jest.fn(actual.createStorage) };
});

const { createStorage: openRealStorage } = jest.requireActual<typeof import('@frontmcp/utils')>('@frontmcp/utils');
const quiet = { level: LogLevel.Off, enableConsole: false };
const info = { name: 'worker-spec' };
const redis = { url: 'redis://cache.internal:6379' };
const LEASE_MS = 3_000;

interface Run {
  worker: object;
  signal: AbortSignal;
}

const runs: Run[] = [];
const ended: object[] = [];

function untilAborted(worker: object, { signal }: WorkerRunContext): Promise<void> {
  runs.push({ worker, signal });
  return new Promise((resolve) =>
    signal.addEventListener('abort', () => {
      ended.push(worker);
      resolve();
    }),
  );
}

@Worker({ name: 'ticker', scope: 'process' })
class ProcessWorker {
  run(context: WorkerRunContext): Promise<void> {
    return untilAborted(this, context);
  }
}

@Worker({ name: 'inbox', scope: 'machine', leaseMs: LEASE_MS })
class MachineWorker {
  run(context: WorkerRunContext): Promise<void> {
    return untilAborted(this, context);
  }
}

@Worker({ name: 'index-project', scope: 'workspace', leaseMs: LEASE_MS })
class WorkspaceWorker {
  run(context: WorkerRunContext): Promise<void> {
    return untilAborted(this, context);
  }
}

@Worker({ name: 'upstream', scope: 'cluster', leaseMs: LEASE_MS })
class ClusterWorker {
  run(context: WorkerRunContext): Promise<void> {
    return untilAborted(this, context);
  }
}

function runsOf(worker: object): Run[] {
  return runs.filter((run) => run.worker === worker);
}

describe('workers in createContainer(), over a store the processes share', () => {
  let home: string;
  let previousHome: string | undefined;
  let open: FrontMcpContainer[];
  let store: RootStorage;

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-workers-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    runs.length = 0;
    ended.length = 0;
    open = [];
    jest.useFakeTimers();
    store = createMemoryStorage({ enableSweeper: false });
    await store.connect();
    jest.spyOn(store, 'disconnect').mockResolvedValue(undefined);
    jest.mocked(createStorage).mockResolvedValue(store);
  });

  afterEach(async () => {
    const disposing = Promise.all(open.map((opened) => opened.dispose()));
    await jest.advanceTimersByTimeAsync(LEASE_MS);
    await disposing;
    jest.mocked(createStorage).mockReset().mockImplementation(openRealStorage);
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function container(options: Parameters<typeof createContainer>[0]): Promise<FrontMcpContainer> {
    const built = await createContainer({ logging: quiet, ...options });
    open.push(built);
    return built;
  }

  async function dispose(built: FrontMcpContainer): Promise<void> {
    open.splice(open.indexOf(built), 1);
    await built.dispose();
  }

  it('builds a worker without starting it, unless the container runs background work', async () => {
    const built = await container({ providers: [ProcessWorker, MachineWorker] });

    await jest.advanceTimersByTimeAsync(2 * LEASE_MS);

    expect(built.get(ProcessWorker)).toBeInstanceOf(ProcessWorker);
    expect(runs).toEqual([]);
    expect(createStorage).not.toHaveBeenCalled();
  });

  it.each(['runBackground', 'runDuties'] as const)('starts the workers of a container with %s', async (option) => {
    const label = { name: 'label', provide: Symbol('label'), useValue: 'mail' };
    const settings = { name: 'settings', provide: Symbol('settings'), useValue: { region: 'eu' } };
    const built = await container({ providers: [label, settings, ProcessWorker], [option]: true, info });

    expect(runsOf(built.get(ProcessWorker))).toHaveLength(1);
    expect(runs[0].signal.aborted).toBe(false);
  });

  it('needs the server name to run background work, since leases are per server name', async () => {
    await expect(createContainer({ providers: [MachineWorker], runBackground: true, logging: quiet })).rejects.toThrow(
      'runBackground needs info.name',
    );
  });

  it('runs a process worker in every process, without a lease', async () => {
    const first = (await container({ providers: [ProcessWorker], runBackground: true, info })).get(ProcessWorker);
    const second = (await container({ providers: [ProcessWorker], runBackground: true, info })).get(ProcessWorker);

    expect(runsOf(first)).toHaveLength(1);
    expect(runsOf(second)).toHaveLength(1);
    expect(createStorage).not.toHaveBeenCalled();
  });

  it('aborts the worker at dispose(), and waits for its run to end', async () => {
    const built = await container({ providers: [ProcessWorker], runBackground: true, info });
    const worker = built.get(ProcessWorker);

    await dispose(built);

    expect(runs[0].signal.aborted).toBe(true);
    expect(ended).toEqual([worker]);
  });

  it('runs a machine worker in one of two processes, and the other takes it over when the first stops', async () => {
    const firstContainer = await container({ providers: [MachineWorker], runBackground: true, info });
    const first = firstContainer.get(MachineWorker);
    const second = (await container({ providers: [MachineWorker], runBackground: true, info })).get(MachineWorker);
    await jest.advanceTimersByTimeAsync(2 * LEASE_MS);

    expect(runsOf(first)).toHaveLength(1);
    expect(runsOf(second)).toEqual([]);

    await dispose(firstContainer);
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3);

    expect(ended).toEqual([first]);
    expect(runsOf(second)).toHaveLength(1);
    expect(runsOf(second)[0].signal.aborted).toBe(false);
  });

  it('aborts the run when the lease is lost, and runs again once it gets the lease back', async () => {
    const worker = (await container({ providers: [MachineWorker], runBackground: true, info })).get(MachineWorker);
    await jest.advanceTimersByTimeAsync(500);

    await store.set('worker-spec:inbox', 'another-process', { ttlSeconds: 3 });
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3);

    expect(runsOf(worker)).toHaveLength(1);
    expect(runsOf(worker)[0].signal.aborted).toBe(true);

    await jest.advanceTimersByTimeAsync(2 * LEASE_MS);

    expect(runsOf(worker)).toHaveLength(2);
    expect(runsOf(worker)[1].signal.aborted).toBe(false);
  });

  it('runs a restart: false worker once, even after it lost the lease and got it back', async () => {
    @Worker({ name: 'once', scope: 'machine', leaseMs: LEASE_MS, restart: false })
    class OnceWorker {
      run({ signal }: WorkerRunContext): void {
        runs.push({ worker: this, signal });
      }
    }
    const worker = (await container({ providers: [OnceWorker], runBackground: true, info })).get(OnceWorker);
    await jest.advanceTimersByTimeAsync(500);
    const holderId = await store.get('worker-spec:once');

    await store.set('worker-spec:once', 'another-process', { ttlSeconds: 3 });
    await jest.advanceTimersByTimeAsync(3 * LEASE_MS);

    expect(await store.get('worker-spec:once')).toBe(holderId);
    expect(runsOf(worker)).toHaveLength(1);
  });

  it('never runs a worker whose lease a check takes while the container shuts down', async () => {
    await store.set('worker-spec:inbox', 'another-process', { ttlSeconds: 3 });
    const built = await container({ providers: [MachineWorker], runBackground: true, info });
    await store.delete('worker-spec:inbox');
    let openStore: () => void = () => undefined;
    const set = store.set.bind(store);
    const gatedSet = jest.spyOn(store, 'set').mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (openStore = resolve));
      return set(...args);
    });
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3);
    expect(gatedSet).toHaveBeenCalled();

    const disposing = dispose(built);
    await jest.advanceTimersByTimeAsync(0);
    openStore();
    await disposing;
    await jest.advanceTimersByTimeAsync(2 * LEASE_MS);

    expect(runs).toEqual([]);
    expect(await store.get('worker-spec:inbox')).toBeNull();
  });

  it('keeps the leases of workers apart from those of duties, per hostname, project root or cluster', async () => {
    await container({ providers: [MachineWorker], runBackground: true, info, redis });
    await container({ providers: [WorkspaceWorker], runBackground: true, info, redis });
    await container({ providers: [ClusterWorker], runBackground: true, info, redis });

    expect(jest.mocked(createStorage).mock.calls.map(([config]) => [config?.type, config?.prefix])).toEqual([
      ['redis', `frontmcp:worker:${os.hostname()}:`],
      ['redis', `frontmcp:worker:${os.hostname()}:`],
      ['redis', 'frontmcp:cluster:worker:'],
    ]);
    const keys = await store.keys('*');
    expect(keys).toContain('worker-spec:inbox');
    expect(keys).toContain('worker-spec:upstream');
    expect(keys.some((key) => /^worker-spec:index-project:[0-9a-f]{64}$/.test(key))).toBe(true);
  });

  it('keeps machine leases in the SQLite file when the server has no Redis', async () => {
    await container({ providers: [MachineWorker], runBackground: true, info });

    expect(jest.mocked(createStorage).mock.calls[0][0]).toEqual({
      type: 'sqlite',
      sqlite: { path: path.join(home, 'duties.sqlite') },
      prefix: 'frontmcp:worker:',
      fallback: 'error',
    });
  });

  it('refuses a cluster worker in a container that runs background work without Redis', async () => {
    const refused = createContainer({ providers: [ClusterWorker], runBackground: true, info, logging: quiet });

    await expect(refused).rejects.toBeInstanceOf(ProviderBootstrapError);
    await expect(refused).rejects.toThrow(
      'Provider "ClusterWorker" failed in onBootstrap(): Worker "upstream" has scope \'cluster\', which keeps one ' +
        'lease for every machine in Redis, and none is configured',
    );
    const failure = await refused.catch((error: ProviderBootstrapError) => error);
    expect((failure as ProviderBootstrapError).originalError).toBeInstanceOf(ClusterScopeNeedsRedisError);
  });

  it('builds a cluster worker without Redis where workers do not start', async () => {
    const built = await container({ providers: [ClusterWorker] });

    expect(built.get(ClusterWorker)).toBeInstanceOf(ClusterWorker);
  });

  it('does not start workers in a serverless deployment', async () => {
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'serverless';
    resetRuntimeContext();
    try {
      await container({ providers: [ProcessWorker, MachineWorker, ClusterWorker], runBackground: true, info });
      await jest.advanceTimersByTimeAsync(2 * LEASE_MS);
    } finally {
      delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
      resetRuntimeContext();
    }

    expect(runs).toEqual([]);
    expect(createStorage).not.toHaveBeenCalled();
  });

  it('refuses a second worker class that would share the lease of another in this process', async () => {
    @Worker({ name: 'shared', scope: 'machine' })
    class FirstShared {
      run(context: WorkerRunContext): Promise<void> {
        return untilAborted(this, context);
      }
    }
    @Worker({ name: 'shared', scope: 'machine' })
    class SecondShared {
      run(context: WorkerRunContext): Promise<void> {
        return untilAborted(this, context);
      }
    }

    await container({ providers: [FirstShared], runBackground: true, info });
    const conflict = createContainer({ providers: [SecondShared], runBackground: true, info, logging: quiet });

    await expect(conflict).rejects.toBeInstanceOf(WorkerNameConflictError);
    await expect(conflict).rejects.toThrow(
      'Worker "shared" of server "worker-spec" is declared by two classes in this process (FirstShared and ' +
        'SecondShared): give one of them its own name with @Worker({ name })',
    );
    const again = (await container({ providers: [FirstShared], runBackground: true, info })).get(FirstShared);
    expect(again).toBeInstanceOf(FirstShared);
  });

  it.each([
    ['process', 'process'],
    ['process', 'machine'],
    ['machine', 'workspace'],
  ] as const)(
    'refuses a second worker class with the name of a %s worker of its server, as a %s worker',
    async (firstScope, secondScope) => {
      @Worker({ name: 'twin', scope: firstScope })
      class FirstTwin {
        run(context: WorkerRunContext): Promise<void> {
          return untilAborted(this, context);
        }
      }
      @Worker({ name: 'twin', scope: secondScope })
      class SecondTwin {
        run(context: WorkerRunContext): Promise<void> {
          return untilAborted(this, context);
        }
      }

      const conflict = container({ providers: [FirstTwin, SecondTwin], runBackground: true, info });

      await expect(conflict).rejects.toBeInstanceOf(WorkerNameConflictError);
      await expect(conflict).rejects.toThrow(
        'Worker "twin" of server "worker-spec" is declared by two classes in this process (FirstTwin and SecondTwin)',
      );
    },
  );

  it("runs the worker's own hooks: onBootstrap() once built, onReady() before run(), onShutdown() after it ended", async () => {
    const phases: string[] = [];
    @Worker({ name: 'hooked', scope: 'process' })
    class HookedWorker implements OnBootstrap, OnReady, OnShutdown {
      onBootstrap(): void {
        phases.push('bootstrap');
      }
      onReady(): void {
        phases.push('ready');
      }
      async run({ signal }: WorkerRunContext): Promise<void> {
        phases.push('run');
        await new Promise((resolve) => signal.addEventListener('abort', resolve));
        phases.push('ended');
      }
      onShutdown(): void {
        phases.push('shutdown');
      }
    }

    const built = await container({ providers: [HookedWorker], runBackground: true, info });
    await dispose(built);

    expect(phases).toEqual(['bootstrap', 'ready', 'run', 'ended', 'shutdown']);
  });

  it('moves on at shutdown when the run does not end within the shutdown timeout', async () => {
    @Worker({ name: 'deaf', scope: 'process' })
    class DeafWorker {
      run(): Promise<void> {
        return new Promise(() => undefined);
      }
    }
    const built = await container({
      providers: [DeafWorker],
      runBackground: true,
      info,
      lifecycle: { shutdownHookTimeoutMs: 200 },
    });

    let disposed = false;
    const disposing = dispose(built).then(() => (disposed = true));
    await jest.advanceTimersByTimeAsync(199);
    expect(disposed).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await disposing;
    expect(disposed).toBe(true);
  });
});

describe('workers in a server', () => {
  const failing = { times: 0 };

  @Worker({ name: 'flaky', scope: 'process', restart: { minDelayMs: 20, maxDelayMs: 40 } })
  class FlakyWorker {
    async run(context: WorkerRunContext): Promise<void> {
      if (failing.times > 0) {
        failing.times--;
        throw new Error('connection refused');
      }
      await untilAborted(this, context);
    }
  }

  @Worker({ name: 'one-shot', scope: 'process', restart: false })
  class OneShotWorker {
    run(): void {
      throw new Error('no such mailbox');
    }
  }

  @App({ name: 'Flaky', providers: [FlakyWorker] })
  class FlakyApp {}

  @App({ name: 'OneShot', providers: [OneShotWorker] })
  class OneShotApp {}

  let instance: FrontMcpInstance | undefined;

  beforeEach(() => {
    runs.length = 0;
    ended.length = 0;
    failing.times = 0;
  });

  afterEach(async () => {
    await instance?.shutdown();
    instance = undefined;
  });

  async function serve(apps: Array<typeof FlakyApp>): Promise<Scope> {
    instance = await FrontMcpInstance.createForGraph({
      info: { name: 'worker-spec', version: '1.0.0' },
      apps,
      logging: quiet,
    });
    return instance.getPrimaryScope() as Scope;
  }

  async function until(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 8_000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('condition not met in time');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it('starts a worker once the server serves, not before, and aborts it at shutdown', async () => {
    const scope = await serve([FlakyApp]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(runs).toEqual([]);
    expect((await scope.healthService?.getReadyz())?.probes).not.toHaveProperty('worker:flaky');

    await instance?.emitProvidersReady();
    await until(() => runs.length === 1);
    expect(runs[0].signal.aborted).toBe(false);

    await instance?.shutdown();
    instance = undefined;
    expect(runs[0].signal.aborted).toBe(true);
    expect(ended).toHaveLength(1);
  });

  it('runs only the first of two process workers of a server that share a name, and reports the second', async () => {
    @Worker({ name: 'flaky', scope: 'process' })
    class SecondFlaky {
      run(context: WorkerRunContext): Promise<void> {
        return untilAborted(this, context);
      }
    }
    @App({ name: 'Twins', providers: [FlakyWorker, SecondFlaky] })
    class TwinsApp {}

    const scope = await serve([TwinsApp]);
    await instance?.emitProvidersReady();
    const failures = await scope.providers.runReadyHooks(scope.logger);

    expect(failures).toEqual([expect.any(WorkerNameConflictError)]);
    expect(runs.map((run) => run.worker.constructor.name)).toEqual(['FlakyWorker']);
  });

  it('shows a running worker in /readyz as healthy, with its restarts and last error', async () => {
    failing.times = 2;
    const scope = await serve([FlakyApp]);
    await instance?.emitProvidersReady();
    await until(() => runs.length === 1);

    const readyz = await scope.healthService?.getReadyz();

    expect(readyz?.status).toBe('ready');
    expect(readyz?.probes?.['worker:flaky']).toEqual({
      status: 'healthy',
      details: { state: 'running', restarts: 2, lastError: 'connection refused' },
    });
  });

  it('shows a leased worker as unhealthy while its lease store cannot be opened, and runs it once the store opens', async () => {
    @Worker({ name: 'leased', scope: 'machine', leaseMs: 1_000 })
    class LeasedWorker {
      run(context: WorkerRunContext): Promise<void> {
        return untilAborted(this, context);
      }
    }
    @App({ name: 'Leased', providers: [LeasedWorker] })
    class LeasedApp {}
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-workers-'));
    const previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    const store = createMemoryStorage({ enableSweeper: false });
    await store.connect();
    let leaseStoreOpens = 0;
    jest.mocked(createStorage).mockImplementation(async (config) => {
      if (config?.prefix !== 'frontmcp:worker:') return openRealStorage(config);
      leaseStoreOpens++;
      if (leaseStoreOpens === 1) throw new Error('database is locked');
      return store;
    });
    try {
      const scope = await serve([LeasedApp]);
      await instance?.emitProvidersReady();

      expect((await scope.healthService?.getReadyz())?.probes?.['worker:leased']).toEqual({
        status: 'unhealthy',
        details: { state: 'standby', restarts: 0 },
        error: 'the lease store cannot be opened: database is locked',
      });

      await until(() => runs.length === 1);
      expect((await scope.healthService?.getReadyz())?.probes?.['worker:leased']).toEqual({
        status: 'healthy',
        details: { state: 'running', restarts: 0 },
      });
      expect(leaseStoreOpens).toBe(2);
    } finally {
      await instance?.shutdown();
      instance = undefined;
      jest.mocked(createStorage).mockReset().mockImplementation(openRealStorage);
      if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
      else process.env['FRONTMCP_HOME'] = previousHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('answers not ready once a restart: false worker ended on an error, and takes the check away at shutdown', async () => {
    const scope = await serve([OneShotApp]);
    await instance?.emitProvidersReady();

    const readyz = await scope.healthService?.getReadyz();

    expect(readyz?.status).toBe('not_ready');
    expect(readyz?.probes?.['worker:one-shot']).toEqual({
      status: 'unhealthy',
      details: { state: 'stopped', restarts: 0, lastError: 'no such mailbox' },
      error: 'no such mailbox',
    });

    await instance?.shutdown();
    instance = undefined;
    expect(scope.healthProbes).toEqual([]);
  });
});

describe('workerHealth', () => {
  it.each([
    [{ state: 'running', restarts: 0 }, { status: 'healthy' }],
    [{ state: 'standby', restarts: 0 }, { status: 'healthy' }],
    [{ state: 'running', restarts: 3, lastError: 'dropped' }, { status: 'healthy' }],
    [
      { state: 'restarting', restarts: 1, lastError: 'dropped' },
      { status: 'degraded', error: 'dropped' },
    ],
    [{ state: 'restarting', restarts: 1 }, { status: 'degraded' }],
    [
      { state: 'stopped', restarts: 0, lastError: 'no such mailbox' },
      { status: 'unhealthy', error: 'no such mailbox' },
    ],
    [{ state: 'stopped', restarts: 0 }, { status: 'healthy' }],
  ] as const)('reports %j as %j, with the status as details', (status, expected) => {
    expect(workerHealth(status)).toEqual({ ...expected, details: status });
  });

  it('reports a worker whose lease store cannot be opened as unhealthy, whatever its state', () => {
    const status = { state: 'standby', restarts: 0 } as const;

    expect(workerHealth(status, 'database is locked')).toEqual({
      status: 'unhealthy',
      details: status,
      error: 'the lease store cannot be opened: database is locked',
    });
  });
});
