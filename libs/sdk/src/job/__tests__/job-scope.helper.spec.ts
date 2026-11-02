import { resolveJobsStore } from '../job-scope.helper';

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

  it('falls back to the top-level sqlite when no redis is configured', () => {
    expect(resolveJobsStore(undefined, { sqlite })).toEqual({ sqlite });
  });

  it('skips a top-level Vercel KV, which has no keys or sets, for the sqlite or memory store', () => {
    const vercelKv = { provider: 'vercel-kv' as const };

    expect(resolveJobsStore(undefined, { redis: vercelKv, sqlite })).toEqual({ sqlite });
    expect(resolveJobsStore(undefined, { redis: vercelKv })).toBeUndefined();
  });

  it('leaves the memory store when nothing is configured', () => {
    expect(resolveJobsStore(undefined, {})).toBeUndefined();
  });
});
