import { z } from 'zod';
import { Redis as RedisClient } from 'ioredis';

// ─────────────────────────────────────────────────────────────────────────────
// Memory Scopes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Memory scope determines the visibility and lifetime of stored data.
 */
export type RememberScope = 'session' | 'user' | 'tool' | 'global';

/**
 * Zod schema for RememberScope validation.
 */
export const rememberScopeSchema = z.enum(['session', 'user', 'tool', 'global']);

// ─────────────────────────────────────────────────────────────────────────────
// Branded Payload Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Brand symbol for compile-time type discrimination.
 */
declare const PayloadBrand: unique symbol;

/**
 * Branded type for memory payloads.
 * Provides compile-time safety for different payload purposes.
 */
export type BrandedPayload<T, Brand extends string> = T & {
  readonly [PayloadBrand]: Brand;
};

/** Approval payload - Tool approval state */
export type ApprovalPayload<T = unknown> = BrandedPayload<T, 'approval'>;

/** Preference payload - User preferences */
export type PreferencePayload<T = unknown> = BrandedPayload<T, 'preference'>;

/** Cache payload - Cached data */
export type CachePayload<T = unknown> = BrandedPayload<T, 'cache'>;

/** State payload - Application state */
export type StatePayload<T = unknown> = BrandedPayload<T, 'state'>;

/** Conversation payload - Conversation history/context */
export type ConversationPayload<T = unknown> = BrandedPayload<T, 'conversation'>;

/** Custom payload - Developer-defined data */
export type CustomPayload<T = unknown> = BrandedPayload<T, 'custom'>;

/**
 * Helper to create a branded payload at runtime.
 * The brand is stored in metadata, not on the value itself.
 */
export function brand<T, B extends string>(data: T, _brand: B): BrandedPayload<T, B> {
  return data as BrandedPayload<T, B>;
}

/**
 * All supported payload brands.
 */
export type PayloadBrandType = 'approval' | 'preference' | 'cache' | 'state' | 'conversation' | 'custom';

// ─────────────────────────────────────────────────────────────────────────────
// Memory Entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stored entry with metadata.
 */
export interface RememberEntry<T = unknown> {
  /** The stored value */
  value: T;

  /** Payload brand for type discrimination */
  brand?: PayloadBrandType;

  /** When the entry was created */
  createdAt: number;

  /** When the entry was last updated */
  updatedAt: number;

  /** When the entry expires (timestamp) */
  expiresAt?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Zod schema for RememberEntry validation.
 */
export const rememberEntrySchema = z.object({
  value: z.unknown(),
  brand: z.enum(['approval', 'preference', 'cache', 'state', 'conversation', 'custom']).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  expiresAt: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base options for all plugin configurations.
 */
export interface BaseRememberPluginOptions {
  /** Default TTL in seconds for entries without explicit TTL */
  defaultTTL?: number;

  /** Key prefix for all storage keys */
  keyPrefix?: string;

  /** Encryption configuration */
  encryption?: {
    /** Whether encryption is enabled (default: true) */
    enabled?: boolean;
    /** Custom encryption key (overrides derived keys) */
    customKey?: string;
  };

  /** LLM tools configuration */
  tools?: {
    /** Whether to expose tools to LLM (default: false) */
    enabled?: boolean;
    /** Restrict which scopes tools can access */
    allowedScopes?: RememberScope[];
    /** Tool name prefix (default: none) */
    prefix?: string;
  };

  /** Approval system configuration */
  approval?: {
    /** Whether approval system is enabled (default: false) */
    enabled?: boolean;
  };
}

/**
 * In-memory storage options.
 */
export interface MemoryRememberPluginOptions extends BaseRememberPluginOptions {
  type: 'memory';
}

/**
 * Redis storage options with connection config.
 */
export interface RedisRememberPluginOptions extends BaseRememberPluginOptions {
  type: 'redis';
  config: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
}

/**
 * Redis storage options with existing client.
 */
export interface RedisClientRememberPluginOptions extends BaseRememberPluginOptions {
  type: 'redis-client';
  client: RedisClient;
}

/**
 * Vercel KV storage options.
 */
export interface VercelKvRememberPluginOptions extends BaseRememberPluginOptions {
  type: 'vercel-kv';
  /** Vercel KV URL (defaults to KV_REST_API_URL env var) */
  url?: string;
  /** Vercel KV token (defaults to KV_REST_API_TOKEN env var) */
  token?: string;
}

/**
 * Global store configuration from @FrontMcp decorator.
 * Uses the redis/vercel-kv config from main FrontMcp options.
 */
export interface GlobalStoreRememberPluginOptions extends BaseRememberPluginOptions {
  type: 'global-store';
}

/**
 * Union of all plugin options types.
 */
export type RememberPluginOptions =
  | MemoryRememberPluginOptions
  | RedisRememberPluginOptions
  | RedisClientRememberPluginOptions
  | VercelKvRememberPluginOptions
  | GlobalStoreRememberPluginOptions;

/**
 * Input type for plugin initialization (allows partial options).
 */
export type RememberPluginOptionsInput = Partial<RememberPluginOptions> & {
  type?: RememberPluginOptions['type'];
};

// ─────────────────────────────────────────────────────────────────────────────
// Accessor Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the set() method.
 */
export interface RememberSetOptions {
  /** Memory scope (default: 'session') */
  scope?: RememberScope;
  /** Time-to-live in seconds */
  ttl?: number;
  /** Payload brand for type discrimination */
  brand?: PayloadBrandType;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for the get() method.
 */
export interface RememberGetOptions<T = unknown> {
  /** Memory scope (default: 'session') */
  scope?: RememberScope;
  /** Default value if key doesn't exist */
  defaultValue?: T;
}

/**
 * Options for the forget() method.
 */
export interface RememberForgetOptions {
  /** Memory scope (default: 'session') */
  scope?: RememberScope;
}

/**
 * Options for the knows() method.
 */
export interface RememberKnowsOptions {
  /** Memory scope (default: 'session') */
  scope?: RememberScope;
}

/**
 * Options for the list() method.
 */
export interface RememberListOptions {
  /** Memory scope (default: 'session') */
  scope?: RememberScope;
  /** Pattern to filter keys (glob-style) */
  pattern?: string;
}
