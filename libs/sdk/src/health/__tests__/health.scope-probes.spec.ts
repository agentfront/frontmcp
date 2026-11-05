import 'reflect-metadata';

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { App, LogLevel, Plugin, ScopeEntry, Tool, ToolContext, type HealthProbeDefinition } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';

class BundleLoader {
  loaded = false;
}

@Plugin({
  name: 'bundle-loader',
  providers: [
    {
      name: 'bundle-loader:loader',
      provide: BundleLoader,
      inject: () => [ScopeEntry],
      useFactory: (scope: ScopeEntry) => {
        const loader = new BundleLoader();
        scope.registerHealthProbe({
          name: 'bundle-loader',
          check: async () =>
            loader.loaded ? { status: 'healthy' } : { status: 'unhealthy', error: 'the bundle failed to load' },
        });
        return loader;
      },
    },
  ],
})
class BundleLoaderPlugin {}

class ScopeHandle {
  constructor(readonly scope: ScopeEntry) {}
}

const handedOutScopes: ScopeEntry[] = [];

@Plugin({
  name: 'scope-handle',
  providers: [
    {
      name: 'scope-handle:handle',
      provide: ScopeHandle,
      inject: () => [ScopeEntry],
      useFactory: (scope: ScopeEntry) => {
        handedOutScopes.push(scope);
        return new ScopeHandle(scope);
      },
    },
  ],
})
class ScopeHandlePlugin {}

@Tool({ name: 'noop', inputSchema: {} })
class NoopTool extends ToolContext {
  async execute() {
    return {};
  }
}

@App({ id: 'probe-app', name: 'Probe', tools: [NoopTool] })
class ProbeApp {}

@App({ id: 'orders', name: 'Orders', tools: [NoopTool], plugins: [ScopeHandlePlugin] })
class OrdersApp {}

@App({ id: 'billing', name: 'Billing', tools: [NoopTool] })
class BillingApp {}

const FAILED_TO_START: HealthProbeDefinition = {
  name: 'late-feature',
  check: async () => ({ status: 'unhealthy', error: 'the feature failed to start' }),
};

async function readyScope(plugins: Array<typeof BundleLoaderPlugin> = []): Promise<Scope> {
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'scope-probes', version: '1.0.0' },
    apps: [ProbeApp],
    plugins,
    logging: { level: LogLevel.Off },
  });
  return instance.getPrimaryScope() as Scope;
}

async function readiness(scope: Scope) {
  const result = await scope.healthService?.getReadyz();
  if (!result) throw new Error('expected the scope to have a health service');
  return result;
}

describe('scope.registerHealthProbe()', () => {
  it("adds a plugin's check to /readyz, which answers not ready while it fails", async () => {
    const scope = await readyScope([BundleLoaderPlugin]);

    const result = await readiness(scope);

    expect(result.status).toBe('not_ready');
    expect(result.probes?.['bundle-loader']).toEqual({ status: 'unhealthy', error: 'the bundle failed to load' });
  });

  it('runs a check registered after the scope is ready, from the next /readyz on', async () => {
    const scope = await readyScope();
    const before = await readiness(scope);

    scope.registerHealthProbe(FAILED_TO_START);
    const after = await readiness(scope);

    expect(before.status).toBe('ready');
    expect(before.probes).not.toHaveProperty('late-feature');
    expect(after.status).toBe('not_ready');
    expect(after.probes?.['late-feature']).toEqual({ status: 'unhealthy', error: 'the feature failed to start' });
  });

  it('returns a function that removes its own registration, once', async () => {
    const scope = await readyScope();
    const removeFirst = scope.registerHealthProbe(FAILED_TO_START);
    const removeSecond = scope.registerHealthProbe(FAILED_TO_START);

    removeFirst();
    removeFirst();
    const afterFirstRemoved = await readiness(scope);
    removeSecond();
    const afterBothRemoved = await readiness(scope);

    expect(afterFirstRemoved.probes?.['late-feature']).toEqual({
      status: 'unhealthy',
      error: 'the feature failed to start',
    });
    expect(afterBothRemoved.status).toBe('ready');
    expect(afterBothRemoved.probes).not.toHaveProperty('late-feature');
  });

  it('keeps a name registered again after startup twice, as startup does: both run, /readyz shows the later', async () => {
    const scope = await readyScope([BundleLoaderPlugin]);
    const laterCheck = jest.fn(async () => ({ status: 'healthy' as const, details: { registered: 'later' } }));

    const removeLater = scope.registerHealthProbe({ name: 'bundle-loader', check: laterCheck });
    const withBoth = await readiness(scope);
    removeLater();
    const withStartupOnly = await readiness(scope);

    expect(laterCheck).toHaveBeenCalledTimes(1);
    expect(withBoth.status).toBe('not_ready');
    expect(withBoth.probes?.['bundle-loader']).toEqual({ status: 'healthy', details: { registered: 'later' } });
    expect(withStartupOnly.probes?.['bundle-loader']).toEqual({
      status: 'unhealthy',
      error: 'the bundle failed to load',
    });
  });

  it('finishes a running check with the checks it started with', async () => {
    const scope = await readyScope();
    let removeLeaving: () => void = () => undefined;
    scope.registerHealthProbe({
      name: 'changing',
      check: async () => {
        scope.registerHealthProbe({ name: 'arriving', check: async () => ({ status: 'healthy' }) });
        removeLeaving();
        return { status: 'healthy' };
      },
    });
    removeLeaving = scope.registerHealthProbe({ name: 'leaving', check: async () => ({ status: 'healthy' }) });

    const running = await readiness(scope);
    const next = await readiness(scope);

    expect(Object.keys(running.probes ?? {}).sort()).toEqual(['changing', 'leaving', 'session-store']);
    expect(Object.keys(next.probes ?? {}).sort()).toEqual(['arriving', 'changing', 'session-store']);
  });

  describe("on a splitByApp server's /readyz", () => {
    let node: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
      const handler = (await FrontMcpInstance.createHandler({
        info: { name: 'split-probes', version: '1.0.0' },
        apps: [OrdersApp, BillingApp],
        splitByApp: true,
        health: { readyz: { enabled: true }, includeDetails: true },
        logging: { level: LogLevel.Off },
      })) as http.RequestListener;
      node = http.createServer(handler);
      await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        node.close(() => resolve());
        node.closeAllConnections();
      });
    });

    it("runs a check an app's scope registered after the server started", async () => {
      const [ordersScope] = handedOutScopes;
      const before = await fetch(`${baseUrl}/readyz`);
      await before.json();

      const removeProbe = ordersScope.registerHealthProbe(FAILED_TO_START);
      const after = await fetch(`${baseUrl}/readyz`);
      const afterBody = (await after.json()) as { probes?: Record<string, unknown> };
      removeProbe();
      const removed = await fetch(`${baseUrl}/readyz`);
      const removedBody = (await removed.json()) as { probes?: Record<string, unknown> };

      expect(handedOutScopes).toHaveLength(1);
      expect(before.status).toBe(200);
      expect(after.status).toBe(503);
      expect(afterBody.probes?.['late-feature']).toEqual({ status: 'unhealthy', error: 'the feature failed to start' });
      expect(removed.status).toBe(200);
      expect(removedBody.probes).not.toHaveProperty('late-feature');
    });
  });
});
