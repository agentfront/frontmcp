/**
 * `jobs.allowDynamicRegistration` has to survive schema parsing.
 *
 * `register_job` / `register_workflow` register a job from a raw script string,
 * so they are off by default (GHSA-58v2-gpcc-jmqv) and this flag is the only
 * documented way back on. A Zod object strips keys it does not declare, so
 * leaving it out of the schema would silently discard the operator's opt-in and
 * make the escape hatch impossible to use.
 */
import { frontMcpMetadataSchema } from '../front-mcp.metadata';

function parseJobs(jobs: Record<string, unknown>): Record<string, unknown> | undefined {
  const parsed = frontMcpMetadataSchema.parse({
    info: { name: 'jobs-schema', version: '1.0.0' },
    apps: [],
    jobs,
  }) as { jobs?: Record<string, unknown> };
  return parsed.jobs;
}

describe('frontMcpMetadataSchema — jobs config', () => {
  it('keeps allowDynamicRegistration: true', () => {
    expect(parseJobs({ enabled: true, allowDynamicRegistration: true })?.['allowDynamicRegistration']).toBe(true);
  });

  it('keeps an explicit allowDynamicRegistration: false', () => {
    expect(parseJobs({ enabled: true, allowDynamicRegistration: false })?.['allowDynamicRegistration']).toBe(false);
  });

  it('leaves it undefined when the operator does not set it, so the default stays off', () => {
    expect(parseJobs({ enabled: true })?.['allowDynamicRegistration']).toBeUndefined();
  });

  it('rejects a non-boolean opt-in rather than coercing it', () => {
    expect(() => parseJobs({ enabled: true, allowDynamicRegistration: 'true' })).toThrow();
  });
});

describe('frontMcpMetadataSchema — durable jobs config', () => {
  it('keeps a sqlite store, a default timeout and admission limits', () => {
    const jobs = parseJobs({
      enabled: true,
      store: { sqlite: { path: '/tmp/jobs.sqlite' } },
      defaultTimeoutMs: 60_000,
      admission: { concurrency: 2, memoryMb: 2_048, maxWaitMs: 600_000 },
    });

    expect(jobs).toEqual(
      expect.objectContaining({
        store: expect.objectContaining({ sqlite: expect.objectContaining({ path: '/tmp/jobs.sqlite' }) }),
        defaultTimeoutMs: 60_000,
        admission: { concurrency: 2, memoryMb: 2_048, maxWaitMs: 600_000 },
      }),
    );
  });

  it('refuses a store that names both redis and sqlite', () => {
    expect(() =>
      parseJobs({
        enabled: true,
        store: { redis: { provider: 'redis', host: 'localhost' }, sqlite: { path: '/tmp/jobs.sqlite' } },
      }),
    ).toThrow(/jobs\.store takes redis or sqlite, not both/);
  });

  it('refuses a sqlite store without a path', () => {
    expect(() => parseJobs({ enabled: true, store: { sqlite: {} } })).toThrow();
  });

  it.each([[{ concurrency: 0 }], [{ concurrency: 1.5 }], [{ memoryMb: -1 }], [{ maxWaitMs: -1 }]])(
    'refuses admission %j',
    (admission) => {
      expect(() => parseJobs({ enabled: true, admission })).toThrow();
    },
  );

  it('refuses a negative default timeout', () => {
    expect(() => parseJobs({ enabled: true, defaultTimeoutMs: -1 })).toThrow();
  });
});
