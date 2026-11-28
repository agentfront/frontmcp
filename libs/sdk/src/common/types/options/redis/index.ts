// common/types/options/redis/index.ts
// Barrel export for Redis/storage options

export type {
  StorageProvider as StorageProviderInterface,
  CommonStorageOptionsInterface,
  RedisConnectionInterface,
  RedisProviderOptionsInterface,
  RedisUrlOptionsInterface,
  RedisClusterNodesOptionsInterface,
  RedisClientOptionsInterface,
  VercelKvProviderOptionsInterface,
  RedisOptionsInterface,
  PubsubOptionsInterface,
} from './interfaces';

export {
  storageProviderSchema,
  redisProviderSchema,
  vercelKvProviderSchema,
  redisUrlSchema,
  redisClusterSchema,
  redisClusterNodesSchema,
  redisClientSchema,
  parseRedisUrl,
  redisOptionsSchema,
  pubsubOptionsSchema,
  isRedisProvider,
  isVercelKvProvider,
  isPubsubConfigured,
} from './schema';

export type {
  ParsedRedisUrl,
  RedisProviderOptions,
  RedisClientProviderOptions,
  VercelKvProviderOptions,
  RedisOptions,
  RedisOptionsInput,
  PubsubOptions,
  PubsubOptionsInput,
} from './schema';

export { isRedisConnectionOptions, redisConnectionOfOptions, redisStorageConfigOf } from './connection';
export type { RedisConnectionOptions } from './connection';

// The one guard for a Redis connection in any form (host, url, cluster seed nodes, client)
export { isRedisConnection } from '@frontmcp/utils';
export type {
  FrontMcpRedisClient,
  RedisClientInput,
  RedisClusterConfig,
  RedisClusterNode,
  RedisClusterOption,
  RedisConnectionConfig,
} from '@frontmcp/utils';
