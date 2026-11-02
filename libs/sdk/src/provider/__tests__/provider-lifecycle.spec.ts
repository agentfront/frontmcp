import 'reflect-metadata';

import { Provider, ProviderScope, type OnBootstrap, type OnReady, type OnShutdown } from '../../common';
import { ProviderBootstrapError } from '../../errors';
import ProviderRegistry from '../provider.registry';

function silentLogger() {
  return { warn: jest.fn(), error: jest.fn() };
}

describe('Provider lifecycle hooks', () => {
  let phases: string[];

  beforeEach(() => {
    phases = [];
  });

  function recordingProvider(name: string) {
    @Provider({ name })
    class Recording implements OnBootstrap, OnReady, OnShutdown {
      constructor() {
        phases.push(`construct:${name}`);
      }
      async onBootstrap() {
        phases.push(`bootstrap:${name}`);
      }
      onReady() {
        phases.push(`ready:${name}`);
      }
      async onShutdown() {
        phases.push(`shutdown:${name}`);
      }
    }
    return Recording;
  }

  it('bootstraps each provider after its dependencies, before its dependents are built', async () => {
    const Store = recordingProvider('store');

    @Provider({ name: 'repo' })
    class Repo implements OnBootstrap {
      constructor(readonly store: InstanceType<typeof Store>) {
        phases.push('construct:repo');
      }
      onBootstrap() {
        phases.push('bootstrap:repo');
      }
    }
    Reflect.defineMetadata('design:paramtypes', [Store], Repo);

    const registry = new ProviderRegistry([Repo, Store]);
    await registry.ready;

    expect(phases).toEqual(['construct:store', 'bootstrap:store', 'construct:repo', 'bootstrap:repo']);
  });

  it('runs onReady in build order down the registry tree, once', async () => {
    const parent = new ProviderRegistry([recordingProvider('server')]);
    await parent.ready;
    const child = new ProviderRegistry([recordingProvider('app')], parent);
    await child.ready;
    phases = [];

    await parent.runReadyHooks(silentLogger());
    await parent.runReadyHooks(silentLogger());

    expect(phases).toEqual(['ready:server', 'ready:app']);
    child.dispose();
  });

  it('makes a caller that arrives during a run wait for that run to finish', async () => {
    let finishReady: () => void = () => undefined;
    let finishShutdown: () => void = () => undefined;
    @Provider({ name: 'slow' })
    class Slow implements OnReady, OnShutdown {
      onReady() {
        return new Promise<void>((resolve) => (finishReady = resolve));
      }
      onShutdown() {
        return new Promise<void>((resolve) => (finishShutdown = resolve));
      }
    }
    const registry = new ProviderRegistry([Slow]);
    await registry.ready;
    const settled: string[] = [];

    void registry.runReadyHooks(silentLogger()).then(() => settled.push('first ready'));
    const secondReady = registry.runReadyHooks(silentLogger()).then(() => settled.push('second ready'));
    await Promise.resolve();
    expect(settled).toEqual([]);
    finishReady();
    await secondReady;

    void registry.runShutdownHooks(silentLogger()).then(() => settled.push('first shutdown'));
    const secondShutdown = registry.runShutdownHooks(silentLogger()).then(() => settled.push('second shutdown'));
    await Promise.resolve();
    expect(settled).toEqual(['first ready', 'second ready']);
    finishShutdown();
    await secondShutdown;

    expect(settled).toEqual(['first ready', 'second ready', 'first shutdown', 'second shutdown']);
  });

  it('runs onShutdown in reverse order, the registries below first, once', async () => {
    const parent = new ProviderRegistry([recordingProvider('config'), recordingProvider('pool')]);
    await parent.ready;
    const child = new ProviderRegistry([recordingProvider('cache')], parent);
    await child.ready;
    phases = [];

    await parent.runShutdownHooks(silentLogger());
    await parent.runShutdownHooks(silentLogger());

    expect(phases).toEqual(['shutdown:cache', 'shutdown:pool', 'shutdown:config']);
    child.dispose();
  });

  it('calls the hooks of a factory value and of a value registered twice only once', async () => {
    const POOL = Symbol('POOL');
    const CONFIG = Symbol('CONFIG');
    const config = {
      onBootstrap: () => void phases.push('bootstrap:config'),
      onShutdown: () => void phases.push('shutdown:config'),
    };
    const parent = new ProviderRegistry([
      { name: 'config', provide: CONFIG, useValue: config },
      {
        name: 'pool',
        provide: POOL,
        useFactory: async () => ({
          onBootstrap: () => void phases.push('bootstrap:pool'),
          onShutdown: () => void phases.push('shutdown:pool'),
        }),
      },
    ]);
    await parent.ready;
    const child = new ProviderRegistry([{ name: 'config', provide: CONFIG, useValue: config }], parent);
    await child.ready;

    await parent.runShutdownHooks(silentLogger());

    expect(phases).toEqual(['bootstrap:config', 'bootstrap:pool', 'shutdown:pool', 'shutdown:config']);
    child.dispose();
  });

  it('shuts a value registered under two tokens of one registry down after the providers that depend on it', async () => {
    const POOL = Symbol('POOL');
    const REPO = Symbol('REPO');
    const POOL_ALIAS = Symbol('POOL_ALIAS');
    const pool = { onShutdown: () => void phases.push('shutdown:pool') };
    const registry = new ProviderRegistry([
      { name: 'pool', provide: POOL, useValue: pool },
      {
        name: 'repo',
        provide: REPO,
        inject: () => [POOL] as const,
        useFactory: () => ({ onShutdown: () => void phases.push('shutdown:repo') }),
      },
      { name: 'pool-alias', provide: POOL_ALIAS, useValue: pool },
    ]);
    await registry.ready;

    await registry.runShutdownHooks(silentLogger());

    expect(phases).toEqual(['shutdown:repo', 'shutdown:pool']);
  });

  it('ignores values without hooks and CONTEXT-scoped providers', async () => {
    @Provider({ name: 'per-request', scope: ProviderScope.CONTEXT })
    class PerRequest implements OnBootstrap {
      onBootstrap() {
        phases.push('bootstrap:per-request');
      }
    }
    const registry = new ProviderRegistry([PerRequest, { name: 'label', provide: Symbol('LABEL'), useValue: 'text' }]);
    await registry.ready;
    await registry.buildViews('lifecycle-session');

    await registry.runReadyHooks(silentLogger());
    await registry.runShutdownHooks(silentLogger());

    expect(phases).toEqual([]);
  });

  it('fails the build with ProviderBootstrapError naming the provider whose onBootstrap() threw', async () => {
    @Provider({ name: 'broken' })
    class Broken implements OnBootstrap {
      onBootstrap() {
        throw new Error('database unreachable');
      }
    }

    const registry = new ProviderRegistry([Broken]);
    const failure = await registry.ready.then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ProviderBootstrapError);
    expect(failure).toMatchObject({
      code: 'PROVIDER_BOOTSTRAP_FAILED',
      message: 'Provider "Broken" failed in onBootstrap(): database unreachable',
    });
    expect((failure as ProviderBootstrapError).originalError?.message).toBe('database unreachable');
  });

  it('shuts down the providers that bootstrapped before one failed, not the one that failed', async () => {
    const Config = recordingProvider('config');

    @Provider({ name: 'broken' })
    class Broken implements OnBootstrap, OnShutdown {
      onBootstrap() {
        throw 'refused';
      }
      onShutdown() {
        phases.push('shutdown:broken');
      }
    }

    const registry = new ProviderRegistry([Config, Broken]);
    await expect(registry.ready).rejects.toThrow('Provider "Broken" failed in onBootstrap(): refused');
    await registry.runShutdownHooks(silentLogger());

    expect(phases).toEqual(['construct:config', 'bootstrap:config', 'shutdown:config']);
  });

  it('logs an onReady() failure and still readies the other providers', async () => {
    @Provider({ name: 'flaky' })
    class Flaky implements OnReady {
      onReady() {
        throw new Error('no peers');
      }
    }
    const registry = new ProviderRegistry([Flaky, recordingProvider('steady')]);
    await registry.ready;
    const logger = silentLogger();

    await registry.runReadyHooks(logger);

    expect(phases).toContain('ready:steady');
    expect(logger.error).toHaveBeenCalledWith('Provider "Flaky" failed in onReady(): no peers');
  });

  it('logs an onShutdown() failure and a timeout, and moves on to the next provider', async () => {
    @Provider({ name: 'hung' })
    class Hung implements OnShutdown {
      onShutdown() {
        return new Promise<void>(() => undefined);
      }
    }
    @Provider({ name: 'failing' })
    class Failing implements OnShutdown {
      async onShutdown() {
        throw 'already closed';
      }
    }
    const registry = new ProviderRegistry([recordingProvider('first'), Failing, Hung], undefined, {
      shutdownHookTimeoutMs: 20,
    });
    await registry.ready;
    const logger = silentLogger();

    const started = Date.now();
    await registry.runShutdownHooks(logger);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(logger.warn).toHaveBeenCalledWith('Provider "Hung" onShutdown() did not finish within 20 ms');
    expect(logger.warn).toHaveBeenCalledWith('Provider "Failing" failed in onShutdown(): already closed');
    expect(phases).toContain('shutdown:first');
  });

  it("applies the parent's shutdown hook timeout to the registries below it", async () => {
    @Provider({ name: 'hung' })
    class Hung implements OnShutdown {
      onShutdown() {
        return new Promise<void>(() => undefined);
      }
    }
    const parent = new ProviderRegistry([], undefined, { shutdownHookTimeoutMs: 15 });
    await parent.ready;
    const child = new ProviderRegistry([Hung], parent);
    await child.ready;
    const logger = silentLogger();

    await parent.runShutdownHooks(logger);

    expect(logger.warn).toHaveBeenCalledWith('Provider "Hung" onShutdown() did not finish within 15 ms');
    child.dispose();
  });

  it('bootstraps the providers a plugin adds at runtime', async () => {
    const registry = new ProviderRegistry([]);
    await registry.ready;

    await registry.addDynamicProviders([recordingProvider('dynamic')]);
    await registry.runShutdownHooks(silentLogger());

    expect(phases).toEqual(['construct:dynamic', 'bootstrap:dynamic', 'shutdown:dynamic']);
  });
});
