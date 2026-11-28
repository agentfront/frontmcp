// common/types/options/redis/schema.ts
// Zod schema for Redis/storage configuration

import { NEVER, internalZ as z } from '@frontmcp/lazy-zod';
import {
  describeRedisUrlConflicts,
  isRedisClientInput,
  mergeRedisUrlFields,
  redisClientProblem,
  UNSUPPORTED_REDIS_CLIENT_MESSAGE,
  type RedisClientInput,
  type RedisClusterOption,
} from '@frontmcp/utils';

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
// Redis Cluster (#1503)
// ============================================

/** A seed node: `{ host, port }`, `'host:port'`, or a `redis://` / `rediss://` URL. */
const redisClusterNodeSchema = z.union([
  z.string().trim().min(1),
  z.object({
    host: z.string().trim().min(1),
    port: z.number().int().positive().max(65535).optional(),
  }),
]);

/** `cluster: { nodes, options }`: seed nodes, and ioredis ClusterOptions applied over FrontMCP's defaults. */
const redisClusterConfigSchema = z.object({
  nodes: z.array(redisClusterNodeSchema).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

/**
 * `cluster: true` makes the host/port (or url) a Redis Cluster endpoint, such as an AWS ElastiCache
 * configuration endpoint; an object names seed nodes or tunes the cluster client.
 */
export const redisClusterSchema = z.union([z.boolean(), redisClusterConfigSchema]);

/** A database other than 0 beside a cluster, which has database 0 only. */
function clusterDbProblem(val: { cluster?: RedisClusterOption; db?: number }): string | undefined {
  const cluster = val.cluster === true || (typeof val.cluster === 'object' && val.cluster !== null);
  return cluster && val.db !== undefined && val.db !== 0
    ? `redis.db is ${val.db}, but a Redis Cluster has database 0 only`
    : undefined;
}

/** Refused beside a field: a client carries its own connection. */
const NO_CLIENT = z
  .undefined({ error: 'redis.client carries its own connection; drop host/url/cluster beside it' })
  .optional();

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

  /**
   * The host is a Redis Cluster endpoint (`true`), or `{ nodes, options }`.
   */
  cluster: redisClusterSchema.optional(),

  // A config with a `url` belongs to redisUrlSchema; matching it here would drop the URL (#768).
  url: z.undefined().optional(),

  client: NO_CLIENT,
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

    /** The URL is a Redis Cluster endpoint (`true`), or `{ nodes, options }`. */
    cluster: redisClusterSchema.optional(),

    client: NO_CLIENT,
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
    const connection = { ...parsed, ...merge?.fillIns };
    const dbProblem = clusterDbProblem({ cluster: val.cluster, db: connection.db });
    if (dbProblem) {
      ctx.addIssue({ code: 'custom', message: dbProblem, path: ['url'] });
      return NEVER;
    }
    return {
      provider: 'redis' as const,
      ...connection,
      ...(val.cluster !== undefined ? { cluster: val.cluster } : {}),
      keyPrefix: val.keyPrefix,
      defaultTtlMs: val.defaultTtlMs,
    };
  });

/**
 * A Redis Cluster named by its seed nodes alone (`cluster: { nodes: [...] }`, no host or url).
 * Normalized to the host form, with the first seed node as `host`/`port`, so every consumer sees
 * one shape; the client is opened from all the seed nodes.
 */
export const redisClusterNodesSchema = z
  .object({
    provider: z.literal('redis').optional(),
    cluster: redisClusterConfigSchema.extend({ nodes: z.array(redisClusterNodeSchema).min(1) }),
    password: z.string().optional(),
    db: z.number().int().nonnegative().optional(),
    tls: z.boolean().optional(),
    host: z.undefined().optional(),
    port: z.undefined().optional(),
    url: z.undefined().optional(),
    client: NO_CLIENT,
  })
  .merge(commonOptionsSchema)
  .transform((val, ctx) => {
    const dbProblem = clusterDbProblem(val);
    if (dbProblem) {
      ctx.addIssue({ code: 'custom', message: dbProblem, path: ['db'] });
      return NEVER;
    }
    const [first] = val.cluster.nodes;
    const seed = typeof first === 'string' ? seedNodeAddress(first) : { host: first.host, port: first.port ?? 6379 };
    return {
      provider: 'redis' as const,
      host: seed.host,
      port: seed.port,
      ...(val.password !== undefined ? { password: val.password } : {}),
      db: 0,
      // A rediss:// seed means TLS for the whole cluster, so the parsed option says so too
      tls: val.tls ?? val.cluster.nodes.some((node) => typeof node === 'string' && /^rediss:\/\//i.test(node)),
      cluster: val.cluster,
      keyPrefix: val.keyPrefix,
      defaultTtlMs: val.defaultTtlMs,
    };
  });

/** The host and port a seed-node string names (`host:port`, `[ipv6]:port`, or a URL). */
function seedNodeAddress(node: string): { host: string; port: number } {
  const parsed = parseRedisUrl(node);
  if (typeof parsed !== 'string') return { host: parsed.host, port: parsed.port };
  const match = /^(?:\[([^\]]+)\]|([^:[\]]+))(?::(\d+))?$/.exec(node.trim());
  return { host: match?.[1] ?? match?.[2] ?? node, port: match?.[3] ? Number(match[3]) : 6379 };
}

/**
 * A Redis client the application made (`redis: { client }`): an ioredis `Redis` or `Cluster`, a
 * node-redis client or cluster, or a FrontMcpRedisClient. FrontMCP uses it and never closes it.
 * Nothing about the connection goes beside it.
 */
export const redisClientSchema = z
  .object({
    provider: z.literal('redis').optional(),
    client: z.custom<RedisClientInput>((value) => isRedisClientInput(value), {
      error: (issue) => redisClientProblem(issue.input) ?? UNSUPPORTED_REDIS_CLIENT_MESSAGE,
    }),
    host: z.undefined().optional(),
    port: z.undefined().optional(),
    password: z.undefined().optional(),
    db: z.undefined().optional(),
    tls: z.undefined().optional(),
    url: z.undefined().optional(),
    cluster: z.undefined().optional(),
  })
  .merge(commonOptionsSchema)
  .transform((val) => ({
    provider: 'redis' as const,
    client: val.client,
    keyPrefix: val.keyPrefix,
    defaultTtlMs: val.defaultTtlMs,
  }));

export type RedisClientProviderOptions = z.infer<typeof redisClientSchema>;

/** The input and branch errors a failed union reports, as far as its messages need them. */
interface UnionIssueLike {
  input?: unknown;
  errors?: ReadonlyArray<ReadonlyArray<{ code?: string; message?: string; path?: ReadonlyArray<PropertyKey> }>>;
}

/** A Redis server named by neither field, as when both come from unset variables. */
function lacksHostAndUrl(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const { host, url, provider } = input as Record<string, unknown>;
  return host === undefined && url === undefined && (provider === undefined || provider === 'redis');
}

/** The fields the branches refuse with a message of their own: `url`, and `db` beside a cluster. */
const OWN_MESSAGE_FIELDS = new Set<PropertyKey>(['url', 'db']);

/**
 * A union reports "Invalid input" when no branch matches, burying the reason a
 * `url` (or `client`, or a cluster's `db`) was refused among the other branches'
 * complaints about a missing `host`. Surface that branch's own message instead,
 * or what is missing.
 */
function redisUnionError(issue: UnionIssueLike): string | undefined {
  const input = (typeof issue.input === 'object' && issue.input !== null ? issue.input : {}) as Record<string, unknown>;
  if (input['client'] !== undefined) {
    const beside = ['host', 'port', 'password', 'db', 'tls', 'url', 'cluster'].filter(
      (field) => input[field] !== undefined,
    );
    if (beside.length > 0) return `redis.client carries its own connection; drop ${beside.join(', ')} beside it`;
    const problem = redisClientProblem(input['client']);
    if (problem) return problem;
  }
  for (const branch of issue.errors ?? []) {
    const own = branch.find((entry) => entry.code === 'custom' && OWN_MESSAGE_FIELDS.has(entry.path?.[0] ?? ''));
    if (own?.message) return own.message;
  }
  if (lacksHostAndUrl(issue.input) && input['cluster'] !== undefined && input['client'] === undefined) {
    return 'redis.cluster needs a node to start from: set host (or url), or cluster.nodes';
  }
  return lacksHostAndUrl(issue.input) ? 'redis needs host or url' : undefined;
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
export const redisOptionsSchema = z
  .union(
    [
      redisUrlSchema,
      redisClusterNodesSchema,
      redisProviderSchema,
      vercelKvProviderSchema,
      legacyRedisSchema,
      redisClientSchema,
    ],
    { error: redisUnionError },
  )
  .superRefine(refuseClusterDb);

/** A host config with `cluster` and a database other than 0. */
function refuseClusterDb(
  val: object,
  ctx: { addIssue: (issue: { code: 'custom'; message: string; path: string[] }) => void },
): void {
  const problem = clusterDbProblem(val as { cluster?: RedisClusterOption; db?: number });
  if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['db'] });
}

/**
 * Storage configuration type (with defaults applied)
 */
export type RedisOptions = z.infer<typeof redisOptionsSchema>;

/** A `redis` option in any form it takes, normalized as the server's config is, or the reason it cannot be used. */
export function normalizeRedisOptions(redis: unknown): RedisOptions | string {
  const parsed = redisOptionsSchema.safeParse(redis);
  return parsed.success ? parsed.data : parsed.error.issues.map((issue) => issue.message).join('; ');
}

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
export const pubsubOptionsSchema = z
  .union([redisUrlSchema, redisClusterNodesSchema, redisProviderSchema, legacyRedisSchema, redisClientSchema], {
    error: redisUnionError,
  })
  .superRefine(refuseClusterDb);

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
 * Check if options are for the Redis provider given by host, url or cluster seed nodes (the parsed
 * form always has `host`). False for a `client` config: use `isRedisConnection()` (from `@frontmcp/utils`, re-exported here) for any Redis.
 */
export function isRedisProvider(options: RedisOptions): options is RedisProviderOptions {
  return options.provider === 'redis' && !('client' in options && options.client !== undefined);
}

/**
 * Check if options are for Vercel KV provider
 */
export function isVercelKvProvider(options: RedisOptions | RedisOptionsInput): options is VercelKvProviderOptions {
  return 'provider' in options && options.provider === 'vercel-kv';
}

/**
 * Check if pub/sub options are valid Redis config
 */
export function isPubsubConfigured(
  options: PubsubOptions,
): options is RedisProviderOptions | RedisClientProviderOptions {
  return options.provider === 'redis';
}
