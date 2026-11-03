import { getRuntimeContext } from '@frontmcp/utils';

import { BrowserStoreUnavailableError, type BrowserRefusedStore } from '../errors';

/** The server's top-level `redis` and `sqlite`, which a store without one of its own takes. */
interface ServerBackends {
  redis?: unknown;
  sqlite?: unknown;
}

/** The server options that choose where background tasks and elicitation keep their state. */
export interface StoreOptions extends ServerBackends {
  tasks?: { enabled?: boolean; store?: false; redis?: unknown; sqlite?: unknown };
  elicitation?: { enabled?: boolean; store?: false; redis?: unknown };
}

/** Vercel KV, reached over HTTPS, is the one Redis option that needs no TCP socket. */
function isVercelKv(redis: unknown): boolean {
  return (redis as { provider?: unknown } | undefined)?.provider === 'vercel-kv';
}

/** The store's own Redis, else the server's: the option that names it, and its value. */
function redisOf(ownRedis: unknown, ownRedisOption: string, server: ServerBackends): [string, unknown] {
  return ownRedis ? [ownRedisOption, ownRedis] : ['redis', server.redis];
}

/** A Redis, else the server's SQLite, for a store that a Vercel KV stops (it has no pub/sub to run on). */
function redisElseSqlite([option, redis]: [string, unknown], server: ServerBackends): string | undefined {
  if (redis) return isVercelKv(redis) ? undefined : option;
  return server.sqlite ? 'sqlite' : undefined;
}

/** The option whose Redis or SQLite background tasks would open. */
export function tasksServerStore(options: StoreOptions): string | undefined {
  const { tasks } = options;
  if (tasks?.enabled === false || tasks?.store === false) return undefined;
  if (tasks?.sqlite) return 'tasks.sqlite';
  return redisElseSqlite(redisOf(tasks?.redis, 'tasks.redis', options), options);
}

/** The option whose Redis or SQLite elicitation would open. */
export function elicitationServerStore(options: StoreOptions): string | undefined {
  const { elicitation } = options;
  if (!elicitation?.enabled || elicitation.store === false) return undefined;
  return redisElseSqlite(redisOf(elicitation.redis, 'elicitation.redis', options), options);
}

/** In a browser, refuse the stores that would open Redis or SQLite, each named with the option that brings it in. */
export function refuseServerStoresInBrowser(
  stores: Partial<Record<BrowserRefusedStore, string | undefined>>,
  runtime = getRuntimeContext().runtime,
): void {
  if (runtime !== 'browser') return;
  const refused = (Object.entries(stores) as Array<[BrowserRefusedStore, string | undefined]>).filter(
    (entry): entry is [BrowserRefusedStore, string] => entry[1] !== undefined,
  );
  if (refused.length > 0) throw new BrowserStoreUnavailableError(refused);
}
