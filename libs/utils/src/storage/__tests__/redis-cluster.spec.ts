/**
 * RedisStorageAdapter against a real Redis Cluster (#1503).
 *
 * Runs when REDIS_CLUSTER_NODES lists the cluster's nodes (`host:port,host:port,...`), as
 * `scripts/redis-cluster-docker.sh up` prints; skipped otherwise.
 */
import Redis, { Cluster } from 'ioredis';
import { createCluster } from 'redis';
import { createCluster as createClusterV4 } from 'redis-v4';

import { RedisStorageAdapter } from '../adapters/redis';

const NODES = (process.env['REDIS_CLUSTER_NODES'] ?? '')
  .split(',')
  .map((node) => node.trim())
  .filter(Boolean)
  .map((node) => {
    const [host, port] = node.split(':');
    return { host, port: Number(port) };
  });

const describeCluster = NODES.length > 0 ? describe : describe.skip;

/** Keys that land on all three masters of a 3-master cluster (slots 0-5460, 5461-10922, 10923-16383). */
const SPREAD_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'user:1', 'user:2', 'session:x', 'session:y'];

describeCluster('RedisStorageAdapter on a Redis Cluster', () => {
  const prefix = `cluster-spec:${Date.now()}:`;
  const seed = NODES[0];

  async function flushPrefix(): Promise<void> {
    const cluster = new Cluster([seed]);
    try {
      await Promise.all(
        cluster.nodes('master').map(async (node) => {
          const keys = await node.keys(`${prefix}*`);
          await Promise.all(keys.map((key) => cluster.del(key)));
        }),
      );
    } finally {
      cluster.disconnect();
    }
  }

  afterAll(flushPrefix);

  it('spreads the test keys over more than one master', async () => {
    const cluster = new Cluster([seed]);
    try {
      const slots = await Promise.all(SPREAD_KEYS.map((key) => cluster.cluster('KEYSLOT', prefix + key)));
      expect(new Set(slots.map((slot) => Math.min(2, Math.floor(Number(slot) / 5461)))).size).toBeGreaterThan(1);
    } finally {
      cluster.disconnect();
    }
  });

  it('a single-node connection to a cluster endpoint fails with MOVED (why `cluster: true` exists)', async () => {
    const direct = new Redis(seed);
    try {
      const results = await Promise.allSettled(SPREAD_KEYS.map((key) => direct.set(prefix + key, '1')));
      const moved = results.filter((r) => r.status === 'rejected' && String(r.reason).includes('MOVED'));
      expect(moved.length).toBeGreaterThan(0);
    } finally {
      direct.disconnect();
    }
  });

  /** Clients a test made and hands to an adapter: the adapter leaves them open, so the test closes them. */
  const external: Array<{ disconnect(): unknown }> = [];
  afterAll(async () => {
    for (const client of external) await client.disconnect();
  });
  function externalCluster(): Cluster {
    const client = new Cluster([seed]);
    external.push(client);
    return client;
  }

  describe.each([
    ['config cluster: true', () => new RedisStorageAdapter({ config: { ...seed, cluster: true }, keyPrefix: prefix })],
    [
      'url + cluster: true',
      () =>
        new RedisStorageAdapter({
          url: `redis://${seed.host}:${seed.port}`,
          config: { cluster: true },
          keyPrefix: prefix,
        }),
    ],
    [
      'cluster: { nodes }',
      () => new RedisStorageAdapter({ config: { cluster: { nodes: NODES.slice(0, 2) } }, keyPrefix: prefix }),
    ],
    ['an ioredis Cluster client', () => new RedisStorageAdapter({ client: externalCluster(), keyPrefix: prefix })],
    [
      'a node-redis v6 cluster (not connected yet)',
      () => {
        const client = createCluster({ rootNodes: [{ url: `redis://${seed.host}:${seed.port}` }] });
        external.push({ disconnect: () => client.isOpen && client.destroy() });
        return new RedisStorageAdapter({ client, keyPrefix: prefix });
      },
    ],
    [
      'a node-redis v4 cluster',
      () => {
        const client = createClusterV4({ rootNodes: [{ url: `redis://${seed.host}:${seed.port}` }] });
        external.push({ disconnect: () => client.isOpen && client.disconnect() });
        return new RedisStorageAdapter({ client, keyPrefix: prefix });
      },
    ],
  ])('with %s', (_label, makeAdapter) => {
    let adapter: RedisStorageAdapter;

    beforeAll(async () => {
      adapter = makeAdapter();
      await adapter.connect();
    });

    afterAll(async () => {
      await adapter.disconnect();
    });

    it('sets and reads keys on every master (no MOVED)', async () => {
      for (const key of SPREAD_KEYS) await adapter.set(key, `v-${key}`, { ttlSeconds: 60 });
      for (const key of SPREAD_KEYS) expect(await adapter.get(key)).toBe(`v-${key}`);
    });

    it('mget / mset / mdelete keys of different slots (no CROSSSLOT)', async () => {
      const keys = SPREAD_KEYS.map((key) => `batch:${key}`);
      await adapter.mset(keys.map((key) => ({ key, value: key, options: { ttlSeconds: 60 } })));
      expect(await adapter.mget(keys)).toEqual(keys);
      expect(await adapter.mdelete(keys)).toBe(keys.length);
      expect(await adapter.mget(keys)).toEqual(keys.map(() => null));
    });

    it('keys() and count() see the keys of every master', async () => {
      const keys = SPREAD_KEYS.map((key) => `scan:${key}`);
      for (const key of keys) await adapter.set(key, '1', { ttlSeconds: 60 });
      expect((await adapter.keys('scan:*')).sort()).toEqual([...keys].sort());
      expect(await adapter.count('scan:*')).toBe(keys.length);
    });

    it('runs the compare-and-* scripts and atomic counters', async () => {
      await adapter.set('cas', 'one', { ttlSeconds: 60 });
      expect(await adapter.setIfEquals('cas', 'one', 'two')).toBe(true);
      expect(await adapter.expireIfEquals('cas', 'two', 30)).toBe(true);
      expect(await adapter.extendTtl('cas', 40)).toBe(true);
      expect(await adapter.deleteIfEquals('cas', 'two')).toBe(true);
      expect(await adapter.incr('counter')).toBe(1);
      expect(await adapter.incrBy('counter', 4)).toBe(5);
      expect(await adapter.decr('counter')).toBe(4);
      await adapter.delete('counter');
    });

    it('delivers pub/sub messages', async () => {
      const received = new Promise<string>((resolve) => {
        void adapter.subscribe('events', (message) => resolve(message));
      });
      // The subscription is set up asynchronously; publish until it lands.
      let delivered = 0;
      for (let attempt = 0; attempt < 50 && delivered === 0; attempt++) {
        delivered = await adapter.publish('events', 'hello');
        if (delivered === 0) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await expect(received).resolves.toBe('hello');
    });
  });
});
