import { InternalMcpError } from './mcp.error';

const STORES = {
  tasks: { what: 'background tasks', memory: 'tasks.store: false' },
  elicitation: { what: 'elicitation', memory: 'elicitation.store: false' },
  questions: { what: 'persistent questions', memory: "elicitation.persistent.storage: { type: 'memory' }" },
  jobs: { what: 'jobs', memory: 'jobs.store: false' },
  rateLimits: { what: 'rate limits', memory: "throttle.storage: { type: 'memory' }" },
  authTokens: { what: 'auth tokens', memory: "auth.tokenStorage: 'memory'" },
  skillsCache: { what: 'the skills HTTP cache', memory: 'a skillsConfig.cache without redis' },
  resourceStore: { what: 'a resource store', memory: "storage: { type: 'memory' }" },
  sqliteStorage: { what: 'a storage provider', memory: 'a provider of createMemoryStorage()' },
} as const;

/** A store of the SDK's own that a browser refuses. */
export type SdkBrowserStore = keyof typeof STORES;

/** A store a browser refuses: one of the SDK's, or a plugin's, by its name. */
export type BrowserRefusedStore = SdkBrowserStore | (string & {});

function isSdkStore(store: string): store is SdkBrowserStore {
  return Object.hasOwn(STORES, store);
}

function refusal(
  [store, option]: readonly [BrowserRefusedStore, string],
  pluginMemory: Readonly<Record<string, string>>,
): string {
  const sdkStore = !Object.hasOwn(pluginMemory, store) && isSdkStore(store) ? STORES[store] : undefined;
  const { what, memory } = sdkStore ?? { what: store, memory: pluginMemory[store] };
  if (memory === undefined) return `${what} would use ${option}`;
  if (option === 'redis' || option === 'sqlite') {
    return `${what} would use the top-level ${option} (set ${memory} for memory, or leave ${option} out of the browser build)`;
  }
  return `${what} would use ${option} (set ${memory} in place of ${option})`;
}

/** Thrown at startup in a browser for the stores that would open Redis or SQLite: it has no TCP socket and no file. */
export class BrowserStoreUnavailableError extends InternalMcpError {
  readonly stores: ReadonlyArray<readonly [BrowserRefusedStore, string]>;

  constructor(stores: ReadonlyArray<readonly [SdkBrowserStore, string]>);
  /** `pluginMemory` gives each plugin's store the plugin option that keeps it in memory. */
  constructor(
    stores: ReadonlyArray<readonly [BrowserRefusedStore, string]>,
    pluginMemory: Readonly<Record<string, string>>,
  );
  constructor(
    stores: ReadonlyArray<readonly [BrowserRefusedStore, string]>,
    pluginMemory: Readonly<Record<string, string>> = {},
  ) {
    super(
      `A browser cannot open Redis or SQLite: ${stores.map((store) => refusal(store, pluginMemory)).join('; ')}`,
      'BROWSER_STORE_UNAVAILABLE',
    );
    this.stores = stores;
  }
}
