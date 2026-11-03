import { InternalMcpError } from './mcp.error';

/** A store a browser refuses: background tasks, elicitation, persistent questions, jobs, or a plugin's, by its name. */
export type BrowserRefusedStore = 'tasks' | 'elicitation' | 'questions' | 'jobs' | (string & {});

const STORES: Readonly<Record<string, { what: string; memory: string } | undefined>> = {
  tasks: { what: 'background tasks', memory: 'tasks.store: false' },
  elicitation: { what: 'elicitation', memory: 'elicitation.store: false' },
  questions: { what: 'persistent questions', memory: "elicitation.persistent.storage: { type: 'memory' }" },
  jobs: { what: 'jobs', memory: 'jobs.store: false' },
};

function refusal(
  [store, option]: readonly [BrowserRefusedStore, string],
  pluginMemory: Readonly<Record<string, string>>,
): string {
  const sdkStore = Object.hasOwn(pluginMemory, store) ? undefined : STORES[store];
  const { what, memory } = sdkStore ?? { what: store, memory: pluginMemory[store] };
  if (option === 'redis' || option === 'sqlite') {
    return `${what} would use the top-level ${option} (set ${memory} for memory, or leave ${option} out of the browser build)`;
  }
  return `${what} would use ${option} (set ${memory} in place of ${option})`;
}

/** Thrown at startup in a browser for the stores that would open Redis or SQLite: it has no TCP socket and no file. */
export class BrowserStoreUnavailableError extends InternalMcpError {
  readonly stores: ReadonlyArray<readonly [BrowserRefusedStore, string]>;

  /** `pluginMemory` gives each plugin's store the plugin option that keeps it in memory. */
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
