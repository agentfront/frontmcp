import { jobsServerStore, resolveJobsStore } from '../job-scope.helper';

const sqlite = { path: '/var/lib/app/state.sqlite' };
const redis = { provider: 'redis' as const, host: 'cache.internal', port: 6379 };

describe('resolveJobsStore', () => {
  it('keeps an explicit jobs.store', () => {
    expect(resolveJobsStore({ sqlite: { path: '/tmp/jobs.sqlite' }, keyPrefix: 'j:' }, { redis, sqlite })).toEqual({
      sqlite: { path: '/tmp/jobs.sqlite' },
      keyPrefix: 'j:',
    });
    expect(resolveJobsStore({ redis }, { sqlite })).toEqual({ redis });
  });

  it('falls back to the top-level redis, with the key prefix kept', () => {
    expect(resolveJobsStore({ keyPrefix: 'j:' }, { redis, sqlite })).toEqual({ redis, keyPrefix: 'j:' });
  });

  it("keeps the jobs' keys under the top-level redis key prefix, unless jobs.store sets its own", () => {
    const tenantRedis = { ...redis, keyPrefix: 'tenant-a:' };

    expect(resolveJobsStore(undefined, { redis: tenantRedis })).toEqual({
      redis: tenantRedis,
      keyPrefix: 'tenant-a:jobs:',
    });
    expect(resolveJobsStore({ keyPrefix: 'j:' }, { redis: tenantRedis })).toEqual({
      redis: tenantRedis,
      keyPrefix: 'j:',
    });
  });

  it('falls back to the top-level sqlite when no redis is configured', () => {
    expect(resolveJobsStore(undefined, { sqlite })).toEqual({ sqlite });
  });

  it('skips a top-level Vercel KV, which has no keys or sets, for the sqlite or memory store', () => {
    const vercelKv = { provider: 'vercel-kv' as const };

    expect(resolveJobsStore(undefined, { redis: vercelKv, sqlite })).toEqual({ sqlite });
    expect(resolveJobsStore(undefined, { redis: vercelKv })).toBeUndefined();
  });

  it('keeps runs in memory with jobs.store: false, whatever the top-level redis or sqlite', () => {
    expect(resolveJobsStore(false, { redis, sqlite })).toBeUndefined();
  });

  it('leaves the memory store when nothing is configured', () => {
    expect(resolveJobsStore(undefined, {})).toBeUndefined();
  });
});

describe('jobsServerStore', () => {
  const vercelKv = { provider: 'vercel-kv' as const };

  it('names the option whose Redis or SQLite the jobs would open', () => {
    expect(jobsServerStore({ sqlite }, { redis })).toBe('jobs.store.sqlite');
    expect(jobsServerStore({ redis }, { sqlite })).toBe('jobs.store.redis');
    expect(jobsServerStore({ keyPrefix: 'j:' }, { redis, sqlite })).toBe('redis');
    expect(jobsServerStore(undefined, { redis: vercelKv, sqlite })).toBe('sqlite');
  });

  it('names none with jobs.store: false, on Vercel KV or with nothing set', () => {
    expect(jobsServerStore(false, { redis, sqlite })).toBeUndefined();
    expect(jobsServerStore({ redis: vercelKv }, { sqlite })).toBeUndefined();
    expect(jobsServerStore(undefined, { redis: vercelKv })).toBeUndefined();
    expect(jobsServerStore(undefined, {})).toBeUndefined();
  });
});
