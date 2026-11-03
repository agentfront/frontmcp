import { InternalMcpError } from './mcp.error';

/** A store a browser refuses, and the option that keeps it in memory. */
export type BrowserRefusedStore = 'tasks' | 'elicitation' | 'questions' | 'jobs';

const STORES: Record<BrowserRefusedStore, { what: string; memory: string }> = {
  tasks: { what: 'background tasks', memory: 'tasks.store: false' },
  elicitation: { what: 'elicitation', memory: 'elicitation.store: false' },
  questions: { what: 'persistent questions', memory: "elicitation.persistent.storage: { type: 'memory' }" },
  jobs: { what: 'jobs', memory: 'jobs.store: false' },
};

function refusal([store, option]: readonly [BrowserRefusedStore, string]): string {
  const { what, memory } = STORES[store];
  if (option === 'redis' || option === 'sqlite') {
    return `${what} would use the top-level ${option} (set ${memory} for memory, or leave ${option} out of the browser build)`;
  }
  return `${what} would use ${option} (set ${memory} in place of ${option})`;
}

/** Thrown at startup in a browser for the stores that would open Redis or SQLite: it has no TCP socket and no file. */
export class BrowserStoreUnavailableError extends InternalMcpError {
  readonly stores: ReadonlyArray<readonly [BrowserRefusedStore, string]>;

  constructor(stores: ReadonlyArray<readonly [BrowserRefusedStore, string]>) {
    super(`A browser cannot open Redis or SQLite: ${stores.map(refusal).join('; ')}`, 'BROWSER_STORE_UNAVAILABLE');
    this.stores = stores;
  }
}
