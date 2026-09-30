/**
 * Issue #646 — `redis: { provider: 'vercel-kv' }` (or the ambient
 * `KV_REST_API_URL` Vercel injects) made scope startup crash with
 * `TaskStoreNotSupportedError` even though the server never asked for tasks.
 * Vercel KV has no pub/sub, so tasks are skipped with a warning unless the
 * config explicitly enabled them.
 */

import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { App } from '../../common/decorators/app.decorator';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

interface ScopeWithTasks {
  tasks?: unknown;
  dispose(): Promise<void>;
}

const startedScopes: ScopeWithTasks[] = [];

function trackScopes(instance: { getScopes(): unknown[] }): ScopeWithTasks[] {
  const scopes = instance.getScopes() as unknown as ScopeWithTasks[];
  startedScopes.push(...scopes);
  return scopes;
}

describe('Scope task initialization with Vercel KV (#646)', () => {
  const originalKvUrl = process.env['KV_REST_API_URL'];

  afterEach(async () => {
    await Promise.all(startedScopes.splice(0).map((scope) => scope.dispose()));
    if (originalKvUrl === undefined) delete process.env['KV_REST_API_URL'];
    else process.env['KV_REST_API_URL'] = originalKvUrl;
  });

  it('skips tasks instead of crashing when redis.provider is vercel-kv', async () => {
    @App({ id: 'kv-tasks-default', name: 'kv-tasks-default' })
    class KvTasksDefaultApp {}

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'kv-tasks-default', version: '0.0.0' },
      apps: [KvTasksDefaultApp],
      redis: { provider: 'vercel-kv' },
    });

    const [scope] = trackScopes(instance);
    expect(scope).toBeDefined();
    expect(scope.tasks).toBeUndefined();
  });

  it('skips tasks when only the ambient KV_REST_API_URL is present', async () => {
    process.env['KV_REST_API_URL'] = 'https://kv.example.invalid';

    @App({ id: 'kv-tasks-ambient', name: 'kv-tasks-ambient' })
    class KvTasksAmbientApp {}

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'kv-tasks-ambient', version: '0.0.0' },
      apps: [KvTasksAmbientApp],
    });

    const [scope] = trackScopes(instance);
    expect(scope).toBeDefined();
    expect(scope.tasks).toBeUndefined();
  });

  it('skips tasks when Vercel KV is the selected backend even if a top-level sqlite is configured', async () => {
    @App({ id: 'kv-tasks-sqlite', name: 'kv-tasks-sqlite' })
    class KvTasksSqliteApp {}

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'kv-tasks-sqlite', version: '0.0.0' },
      apps: [KvTasksSqliteApp],
      redis: { provider: 'vercel-kv' },
      sqlite: { path: path.join(os.tmpdir(), `kv-tasks-sqlite-${process.pid}.sqlite`) },
    });

    const [scope] = trackScopes(instance);
    expect(scope).toBeDefined();
    expect(scope.tasks).toBeUndefined();
  });

  it('keeps the error when tasks.enabled is explicitly true', async () => {
    @App({ id: 'kv-tasks-explicit', name: 'kv-tasks-explicit' })
    class KvTasksExplicitApp {}

    await expect(
      FrontMcpInstance.createForGraph({
        info: { name: 'kv-tasks-explicit', version: '0.0.0' },
        apps: [KvTasksExplicitApp],
        redis: { provider: 'vercel-kv' },
        tasks: { enabled: true },
      }),
    ).rejects.toThrow(/Vercel KV is not supported for task stores/i);
  });
});
