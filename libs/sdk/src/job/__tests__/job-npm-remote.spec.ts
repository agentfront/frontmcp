import { Job } from '../../common/decorators/job.decorator';
import { JobKind } from '../../common/records/job.record';
import type { JobEsmTargetRecord, JobRemoteRecord } from '../../common/records/job.record';
import { normalizeJob, jobDiscoveryDeps } from '../job.utils';

describe('Job.esm()', () => {
  it('creates JobEsmTargetRecord with kind ESM', () => {
    const record = (Job as any).esm('@acme/jobs@^1.0.0', 'cleanup') as JobEsmTargetRecord;
    expect(record.kind).toBe(JobKind.ESM);
  });

  it('parses scoped specifier correctly', () => {
    const record = (Job as any).esm('@acme/jobs@^1.0.0', 'cleanup') as JobEsmTargetRecord;
    expect(record.specifier.scope).toBe('@acme');
    expect(record.specifier.name).toBe('jobs');
    expect(record.specifier.fullName).toBe('@acme/jobs');
    expect(record.specifier.range).toBe('^1.0.0');
  });

  it('parses unscoped specifier', () => {
    const record = (Job as any).esm('my-jobs@2.0.0', 'report') as JobEsmTargetRecord;
    expect(record.specifier.scope).toBeUndefined();
    expect(record.specifier.fullName).toBe('my-jobs');
    expect(record.specifier.range).toBe('2.0.0');
  });

  it('sets targetName', () => {
    const record = (Job as any).esm('@acme/jobs@^1.0.0', 'cleanup') as JobEsmTargetRecord;
    expect(record.targetName).toBe('cleanup');
  });

  it('creates unique symbol provide token', () => {
    const record = (Job as any).esm('@acme/jobs@^1.0.0', 'cleanup') as JobEsmTargetRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('esm-job:@acme/jobs:cleanup');
  });

  it('creates different symbols for different targets', () => {
    const r1 = (Job as any).esm('@acme/jobs@^1.0.0', 'cleanup') as JobEsmTargetRecord;
    const r2 = (Job as any).esm('@acme/jobs@^1.0.0', 'report') as JobEsmTargetRecord;
    expect(r1.provide).not.toBe(r2.provide);
  });

  it('passes options through', () => {
    const record = (Job as any).esm('@acme/jobs@^1.0.0', 'cleanup', {
      loader: { url: 'https://custom.cdn', token: 'xxx' },
      cacheTTL: 30000,
    }) as JobEsmTargetRecord;
    expect(record.options?.loader).toEqual({ url: 'https://custom.cdn', token: 'xxx' });
    expect(record.options?.cacheTTL).toBe(30000);
  });

  it('generates placeholder metadata with inputSchema and outputSchema', () => {
    const record = (Job as any).esm('@acme/jobs@^1.0.0', 'cleanup') as JobEsmTargetRecord;
    expect(record.metadata.name).toBe('cleanup');
    expect(record.metadata.description).toContain('cleanup');
    expect(record.metadata.description).toContain('@acme/jobs');
    expect(record.metadata.inputSchema).toEqual({});
    expect(record.metadata.outputSchema).toEqual({});
  });

  it('allows overriding metadata via options', () => {
    const record = (Job as any).esm('@acme/jobs@^1.0.0', 'cleanup', {
      metadata: { description: 'Custom cleanup job' },
    }) as JobEsmTargetRecord;
    expect(record.metadata.description).toBe('Custom cleanup job');
    expect(record.metadata.name).toBe('cleanup');
    expect(record.metadata.inputSchema).toEqual({});
  });

  it('throws on empty specifier', () => {
    expect(() => (Job as any).esm('', 'cleanup')).toThrow('Package specifier cannot be empty');
  });

  it('throws on invalid specifier', () => {
    expect(() => (Job as any).esm('!!!', 'cleanup')).toThrow('Invalid package specifier');
  });
});

describe('Job.remote()', () => {
  it('creates JobRemoteRecord with kind REMOTE', () => {
    const record = (Job as any).remote('https://api.example.com/mcp', 'sync') as JobRemoteRecord;
    expect(record.kind).toBe(JobKind.REMOTE);
  });

  it('sets url and targetName', () => {
    const record = (Job as any).remote('https://api.example.com/mcp', 'sync') as JobRemoteRecord;
    expect(record.url).toBe('https://api.example.com/mcp');
    expect(record.targetName).toBe('sync');
  });

  it('creates unique symbol provide token', () => {
    const record = (Job as any).remote('https://api.example.com/mcp', 'sync') as JobRemoteRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('remote-job:https://api.example.com/mcp:sync');
  });

  it('passes transportOptions and remoteAuth', () => {
    const record = (Job as any).remote('https://api.example.com/mcp', 'sync', {
      transportOptions: { timeout: 120000, retryAttempts: 5 },
      remoteAuth: { mode: 'static', credentials: { type: 'bearer', value: 'jwt-token' } },
    }) as JobRemoteRecord;
    expect(record.transportOptions).toEqual({ timeout: 120000, retryAttempts: 5 });
    expect(record.remoteAuth).toEqual({
      mode: 'static',
      credentials: { type: 'bearer', value: 'jwt-token' },
    });
  });

  it('generates placeholder metadata with inputSchema and outputSchema', () => {
    const record = (Job as any).remote('https://api.example.com/mcp', 'sync') as JobRemoteRecord;
    expect(record.metadata.name).toBe('sync');
    expect(record.metadata.description).toContain('sync');
    expect(record.metadata.inputSchema).toEqual({});
    expect(record.metadata.outputSchema).toEqual({});
  });
});

describe('normalizeJob() with ESM/REMOTE records', () => {
  it('passes through JobEsmTargetRecord unchanged', () => {
    const record = (Job as any).esm('@acme/jobs@^1.0.0', 'cleanup') as JobEsmTargetRecord;
    const normalized = normalizeJob(record);
    expect(normalized).toBe(record);
    expect(normalized.kind).toBe(JobKind.ESM);
  });

  it('passes through JobRemoteRecord unchanged', () => {
    const record = (Job as any).remote('https://api.example.com/mcp', 'sync') as JobRemoteRecord;
    const normalized = normalizeJob(record);
    expect(normalized).toBe(record);
    expect(normalized.kind).toBe(JobKind.REMOTE);
  });
});

describe('jobDiscoveryDeps() with ESM/REMOTE records', () => {
  it('returns empty array for ESM record', () => {
    const record = (Job as any).esm('@acme/jobs@^1.0.0', 'cleanup') as JobEsmTargetRecord;
    expect(jobDiscoveryDeps(record)).toEqual([]);
  });

  it('returns empty array for REMOTE record', () => {
    const record = (Job as any).remote('https://api.example.com/mcp', 'sync') as JobRemoteRecord;
    expect(jobDiscoveryDeps(record)).toEqual([]);
  });
});
