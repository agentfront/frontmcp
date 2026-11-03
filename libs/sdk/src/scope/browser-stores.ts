import { getMetadata, isClass } from '@frontmcp/di';
import { getRuntimeContext } from '@frontmcp/utils';

import { initOptionsOf, type PluginStoreInBrowser, type PluginStoreServer } from '../common/dynamic/dynamic.plugin';
import type { AppType, PluginType } from '../common/interfaces';
import { FrontMcpLocalAppTokens } from '../common/tokens';
import type { RedisOptionsInput } from '../common/types/options/redis';
import { BrowserStoreUnavailableError, type BrowserRefusedStore } from '../errors';
import type { JobsStoreConfig } from '../job/job-scope.helper';

export type { PluginStoreInBrowser } from '../common/dynamic/dynamic.plugin';

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

/** Every server option a browser checks at startup: the stores' and the plugins' that declare theirs. */
export interface BrowserStoreOptions extends StoreOptions {
  redis?: RedisOptionsInput;
  elicitation?: StoreOptions['elicitation'] & { persistent?: unknown };
  jobs?: { enabled?: boolean; store?: JobsStoreConfig | false };
  throttle?: { enabled?: boolean; storage?: { type?: string } };
  auth?: object;
  skillsConfig?: { cache?: { enabled?: boolean; redis?: { provider?: string } } };
  plugins?: readonly PluginType[];
  apps?: readonly AppType[];
  jobTypes?: readonly unknown[];
  workflowTypes?: readonly unknown[];
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

async function questionsStore(options: BrowserStoreOptions): Promise<string | undefined> {
  const { elicitation } = options;
  if (!elicitation?.enabled || !elicitation.persistent) return undefined;
  const questions = await import('../elicitation/questions/question-scope.helper.js');
  const { storage } = questions.persistentQuestionsSettings(elicitation.persistent, false);
  return questions.questionsServerStore(storage, options);
}

/** What the server's class apps declare under `token`. */
function declaredOnApps(options: BrowserStoreOptions, token: (typeof FrontMcpLocalAppTokens)['plugins']): unknown[] {
  return (options.apps ?? []).flatMap((app) => (isClass(app) ? (getMetadata(token, app) ?? []) : []));
}

async function jobsStore(options: BrowserStoreOptions): Promise<string | undefined> {
  const { jobs } = options;
  const declared = [
    ...(options.jobTypes ?? []),
    ...(options.workflowTypes ?? []),
    ...declaredOnApps(options, FrontMcpLocalAppTokens.jobs),
    ...declaredOnApps(options, FrontMcpLocalAppTokens.workflows),
  ];
  if (jobs?.enabled === false || (jobs?.enabled !== true && declared.length === 0)) return undefined;
  const { jobsServerStore } = await import('../job/job-scope.helper.js');
  return jobsServerStore(jobs?.store, options);
}

/** The scope builds its guard on `throttle.storage` with throttle on, and with it off for `auth.publicAccess.rateLimit`. */
function rateLimitsStore({ throttle, auth }: BrowserStoreOptions): string | undefined {
  const publicAccess = (auth as { publicAccess?: { rateLimit?: unknown } } | undefined)?.publicAccess;
  // An app's own auth can arrive before its schema defaults `publicAccess.rateLimit` to 60
  const publicRateLimited = publicAccess !== undefined && publicAccess.rateLimit !== 0;
  const type = throttle?.enabled || publicRateLimited ? throttle?.storage?.type : undefined;
  return type === 'redis' || type === 'sqlite' ? `throttle.storage: { type: '${type}' }` : undefined;
}

/** The backing an `auth` store setting names on Redis or SQLite. */
function authStore({ auth }: BrowserStoreOptions, setting: 'tokenStorage' | 'secureStore'): string | undefined {
  const value: unknown = auth && setting in auth ? (auth as Record<string, unknown>)[setting] : undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const { redis, sqlite } = value as { redis?: unknown; sqlite?: unknown };
  if (redis !== undefined) return `auth.${setting}.redis`;
  return sqlite !== undefined ? `auth.${setting}.sqlite` : undefined;
}

function skillsCacheStore({ skillsConfig }: BrowserStoreOptions): string | undefined {
  const cache = skillsConfig?.cache;
  return cache?.enabled && cache.redis?.provider === 'redis' ? 'skillsConfig.cache.redis' : undefined;
}

type StoresDeclaration = (options: unknown, server: PluginStoreServer) => readonly PluginStoreInBrowser[];

/** The stores a plugin declares (`static browserStores`) for these options. */
export function declaredPluginStores(
  plugin: unknown,
  options: unknown,
  server: PluginStoreServer,
): readonly PluginStoreInBrowser[] {
  const declare = (plugin as { browserStores?: StoresDeclaration } | undefined)?.browserStores;
  return typeof declare === 'function' ? declare.call(plugin, options, server) : [];
}

/**
 * The stores a listed plugin declares: one listed as its class takes `{}`, and an `init(options)` record its options. A
 * factory's options are not known yet: its registry refuses its stores when it has built them.
 */
function listedPluginStores(item: PluginType, server: PluginStoreServer): readonly PluginStoreInBrowser[] {
  if (isClass(item)) return declaredPluginStores(item, {}, server);
  const { provide, useClass, useValue } = item as { provide?: unknown; useClass?: unknown; useValue?: unknown };
  if (useClass) return declaredPluginStores(useClass, {}, server);
  const init = typeof useValue === 'object' && useValue !== null ? initOptionsOf(useValue) : undefined;
  return init ? declaredPluginStores(provide, init.options, server) : [];
}

function refusal(
  stores: ReadonlyArray<readonly [BrowserRefusedStore, string | undefined]>,
  plugins: readonly PluginStoreInBrowser[],
): BrowserStoreUnavailableError | undefined {
  const refused = [
    ...stores,
    ...plugins.map(({ plugin, option }): readonly [BrowserRefusedStore, string | undefined] => [plugin, option]),
  ].filter((entry): entry is readonly [BrowserRefusedStore, string] => entry[1] !== undefined);
  if (refused.length === 0) return undefined;
  return new BrowserStoreUnavailableError(
    refused,
    Object.fromEntries(plugins.map(({ plugin, memory }) => [plugin, memory])),
  );
}

/**
 * In a browser, refuse at startup, in one error, every store the server would open on Redis or SQLite: its own and the
 * ones the plugins of the server and of its class apps declare.
 */
export async function refuseStoresInBrowser(
  options: BrowserStoreOptions,
  runtime = getRuntimeContext().runtime,
): Promise<void> {
  if (runtime !== 'browser') return;
  const listed = [
    ...(options.plugins ?? []),
    ...(declaredOnApps(options, FrontMcpLocalAppTokens.plugins) as PluginType[]),
  ];
  const plugins = listed.flatMap((item) => listedPluginStores(item, options));
  const error = refusal(
    [
      ['tasks', tasksServerStore(options)],
      ['elicitation', elicitationServerStore(options)],
      ['questions', await questionsStore(options)],
      ['jobs', await jobsStore(options)],
      ['rateLimits', rateLimitsStore(options)],
      ['authTokens', authStore(options, 'tokenStorage')],
      ['secureStore', authStore(options, 'secureStore')],
      ['skillsCache', skillsCacheStore(options)],
    ],
    plugins,
  );
  if (error) throw error;
}

/** In a browser, refuse the stores that would open Redis or SQLite, each named with the option that brings it in. */
export function refuseServerStoresInBrowser(
  stores: Partial<Record<BrowserRefusedStore, string | undefined>>,
  runtime = getRuntimeContext().runtime,
): void {
  if (runtime !== 'browser') return;
  const error = refusal(Object.entries(stores), []);
  if (error) throw error;
}

/** In a browser, refuse a plugin's store that would open Redis or SQLite: call it where the plugin builds the store. */
export function refusePluginStoreInBrowser(store: PluginStoreInBrowser, runtime = getRuntimeContext().runtime): void {
  refusePluginStoresInBrowser([store], runtime);
}

/** In a browser, refuse the plugin stores that would open Redis or SQLite. */
export function refusePluginStoresInBrowser(
  stores: readonly PluginStoreInBrowser[],
  runtime = getRuntimeContext().runtime,
): void {
  if (runtime !== 'browser') return;
  const error = refusal([], stores);
  if (error) throw error;
}
