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
