/**
 * The Redis connection config every FrontMCP option shares, and the one guard for it (#1503).
 */
import type { RedisConnectionConfig } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Whether a `cluster` option names seed nodes of its own. */
export function hasRedisClusterNodes(cluster: unknown): boolean {
  return isRecord(cluster) && Array.isArray(cluster['nodes']) && cluster['nodes'].length > 0;
}

/**
 * Whether `value` names a Redis connection in any form: a `host`, a `url`, cluster seed nodes, or a
 * `client`. False for Vercel KV (`provider: 'vercel-kv'`) and for a config naming no server.
 */
export function isRedisConnection(value: unknown): value is RedisConnectionConfig {
  if (!isRecord(value)) return false;
  if (value['provider'] !== undefined && value['provider'] !== 'redis') return false;
  if (value['client'] !== undefined) return isRecord(value['client']) || typeof value['client'] === 'function';
  if (typeof value['host'] === 'string' && value['host'].length > 0) return true;
  if (typeof value['url'] === 'string' && value['url'].length > 0) return true;
  return hasRedisClusterNodes(value['cluster']);
}

/**
 * The connection fields of a config, without its other settings (`keyPrefix`, `defaultTtlMs`, ...):
 * what {@link createRedisConnection} takes. A `client` comes alone.
 */
export function redisConnectionOf(config: RedisConnectionConfig): RedisConnectionConfig {
  if (config.client !== undefined) return { client: config.client };
  const { url, host, port, password, db, tls, cluster } = config;
  return Object.fromEntries(
    Object.entries({ url, host, port, password, db, tls, cluster }).filter(([, value]) => value !== undefined),
  ) as RedisConnectionConfig;
}
