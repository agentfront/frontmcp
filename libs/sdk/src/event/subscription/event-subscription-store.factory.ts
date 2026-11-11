import {
  createStorage,
  getEnv,
  type RootStorage,
  type SqliteAdapterOptions,
  type StorageConfig,
} from '@frontmcp/utils';

import { isRedisProvider, type FrontMcpLogger, type RedisOptions } from '../../common';
import { EventSubscriptionStoreError } from '../../errors';
import { StorageEventSubscriptionStore, type EventSubscriptionStore } from './event-subscription.store';

export type EventSubscriptionStoreType = 'memory' | 'redis' | 'sqlite';

export interface EventSubscriptionStoreOptions {
  /** `events.store.redis`. */
  redis?: RedisOptions;
  /** `events.store.sqlite`. */
  sqlite?: SqliteAdapterOptions;
  /** @default 'mcp:events:' */
  keyPrefix?: string;
  /** Encrypts stored subscriptions. By default `MCP_EVENTS_SECRET`, else `MCP_SESSION_SECRET`, else `MCP_SERVER_SECRET`. */
  secret?: string;
  logger?: FrontMcpLogger;
}

export interface EventSubscriptionStoreResult {
  store: EventSubscriptionStore;
  type: EventSubscriptionStoreType;
  /** Whether subscriptions outlive the process: Redis and SQLite do, memory does not. */
  durable: boolean;
  encrypted: boolean;
  /** The storage the store owns; the outbox keeps its records in it too. */
  storage: RootStorage;
  /** The secret records are encrypted with, for the outbox to encrypt its own. Never log it. */
  secret?: string;
}

/** The secret stored subscriptions are encrypted with, from the environment. */
function eventsSecretFromEnv(): string | undefined {
  return getEnv('MCP_EVENTS_SECRET') || getEnv('MCP_SESSION_SECRET') || getEnv('MCP_SERVER_SECRET') || undefined;
}

/** The storage config of the backend the options name: SQLite, else Redis, else memory. */
function storageConfigOf(options: EventSubscriptionStoreOptions): StorageConfig & { type: EventSubscriptionStoreType } {
  const { redis, sqlite } = options;
  if (sqlite) return { type: 'sqlite', sqlite };
  if (!redis) return { type: 'memory' };
  if (!isRedisProvider(redis)) {
    throw new EventSubscriptionStoreError(
      'Vercel KV has no atomic compare-and-set, which subscription updates need. ' +
        'Use a Redis server in events.store.redis, or events.store.sqlite.',
    );
  }
  const { host, port, password, db, tls } = redis;
  return { type: 'redis', redis: { config: { host, port, password, db, tls } } };
}

/** Open the subscription store: memory by default, `events.store.redis` or `events.store.sqlite` when configured. */
export async function createEventSubscriptionStore(
  options: EventSubscriptionStoreOptions = {},
): Promise<EventSubscriptionStoreResult> {
  const { keyPrefix = 'mcp:events:', logger } = options;
  const config = storageConfigOf(options);
  const durable = config.type !== 'memory';
  const secret = options.secret ?? eventsSecretFromEnv();
  if (durable && !secret) {
    throw new EventSubscriptionStoreError(
      `the ${config.type} store keeps webhook signing secrets, so it needs a secret to encrypt them with: ` +
        'set MCP_EVENTS_SECRET (or MCP_SESSION_SECRET / MCP_SERVER_SECRET).',
    );
  }

  let storage: RootStorage;
  try {
    storage = await createStorage({ ...config, prefix: keyPrefix, fallback: 'error' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new EventSubscriptionStoreError(`the ${config.type} store cannot be opened: ${reason}`);
  }

  logger?.info('Event subscriptions are stored', { type: config.type, encrypted: secret !== undefined });
  return {
    store: new StorageEventSubscriptionStore({ storage, secret }),
    type: config.type,
    durable,
    encrypted: secret !== undefined,
    storage,
    secret,
  };
}
