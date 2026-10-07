import { describeRedisUrlConflicts, mergeRedisUrlFields, readRedisUrl } from '../redis-url';

describe('mergeRedisUrlFields (#768)', () => {
  it('fills in what the URL leaves out', () => {
    const merge = mergeRedisUrlFields('redis://cache', { port: 6390, password: 'p', db: 2, tls: true });

    expect(merge?.fillIns).toEqual({ port: 6390, password: 'p', db: 2, tls: true });
    expect(merge?.conflicts).toEqual([]);
  });

  it('fills in the password of a URL that names only the user', () => {
    expect(mergeRedisUrlFields('redis://default@cache', { password: 'p' })?.fillIns).toEqual({ password: 'p' });
  });

  it('accepts fields that repeat the URL', () => {
    const merge = mergeRedisUrlFields('rediss://:p%40ss@[::1]:6390/2', {
      host: '::1',
      port: 6390,
      password: 'p@ss',
      db: 2,
      tls: true,
    });

    expect(merge?.fillIns).toEqual({});
    expect(merge?.conflicts).toEqual([]);
  });

  it('reports every field that contradicts the URL', () => {
    expect(
      mergeRedisUrlFields('rediss://:secret@cache:6379/1', {
        host: 'other',
        port: 6380,
        password: 'other',
        db: 2,
        tls: false,
      })?.conflicts,
    ).toEqual(['host', 'port', 'password', 'db', 'tls']);
  });

  it('reads the database from ?db=', () => {
    expect(mergeRedisUrlFields('redis://cache?db=4', { db: 5 })?.conflicts).toEqual(['db']);
  });

  it('reads the password from ?password=, as ioredis does', () => {
    expect(mergeRedisUrlFields('redis://cache?password=first', { password: 'second' })?.conflicts).toEqual([
      'password',
    ]);
  });

  it('returns undefined for an unparseable URL or a socket path', () => {
    expect(mergeRedisUrlFields('not a url', {})).toBeUndefined();
    expect(mergeRedisUrlFields('/tmp/redis.sock', {})).toBeUndefined();
  });

  it('describes conflicts without values', () => {
    expect(describeRedisUrlConflicts(['password'])).toBe(
      'redis password contradicts redis.url. Fields beside a url only fill in what the URL leaves out ' +
        '(port, password, db, tls); put the value in the URL or drop the field.',
    );
    expect(describeRedisUrlConflicts(['host', 'port'])).toContain('redis host, port contradict redis.url');
  });
});

describe('readRedisUrl', () => {
  it('reads the userinfo, port, path and query as ioredis does', () => {
    expect(readRedisUrl('rediss://default:p%40ss@[::1]:6390/2?family=6&connectTimeout=500')).toEqual({
      host: '::1',
      port: 6390,
      username: 'default',
      password: 'p@ss',
      db: 2,
      tls: true,
      queryOptions: { family: 6, connectTimeout: '500' },
    });
  });

  it('takes from the query what the rest of the URL leaves out', () => {
    expect(readRedisUrl('redis://default@cache?password=pw&db=3&port=6390')).toEqual({
      host: 'cache',
      port: 6390,
      username: 'default',
      password: 'pw',
      db: 3,
      tls: false,
      queryOptions: {},
    });
  });
});
