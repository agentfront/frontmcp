/**
 * RememberPlugin's global store on a real TLS Redis Cluster named by a rediss:// seed (#1503).
 *
 * Runs with a TLS cluster from `scripts/redis-cluster-docker.sh` (see the utils cluster spec):
 * REDIS_CLUSTER_TLS_SEED=localhost:7111, REDIS_CLUSTER_TLS_PASSWORD, and NODE_EXTRA_CA_CERTS=<its ca.crt>
 * so Node trusts the test certificate. Skipped otherwise.
 */
import 'reflect-metadata';

import { redisOptionsSchema } from '@frontmcp/sdk';

import type RememberRedisProvider from '../providers/remember-redis.provider';
import RememberPlugin from '../remember.plugin';

const SEED = process.env['REDIS_CLUSTER_TLS_SEED'];
const PASSWORD = process.env['REDIS_CLUSTER_TLS_PASSWORD'] ?? '';
const describeTls = SEED && process.env['NODE_EXTRA_CA_CERTS'] ? describe : describe.skip;

describeTls('RememberPlugin global-store on a TLS cluster named by a rediss:// seed', () => {
  it('stores and reads over the TLS the seed asks for', async () => {
    // The server's redis as the schema parses it
    const redis = redisOptionsSchema.parse({ cluster: { nodes: [`rediss://:${PASSWORD}@${SEED}`] } });
    const provider = (RememberPlugin.dynamicProviders({ type: 'global-store' }) as unknown[]).find(
      (entry) => (entry as { name?: string }).name === 'remember:store:global',
    ) as { useFactory: (config: unknown) => RememberRedisProvider };
    const store = provider.useFactory({ redis });
    try {
      const key = `tls-cluster-spec:${Date.now()}`;
      await store.setValue(key, { ok: true }, 30);
      await expect(store.getValue(key)).resolves.toEqual({ ok: true });
      await store.delete(key);
    } finally {
      await store.close();
    }
  });
});
