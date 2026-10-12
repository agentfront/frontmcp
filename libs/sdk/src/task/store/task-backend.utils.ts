import { getEnv, type StorageConfig } from '@frontmcp/utils';

import { type RedisOptionsInput } from '../../common';

/** A storage config that names a backend; `{}` and `{ type: 'auto' }` defer to environment detection. */
export function isExplicitStorage(storage?: StorageConfig): storage is StorageConfig {
  return Boolean(storage?.type && storage.type !== 'auto');
}

/**
 * True when the task backend would resolve to Vercel KV (no pub/sub, so unusable
 * for tasks): an explicit `provider: 'vercel-kv'`, or — with no explicit backend —
 * the ambient `KV_REST_API_URL` Vercel injects.
 */
export function resolvesToVercelKvTaskBackend(redis?: RedisOptionsInput, storage?: StorageConfig): boolean {
  if (isExplicitStorage(storage)) return storage.type === 'vercel-kv';
  if (redis) return 'provider' in redis && redis.provider === 'vercel-kv';
  return Boolean(getEnv('KV_REST_API_URL'));
}
