/**
 * The `redis` option's cluster and client forms (#1503), and how every feature reads them.
 */
import {
  isRedisConnection,
  isRedisConnectionOptions,
  isRedisProvider,
  pubsubOptionsSchema,
  redisConnectionOfOptions,
  redisOptionsSchema,
  redisStorageConfigOf,
  type RedisConnectionOptions,
} from '../redis';

/** An ioredis-shaped client, as a second copy of ioredis would make it. */
const ioredisLike = () => ({
  status: 'ready',
  isCluster: true,
  call() {},
  duplicate() {},
  sendCommand() {},
  nodes: () => [],
});

function parse(input: unknown) {
  return redisOptionsSchema.parse(input);
}

function messagesOf(input: unknown): string[] {
  const result = redisOptionsSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('redis: cluster', () => {
  it('keeps a host/port config exactly as before when cluster is left out', () => {
    expect(parse({ host: 'cache' })).toEqual({
      provider: 'redis',
      host: 'cache',
      port: 6379,
      db: 0,
      tls: false,
      keyPrefix: 'mcp:',
      defaultTtlMs: 3600000,
    });
  });

  it('keeps cluster: true on a host config (the AWS ElastiCache configuration endpoint)', () => {
    expect(
      parse({ host: 'my-cluster.xxxxxx.clustercfg.use2.cache.amazonaws.com', port: 6379, tls: true, cluster: true }),
    ).toMatchObject({
      provider: 'redis',
      host: 'my-cluster.xxxxxx.clustercfg.use2.cache.amazonaws.com',
      tls: true,
      cluster: true,
    });
  });

  it('keeps cluster on a url config', () => {
    expect(parse({ url: 'rediss://:pw@cfg.example:6380', cluster: true })).toMatchObject({
      host: 'cfg.example',
      port: 6380,
      password: 'pw',
      tls: true,
      cluster: true,
    });
    expect(parse({ url: 'redis://cfg.example' })).not.toHaveProperty('cluster');
  });

  it('reads a cluster named by its seed nodes alone, with the first seed as host/port', () => {
    const cluster = { nodes: ['10.0.0.1:7000', { host: '10.0.0.2', port: 7001 }], options: { scaleReads: 'slave' } };
    expect(parse({ cluster, password: 'pw', tls: true })).toEqual({
      provider: 'redis',
      host: '10.0.0.1',
      port: 7000,
      password: 'pw',
      db: 0,
      tls: true,
      cluster,
      keyPrefix: 'mcp:',
      defaultTtlMs: 3600000,
    });
    expect(parse({ cluster: { nodes: ['redis://10.0.0.3:7002'] } })).toMatchObject({ host: '10.0.0.3', port: 7002 });
    expect(parse({ cluster: { nodes: [{ host: 'seed' }] } })).toMatchObject({ host: 'seed', port: 6379 });
  });

  it('refuses a database other than 0', () => {
    expect(messagesOf({ host: 'cfg', db: 2, cluster: true })).toEqual([
      'redis.db is 2, but a Redis Cluster has database 0 only',
    ]);
    expect(messagesOf({ url: 'redis://cfg:6379/3', cluster: true })).toEqual([
      'redis.db is 3, but a Redis Cluster has database 0 only',
    ]);
    expect(messagesOf({ cluster: { nodes: ['a:1'] }, db: 1 })).toEqual([
      'redis.db is 1, but a Redis Cluster has database 0 only',
    ]);
  });

  it('says what is missing for cluster: true alone', () => {
    expect(messagesOf({ cluster: true })).toEqual([
      'redis.cluster needs a node to start from: set host (or url), or cluster.nodes',
    ]);
  });

  it('is taken where pub/sub is configured too', () => {
    expect(pubsubOptionsSchema.parse({ host: 'cfg', cluster: true })).toMatchObject({ cluster: true });
  });
});

describe('redis: client', () => {
  it('keeps the client as the same object, with the store settings', () => {
    const client = ioredisLike();
    const parsed = parse({ client, keyPrefix: 'app:' });
    expect(parsed).toEqual({ provider: 'redis', client, keyPrefix: 'app:', defaultTtlMs: 3600000 });
    expect((parsed as { client: unknown }).client).toBe(client);
  });

  it('takes a node-redis client and a FrontMcpRedisClient', () => {
    const nodeRedis = { isOpen: false, sendCommand() {}, connect() {}, duplicate() {} };
    expect(parse({ client: nodeRedis })).toMatchObject({ client: nodeRedis });
    const custom = { get() {}, set() {}, del() {} };
    expect(parse({ provider: 'redis', client: custom })).toMatchObject({ client: custom });
  });

  it('refuses connection fields beside a client', () => {
    expect(messagesOf({ client: ioredisLike(), host: 'cache', cluster: true })).toEqual([
      'redis.client carries its own connection; drop host, cluster beside it',
    ]);
  });

  it('refuses something that is not a Redis client', () => {
    expect(messagesOf({ client: { ping() {} } })[0]).toMatch(/not a Redis client FrontMCP can use/);
  });

  it('is taken where pub/sub is configured too', () => {
    const client = ioredisLike();
    expect(pubsubOptionsSchema.parse({ client })).toMatchObject({ client });
  });
});

describe('reading a parsed redis option', () => {
  const host = parse({ host: 'cache', password: 'pw', cluster: true }) as RedisConnectionOptions;
  const client = ioredisLike();
  const own = parse({ client }) as RedisConnectionOptions;
  const kv = parse({ provider: 'vercel-kv' });

  it('tells a Redis server in any form from Vercel KV', () => {
    expect(isRedisConnectionOptions(host)).toBe(true);
    expect(isRedisConnectionOptions(own)).toBe(true);
    expect(isRedisConnectionOptions(kv)).toBe(false);
    expect(isRedisConnection(host)).toBe(true);
    expect(isRedisConnection(own)).toBe(true);
    expect(isRedisConnection(kv)).toBe(false);
  });

  it('keeps isRedisProvider to the host form', () => {
    expect(isRedisProvider(host)).toBe(true);
    expect(isRedisProvider(own)).toBe(false);
  });

  it('forwards cluster and client, which destructuring host/port/password/db/tls dropped', () => {
    expect(redisConnectionOfOptions(host)).toEqual({
      host: 'cache',
      port: 6379,
      password: 'pw',
      db: 0,
      tls: false,
      cluster: true,
    });
    expect(redisConnectionOfOptions(own)).toEqual({ client });
    expect(redisStorageConfigOf(host)).toEqual({
      type: 'redis',
      redis: { config: { host: 'cache', port: 6379, password: 'pw', db: 0, tls: false, cluster: true } },
    });
    expect(redisStorageConfigOf(own)).toEqual({ type: 'redis', redis: { client } });
  });
});
