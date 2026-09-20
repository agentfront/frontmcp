/**
 * Issue #538 — background tasks were opt-OUT, so a server that never declared
 * a task still ran `createTaskStore()` during scope initialization. On an edge
 * runtime that call refuses any non-distributed store and throws, and because
 * scope init runs per request, a default `frontmcp create --target cloudflare`
 * worker answered HTTP 500 to every request — `/healthz` included.
 */

import 'reflect-metadata';

import { App } from '../../common/decorators/app.decorator';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

interface ScopeWithTasks {
  tasks?: unknown;
  dispose(): Promise<void>;
}

/** Scopes started by a test, disposed in afterEach so no cleanup timer leaks. */
const startedScopes: ScopeWithTasks[] = [];

function trackScopes(instance: { getScopes(): unknown[] }): ScopeWithTasks[] {
  const scopes = instance.getScopes() as unknown as ScopeWithTasks[];
  startedScopes.push(...scopes);
  return scopes;
}

/**
 * `isEdgeRuntime()` returns true as soon as `EdgeRuntime` is a global, which is
 * the cheapest way to put a unit test on the Workers code path.
 */
function withEdgeRuntime<T>(run: () => Promise<T>): Promise<T> {
  const globals = globalThis as Record<string, unknown>;
  const had = 'EdgeRuntime' in globals;
  const previous = globals['EdgeRuntime'];
  globals['EdgeRuntime'] = 'test';
  return run().finally(() => {
    if (had) globals['EdgeRuntime'] = previous;
    else delete globals['EdgeRuntime'];
  });
}

describe('Scope task initialization on an edge runtime (#538)', () => {
  afterEach(async () => {
    // A built scope's ProviderRegistry holds a session-cleanup interval.
    await Promise.all(startedScopes.splice(0).map((scope) => scope.dispose()));
  });

  it('serves without tasks when none were configured, instead of failing the whole scope', async () => {
    @App({ id: 'edge-tasks-default', name: 'edge-tasks-default' })
    class EdgeTasksDefaultApp {}

    const instance = await withEdgeRuntime(() =>
      FrontMcpInstance.createForGraph({
        info: { name: 'edge-tasks-default', version: '0.0.0' },
        apps: [EdgeTasksDefaultApp],
      }),
    );

    const [scope] = trackScopes(instance);
    expect(scope).toBeDefined();
    expect(scope.tasks).toBeUndefined();
  });

  it('still refuses an explicit tasks.enabled without a distributed store', async () => {
    @App({ id: 'edge-tasks-explicit', name: 'edge-tasks-explicit' })
    class EdgeTasksExplicitApp {}

    await expect(
      withEdgeRuntime(() =>
        FrontMcpInstance.createForGraph({
          info: { name: 'edge-tasks-explicit', version: '0.0.0' },
          apps: [EdgeTasksExplicitApp],
          tasks: { enabled: true },
        }),
      ),
    ).rejects.toThrow(/distributed storage on Edge runtime/i);
  });

  it('leaves tasks enabled on a long-lived Node process', async () => {
    @App({ id: 'node-tasks-default', name: 'node-tasks-default' })
    class NodeTasksDefaultApp {}

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'node-tasks-default', version: '0.0.0' },
      apps: [NodeTasksDefaultApp],
    });

    const [scope] = trackScopes(instance);
    expect(scope.tasks).toBeDefined();
  });
});
