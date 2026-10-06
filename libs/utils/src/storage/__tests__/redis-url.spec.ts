import { describeRedisUrlConflicts, mergeRedisUrlFields } from '../redis-url';

describe('mergeRedisUrlFields (#768)', () => {
  it('fills in what the URL leaves out', () => {
    expect(mergeRedisUrlFields('redis://cache', { port: 6390, password: 'p', db: 2, tls: true })).toEqual({
      fillIns: { port: 6390, password: 'p', db: 2, tls: true },
      conflicts: [],
    });
  });

  it('accepts fields that repeat the URL', () => {
    expect(
      mergeRedisUrlFields('rediss://:p%40ss@[::1]:6390/2', {
        host: '::1',
        port: 6390,
        password: 'p@ss',
        db: 2,
        tls: true,
      }),
    ).toEqual({ fillIns: {}, conflicts: [] });
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

  it('returns undefined for an unparseable URL', () => {
    expect(mergeRedisUrlFields('not a url', {})).toBeUndefined();
  });

  it('describes conflicts without values', () => {
    expect(describeRedisUrlConflicts(['password'])).toBe(
      'redis password contradicts redis.url. Fields beside a url only fill in what the URL leaves out ' +
        '(port, password, db, tls); put the value in the URL or drop the field.',
    );
    expect(describeRedisUrlConflicts(['host', 'port'])).toContain('redis host, port contradict redis.url');
  });
});
