import 'reflect-metadata';

import { App, LogLevel, Plugin, ScopeEntry, Tool, ToolContext } from '../../common';
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

@Tool({ name: 'noop', inputSchema: {} })
class NoopTool extends ToolContext {
  async execute() {
    return {};
  }
}

@App({ id: 'probe-app', name: 'Probe', tools: [NoopTool] })
class ProbeApp {}

describe('scope.registerHealthProbe()', () => {
  it("adds a plugin's check to /readyz, which answers not ready while it fails", async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'scope-probes', version: '1.0.0' },
      apps: [ProbeApp],
      plugins: [BundleLoaderPlugin],
      logging: { level: LogLevel.Off },
    });
    const scope = instance.getPrimaryScope() as Scope;

    const readiness = await scope.healthService?.getReadyz();

    expect(readiness?.status).toBe('not_ready');
    expect(readiness?.probes?.['bundle-loader']).toEqual({ status: 'unhealthy', error: 'the bundle failed to load' });
  });
});
