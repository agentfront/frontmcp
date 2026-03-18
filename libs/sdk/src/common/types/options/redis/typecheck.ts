// common/types/options/redis/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas

import type { z } from 'zod';
import type { redisProviderSchema, vercelKvProviderSchema, redisOptionsSchema, pubsubOptionsSchema } from './schema';
import type {
  RedisProviderOptionsInterface,
  VercelKvProviderOptionsInterface,
  RedisOptionsInterface,
  PubsubOptionsInterface,
} from './interfaces';

type IsAssignable<T, U> = T extends U ? true : false;
type AssertTrue<T extends true> = T;
type HasSameKeys<T, U> = [Exclude<keyof T, keyof U>, Exclude<keyof U, keyof T>] extends [never, never] ? true : false;

// Redis provider checks (bidirectional assignability + exact key parity)
type _RedisProviderSchemaInput = z.input<typeof redisProviderSchema>;
type _RedisProviderCheck = AssertTrue<IsAssignable<RedisProviderOptionsInterface, _RedisProviderSchemaInput>>;
type _RedisProviderReverseCheck = AssertTrue<IsAssignable<_RedisProviderSchemaInput, RedisProviderOptionsInterface>>;
type _RedisProviderKeysCheck = AssertTrue<HasSameKeys<RedisProviderOptionsInterface, _RedisProviderSchemaInput>>;

// Vercel KV provider checks (bidirectional assignability + exact key parity)
type _VercelKvSchemaInput = z.input<typeof vercelKvProviderSchema>;
type _VercelKvCheck = AssertTrue<IsAssignable<VercelKvProviderOptionsInterface, _VercelKvSchemaInput>>;
type _VercelKvReverseCheck = AssertTrue<IsAssignable<_VercelKvSchemaInput, VercelKvProviderOptionsInterface>>;
type _VercelKvKeysCheck = AssertTrue<HasSameKeys<VercelKvProviderOptionsInterface, _VercelKvSchemaInput>>;

// Combined Redis options (union) - each interface member must be assignable to schema input
type _RedisSchemaInput = z.input<typeof redisOptionsSchema>;
type _RedisProviderAssignable = AssertTrue<IsAssignable<RedisProviderOptionsInterface, _RedisSchemaInput>>;
type _VercelKvAssignable = AssertTrue<IsAssignable<VercelKvProviderOptionsInterface, _RedisSchemaInput>>;

// Pubsub options (union) - each interface member must be assignable to schema input
type _PubsubSchemaInput = z.input<typeof pubsubOptionsSchema>;
type _PubsubRedisProviderAssignable = AssertTrue<IsAssignable<RedisProviderOptionsInterface, _PubsubSchemaInput>>;

// Verify RedisOptionsInterface covers all union members (bidirectional + key parity)
type _RedisInterfaceCheck = AssertTrue<IsAssignable<RedisOptionsInterface, _RedisSchemaInput>>;
type _RedisSchemaToInterfaceCheck = AssertTrue<IsAssignable<_RedisSchemaInput, RedisOptionsInterface>>;
type _RedisKeysCheck = AssertTrue<HasSameKeys<RedisOptionsInterface, _RedisSchemaInput>>;
type _PubsubInterfaceCheck = AssertTrue<IsAssignable<PubsubOptionsInterface, _PubsubSchemaInput>>;
type _PubsubSchemaToInterfaceCheck = AssertTrue<IsAssignable<_PubsubSchemaInput, PubsubOptionsInterface>>;
type _PubsubKeysCheck = AssertTrue<HasSameKeys<PubsubOptionsInterface, _PubsubSchemaInput>>;

export {};
