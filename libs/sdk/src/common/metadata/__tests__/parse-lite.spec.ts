/**
 * parseFrontMcpConfigLite — round-trip tests for fields that the CLI/MCPB
 * builds need preserved without forcing the full base-schema validation.
 *
 * Regression: #366 — `authorities` was stripped by the lite schema, which
 * caused `Scope.validateAuthoritiesConfig` to throw `AuthConfigurationError`
 * for any tool that declared `authorities` metadata, breaking every CLI
 * and MCPB build.
 */

import { transportOptionsSchema } from '../../types/options/transport/schema';
import { frontMcpBaseSchema, parseFrontMcpConfigLite } from '../front-mcp.metadata';

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

  it('keeps keys the server schema does not know (pass-through)', () => {
    const input = {
      info: { name: 'demo', version: '0.1.0' },
      apps: minimalApps,
      authorities: { custom: { engine: 'opa', endpoint: 'http://opa' } },
    };
    const parsed = parseFrontMcpConfigLite(input as never) as unknown as Record<string, unknown>;
    expect(parsed['authorities']).toBe(input.authorities);
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

describe('parseFrontMcpConfigLite — normalizes the top-level redis as the server does (#1035)', () => {
  const parseLite = (redis: unknown) =>
    (
      parseFrontMcpConfigLite({
        info: { name: 'demo', version: '0.1.0' },
        apps: minimalApps,
        redis,
      } as never) as unknown as Record<string, unknown>
    )['redis'];

  it.each([
    [
      { url: 'redis://:secret@cache.internal:6380/2' },
      { provider: 'redis', host: 'cache.internal', port: 6380, password: 'secret', db: 2, tls: false },
    ],
    [{ url: 'rediss://cache.internal' }, { provider: 'redis', host: 'cache.internal', port: 6379, db: 0, tls: true }],
    [{ host: 'cache.internal' }, { provider: 'redis', host: 'cache.internal', port: 6379, db: 0, tls: false }],
  ])('reads %j into the connection fields every store takes', (redis, connection) => {
    expect(parseLite(redis)).toEqual(expect.objectContaining(connection));
  });

  it('refuses an unusable redis with the message of the full parser', () => {
    expect(() => parseLite({ url: 'http://cache.internal:6379' })).toThrow(
      'redis.url must use the redis:// or rediss:// scheme',
    );
  });
});

describe('parseFrontMcpConfigLite — validates every key the server validates', () => {
  const base = { info: { name: 'demo', version: '0.1.0' }, apps: minimalApps };
  const parseLite = (options: Record<string, unknown>) =>
    parseFrontMcpConfigLite({ ...base, ...options } as never) as unknown as Record<string, unknown>;

  const issuesOf = (parse: () => unknown): unknown[] => {
    try {
      parse();
    } catch (error) {
      return (error as { issues: unknown[] }).issues;
    }
    return [];
  };

  const invalid: Array<[string, unknown]> = [
    ['http', { port: '4100' }],
    ['pubsub', { port: 6379 }],
    ['transport', { protocol: 'grpc' }],
    ['transport', { persistence: { sqlite: { path: '' } } }],
    ['transport', { persistence: { sqlite: { path: '/tmp/s.sqlite', encryption: { secret: undefined } } } }],
    ['pagination', { tools: { pageSize: 0 } }],
    ['fetch', { forwardCallerTokenTo: ['ftp://files.example.com'] }],
    ['elicitation', { store: true }],
    ['extApps', { enabled: 'yes' }],
    ['ui', { servingMode: 'bogus' }],
    ['throttle', { storage: {} }],
    ['health', { readyz: { timeoutMs: 0 } }],
    ['metrics', { format: 'xml' }],
    ['authorities', { claimsMapping: { roles: 5 } }],
    ['session', { sessionMode: 'sometimes' }],
    ['clients', { '': {} }],
    ['observability', 'yes'],
    ['registry', { name: 'weather' }],
    ['channels', { enabled: 'yes' }],
  ];

  it.each(invalid)('refuses an invalid %s (%j) with the issues of the server', (key, value) => {
    const serverIssues = issuesOf(() => frontMcpBaseSchema.parse({ ...base, [key]: value }));

    expect(serverIssues).not.toEqual([]);
    expect(issuesOf(() => parseLite({ [key]: value }))).toEqual(serverIssues);
  });

  const kept: Array<[string, unknown]> = [
    ['http', { port: 4100 }],
    ['pubsub', { url: 'redis://cache.internal:6380' }],
    ['transport', { persistence: { redis: { host: 'cache.internal' } } }],
    ['pagination', { tools: { pageSize: 10 } }],
    ['fetch', { forwardCallerTokenTo: ['https://api.example.com/v1'] }],
    ['elicitation', { enabled: true }],
    ['extApps', { enabled: false }],
    ['ui', { escapeStringResults: true }],
    ['throttle', { enabled: true, storage: { type: 'memory' } }],
    ['health', { enabled: false }],
    ['metrics', { enabled: true }],
    ['authorities', { claimsMapping: { roles: 'roles' }, custom: { engine: 'opa' } }],
  ];

  it.each(kept)('keeps a valid %s as given, without the defaults of the server', (key, value) => {
    expect(parseLite({ [key]: value })[key]).toBe(value);
  });

  it('gives an unset transport the defaults of the server, as before', () => {
    expect(parseLite({})['transport']).toEqual(transportOptionsSchema.parse({}));
  });

  it.each([
    ['session', { sessionMode: 'stateful' }],
    ['clients', { 'codex*': { structured: 'only' } }],
    ['observability', true],
    ['registry', { name: 'com.acme/weather', description: 'Weather' }],
    ['channels', { enabled: true }],
  ])('leaves out a valid %s, which CLI mode does not turn on', (key, value) => {
    expect(parseLite({ [key]: value })).not.toHaveProperty(key);
  });
});
