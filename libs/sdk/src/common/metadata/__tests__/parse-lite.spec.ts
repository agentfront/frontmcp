/**
 * parseFrontMcpConfigLite — round-trip tests for fields that the CLI/MCPB
 * builds need preserved without forcing the full base-schema validation.
 *
 * Regression: #366 — `authorities` was stripped by the lite schema, which
 * caused `Scope.validateAuthoritiesConfig` to throw `AuthConfigurationError`
 * for any tool that declared `authorities` metadata, breaking every CLI
 * and MCPB build.
 */

import { parseFrontMcpConfigLite } from '../front-mcp.metadata';

// Remote-app form is the easiest valid `apps` entry to construct in a test —
// no decorator metadata required, only the documented fields below.
const minimalApps = [
  {
    name: 'remote-app',
    urlType: 'url',
    url: 'https://example.com',
  },
] as never;

describe('parseFrontMcpConfigLite — preserves CLI-relevant fields', () => {
  it('preserves authorities through the lite schema', () => {
    const input = {
      info: { name: 'demo', version: '0.1.0' },
      apps: minimalApps,
      authorities: {
        claimsMapping: { roles: 'roles', permissions: 'permissions', userId: 'sub' },
        profiles: { admin: { roles: { any: ['admin'] } } },
      },
    };
    const parsed = parseFrontMcpConfigLite(input as never) as unknown as Record<string, unknown>;
    expect(parsed['authorities']).toEqual(input.authorities);
  });

  it('omits authorities when not provided', () => {
    const input = {
      info: { name: 'demo', version: '0.1.0' },
      apps: minimalApps,
    };
    const parsed = parseFrontMcpConfigLite(input as never) as unknown as Record<string, unknown>;
    expect(parsed['authorities']).toBeUndefined();
  });

  it('does not validate the inner shape (pass-through)', () => {
    const input = {
      info: { name: 'demo', version: '0.1.0' },
      apps: minimalApps,
      // Intentionally weird inner shape — lite parse must NOT reject it.
      authorities: { custom: { engine: 'opa', endpoint: 'http://opa' } },
    };
    expect(() => parseFrontMcpConfigLite(input as never)).not.toThrow();
  });

  it('keeps tasks, which the CLI host reads for its store and runner', () => {
    const tasks = { store: false, runner: 'cli', defaultTtlMs: 60_000 };
    const parsed = parseFrontMcpConfigLite({
      info: { name: 'demo', version: '0.1.0' },
      apps: minimalApps,
      tasks,
    } as never);
    expect((parsed as unknown as Record<string, unknown>)['tasks']).toEqual(tasks);
  });

  it('refuses a tasks.store other than false, as the full parser does', () => {
    const input = { info: { name: 'demo', version: '0.1.0' }, apps: minimalApps, tasks: { store: true } };
    expect(() => parseFrontMcpConfigLite(input as never)).toThrow('tasks.store must be false (tasks kept in memory)');
  });
});

describe('parseFrontMcpConfigLite — validates jobs and the top-level sqlite as the server does', () => {
  const parseLite = (options: Record<string, unknown>) =>
    parseFrontMcpConfigLite({ info: { name: 'demo', version: '0.1.0' }, apps: minimalApps, ...options } as never);

  const issuePaths = (options: Record<string, unknown>): string[] => {
    try {
      parseLite(options);
    } catch (error) {
      return (error as { issues: Array<{ path: PropertyKey[] }> }).issues.map((issue) => issue.path.join('.'));
    }
    return [];
  };

  it('keeps jobs, which the CLI host reads for its store, runner and admission', () => {
    const jobs = {
      enabled: true,
      store: false,
      runner: 'worker',
      defaultTimeoutMs: 60_000,
      admission: { concurrency: 2 },
    };
    expect((parseLite({ jobs }) as unknown as Record<string, unknown>)['jobs']).toEqual(jobs);
  });

  it.each([
    [{ store: 'memory' }, 'jobs.store must be false (runs kept in memory) or an object with redis or sqlite'],
    [
      { store: { redis: { provider: 'redis', host: 'localhost' }, sqlite: { path: '/tmp/jobs.sqlite' } } },
      'jobs.store takes redis or sqlite, not both',
    ],
    [{ runner: 'thread' }, "jobs.runner must be 'inline', 'worker' or 'detached'"],
    [{ defaultTimeoutMs: 2_147_483_648 }, 'jobs.defaultTimeoutMs must be at most 2147483647 ms'],
  ])('refuses jobs %j with the message of the full parser', (jobs, message) => {
    expect(() => parseLite({ jobs: { enabled: true, ...jobs } })).toThrow(message);
  });

  it('refuses jobs without enabled, a sqlite store without a path, or an admission limit below 1', () => {
    expect(issuePaths({ jobs: { store: false } })).toEqual(['jobs.enabled']);
    expect(issuePaths({ jobs: { enabled: true, store: { sqlite: { path: '' } } } })).toEqual([
      'jobs.store.sqlite.path',
    ]);
    expect(issuePaths({ jobs: { enabled: true, admission: { concurrency: 0 } } })).toEqual([
      'jobs.admission.concurrency',
    ]);
  });

  it('keeps the top-level sqlite, which the CLI host gives its tasks and jobs', () => {
    expect(
      (parseLite({ sqlite: { path: '/tmp/state.sqlite' } }) as unknown as Record<string, unknown>)['sqlite'],
    ).toEqual(expect.objectContaining({ path: '/tmp/state.sqlite' }));
  });

  it('refuses an empty sqlite.path or a missing encryption secret, which the CLI host took for no path or no encryption', () => {
    expect(issuePaths({ sqlite: { path: '' } })).toEqual(['sqlite.path']);
    expect(issuePaths({ sqlite: { path: '/tmp/state.sqlite', encryption: { secret: undefined } } })).toEqual([
      'sqlite.encryption.secret',
    ]);
  });
});
