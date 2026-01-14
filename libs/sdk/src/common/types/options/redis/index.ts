// common/types/options/redis/index.ts
// Barrel export for Redis/storage options

export type {
  StorageProvider as StorageProviderInterface,
  CommonStorageOptionsInterface,
  RedisConnectionInterface,
  RedisProviderOptionsInterface,
  VercelKvProviderOptionsInterface,
  RedisOptionsInterface,
} from './interfaces';

export {
  storageProviderSchema,
  redisProviderSchema,
  vercelKvProviderSchema,
  redisOptionsSchema,
  pubsubOptionsSchema,
  isRedisProvider,
  isVercelKvProvider,
  isPubsubConfigured,
} from './schema';

export type {
  RedisProviderOptions,
  VercelKvProviderOptions,
  RedisOptions,
  RedisOptionsInput,
  PubsubOptions,
  PubsubOptionsInput,
} from './schema';
