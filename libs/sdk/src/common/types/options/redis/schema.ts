// common/types/options/redis/schema.ts
// Zod schema for Redis/storage configuration

import { NEVER, z } from '@frontmcp/lazy-zod';
import { describeRedisUrlConflicts, mergeRedisUrlFields } from '@frontmcp/utils';

import type { PubsubOptionsInterface, RedisOptionsInterface } from './interfaces';

// ============================================
// Storage Provider Types
// ============================================

/**
 * Supported storage providers schema.
 */
export const storageProviderSchema = z.enum(['redis', 'vercel-kv']);
export type StorageProvider = z.infer<typeof storageProviderSchema>;

// ============================================
// Common Options (shared between providers)
// ============================================

const commonOptionsSchema = z.object({
  /**
   * Key prefix for all keys
   * @default 'mcp:'
   */
  keyPrefix: z.string().optional().default('mcp:'),

  /**
   * Default TTL in milliseconds for stored data
   * @default 3600000 (1 hour)
   */
  defaultTtlMs: z.number().int().positive().optional().default(3600000),
});

// ============================================
// Redis Provider Configuration
// ============================================

/**
 * Redis-specific connection options
 */
const redisConnectionSchema = z.object({
  /**
   * Redis host
   */
  host: z.string().trim().min(1),

  /**
   * Redis port
   * @default 6379
   */
  port: z.number().int().positive().max(65535).optional().default(6379),

  /**
   * Redis password (optional)
   */
  password: z.string().optional(),

  /**
   * Redis database number
   * @default 0
   */
  db: z.number().int().nonnegative().optional().default(0),

  /**
   * Enable TLS connection
   * @default false
   */
  tls: z.boolean().optional().default(false),

  // A config with a `url` belongs to redisUrlSchema; matching it here would drop the URL (#768).
  url: z.undefined().optional(),
});

/**
 * Full Redis provider configuration
 */
export const redisProviderSchema = z
  .object({
    /**
     * Storage provider type
     * @default 'redis'
     */
    provider: z.literal('redis'),
  })
  .merge(redisConnectionSchema)
  .merge(commonOptionsSchema);

export type RedisProviderOptions = z.infer<typeof redisProviderSchema>;

// ============================================
// Vercel KV Provider Configuration
// ============================================

/**
 * Vercel KV provider configuration
 * Uses environment variables by default (KV_REST_API_URL, KV_REST_API_TOKEN)
 */
export const vercelKvProviderSchema = z
  .object({
    /**
     * Storage provider type
     */
    provider: z.literal('vercel-kv'),

    /**
     * KV REST API URL
     * @default process.env.KV_REST_API_URL
     */
    url: z.string().url().optional(),

    /**
     * KV REST API Token
     * @default process.env.KV_REST_API_TOKEN
     */
    token: z.string().optional(),
  })
  .merge(commonOptionsSchema);

export type VercelKvProviderOptions = z.infer<typeof vercelKvProviderSchema>;

// ============================================
// Legacy Redis Schema (backwards compatibility)
// ============================================

/**
 * Legacy Redis configuration without provider field
 * Automatically transforms to redis provider
 */
const legacyRedisSchema = redisConnectionSchema.merge(commonOptionsSchema).transform((val) => ({
  ...val,
  provider: 'redis' as const,
}));

// ============================================
// Redis URL Schema
// ============================================

/** Connection fields read out of a Redis URL. */
export interface ParsedRedisUrl {
  host: string;
  port: number;
  password?: string;
  db: number;
  tls: boolean;
}

function decodeUrlCredential(encoded: string): string | undefined {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

function malformedEscapeProblem(field: 'username' | 'password'): string {
  return `redis.url ${field} has a malformed percent-escape (write a literal "%" as %25)`;
}

/**
 * Read `redis://[[user]:password@]host[:port][/db]` (or `rediss://` for TLS)
 * into the connection fields every Redis consumer takes. Returns a string
 * describing the problem when the URL cannot be used.
 */
export function parseRedisUrl(raw: string): ParsedRedisUrl | string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'redis.url is not a valid URL (expected redis://[[user]:password@]host[:port][/db])';
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    return `redis.url must use the redis:// or rediss:// scheme, got "${url.protocol}//"`;
  }
  // `URL` keeps the brackets of an IPv6 literal; a socket connect wants the bare address.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (!host) return 'redis.url has no host';

  const username = decodeUrlCredential(url.username);
  if (username === undefined) return malformedEscapeProblem('username');
  if (username && username !== 'default') {
    return `redis.url names the ACL user "${username}"; only the default user is supported — use redis://:password@host`;
  }

  const dbText = url.pathname.replace(/^\/+/, '') || url.searchParams.get('db') || '0';
  const db = Number(dbText);
  if (!Number.isInteger(db) || db < 0) return `redis.url database "${dbText}" is not a non-negative integer`;

  const port = url.port ? Number(url.port) : 6379;
  if (port === 0) return 'redis.url port must be between 1 and 65535';
  // ioredis also reads the password from ?password=, so the URL's conflict check does too
  const password = url.password ? decodeUrlCredential(url.password) : url.searchParams.get('password') || undefined;
  if (url.password && password === undefined) return malformedEscapeProblem('password');
  return { host, port, ...(password !== undefined ? { password } : {}), db, tls: url.protocol === 'rediss:' };
}

/**
 * Redis configured from a URL (`redis: { url: process.env.REDIS_URL }`).
 * Normalized to the explicit `provider: 'redis'` shape so downstream code
 * never has to know which form the config used.
 *
 * The URL is the base: `host` / `port` / `password` / `db` / `tls` beside it
 * fill in only what the URL leaves out, and one that contradicts the URL is
 * rejected rather than silently dropped (#768).
 */
export const redisUrlSchema = z
  .object({
    /**
     * Storage provider type — optional, a `url` already says Redis.
     */
    provider: z.literal('redis').optional(),

    /**
     * Redis connection URL (`redis://` or `rediss://`).
     */
    url: z.string().trim().min(1),

    host: z.string().trim().min(1).optional(),
    port: z.number().int().positive().max(65535).optional(),
    password: z.string().optional(),
    db: z.number().int().nonnegative().optional(),
    tls: z.boolean().optional(),
  })
  .merge(commonOptionsSchema)
  .transform((val, ctx) => {
    const parsed = parseRedisUrl(val.url);
    if (typeof parsed === 'string') {
      ctx.addIssue({ code: 'custom', message: parsed, path: ['url'] });
      return NEVER;
    }
    const merge = mergeRedisUrlFields(val.url, val);
    if (merge && merge.conflicts.length > 0) {
      ctx.addIssue({ code: 'custom', message: describeRedisUrlConflicts(merge.conflicts), path: ['url'] });
      return NEVER;
    }
    return {
      provider: 'redis' as const,
      ...parsed,
      ...merge?.fillIns,
      keyPrefix: val.keyPrefix,
      defaultTtlMs: val.defaultTtlMs,
    };
  });

/** The branch errors a failed union reports, as far as the URL message needs them. */
interface UnionIssueLike {
  errors?: ReadonlyArray<ReadonlyArray<{ code?: string; message?: string; path?: ReadonlyArray<PropertyKey> }>>;
}

/**
 * A union reports "Invalid input" when no branch matches, burying the reason a
 * `url` was refused among the other branches' complaints about a missing
 * `host`. Surface the URL branch's own message instead.
 */
function redisUnionError(issue: UnionIssueLike): string | undefined {
  for (const branch of issue.errors ?? []) {
    const urlIssue = branch.find((entry) => entry.code === 'custom' && entry.path?.[0] === 'url');
    if (urlIssue?.message) return urlIssue.message;
  }
  return undefined;
}

// ============================================
// Combined Redis Options Schema
// ============================================

/**
 * Shared storage configuration
 * Supports both Redis and Vercel KV providers.
 *
 * @example Redis (explicit provider)
 * ```typescript
 * {
 *   provider: 'redis',
 *   host: 'localhost',
 *   port: 6379,
 * }
 * ```
 *
 * @example Redis (legacy format - backwards compatible)
 * ```typescript
 * {
 *   host: 'localhost',
 *   port: 6379,
 * }
 * ```
 *
 * @example Vercel KV (uses env vars by default)
 * ```typescript
 * {
 *   provider: 'vercel-kv',
 * }
 * ```
 *
 * @example Redis from a URL (`rediss://` turns TLS on)
 * ```typescript
 * {
 *   url: process.env.REDIS_URL, // redis://:password@host:6379/0
 * }
 * ```
 *
 * @example Vercel KV (explicit config)
 * ```typescript
 * {
 *   provider: 'vercel-kv',
 *   url: 'https://my-kv.vercel-storage.com',
 *   token: 'my-token',
 * }
 * ```
 */
// The URL branch goes first: a `url` beside `host` must not fall into a host-only branch that drops it.
export const redisOptionsSchema = z.union(
  [redisUrlSchema, redisProviderSchema, vercelKvProviderSchema, legacyRedisSchema],
  { error: redisUnionError },
);

/**
 * Storage configuration type (with defaults applied)
 */
export type RedisOptions = z.infer<typeof redisOptionsSchema>;

/**
 * Storage configuration input type (for user configuration).
 * Uses explicit interface for better IDE autocomplete.
 */
export type RedisOptionsInput = RedisOptionsInterface;

// ============================================
// Pub/Sub Options Schema (Redis-only)
// ============================================

/**
 * Pub/Sub configuration (requires Redis, not compatible with Vercel KV)
 *
 * Use this when you need pub/sub features like resource subscriptions
 * but want to use Vercel KV for sessions/cache.
 *
 * @example Hybrid config
 * ```typescript
 * {
 *   redis: { provider: 'vercel-kv' },  // sessions/cache
 *   pubsub: { host: 'localhost' },      // pub/sub
 * }
 * ```
 */
export const pubsubOptionsSchema = z.union([redisUrlSchema, redisProviderSchema, legacyRedisSchema], {
  error: redisUnionError,
});

/**
 * Pub/Sub configuration type (Redis-only)
 */
export type PubsubOptions = z.infer<typeof pubsubOptionsSchema>;

/**
 * Pub/Sub configuration input type.
 * Uses explicit interface for better IDE autocomplete.
 */
export type PubsubOptionsInput = PubsubOptionsInterface;

// ============================================
// Type Guards
// ============================================

/**
 * Check if options are for Redis provider
 */
export function isRedisProvider(options: RedisOptions): options is RedisProviderOptions {
  return options.provider === 'redis';
}

/**
 * Check if options are for Vercel KV provider
 */
export function isVercelKvProvider(options: RedisOptions): options is VercelKvProviderOptions {
  return options.provider === 'vercel-kv';
}

/**
 * Check if pub/sub options are valid Redis config
 */
export function isPubsubConfigured(options: PubsubOptions): options is RedisProviderOptions {
  return options.provider === 'redis';
}
