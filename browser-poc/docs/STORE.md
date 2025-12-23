# Store (Valtio)

Framework-agnostic reactive state management with MCP integration.

> **Security Notice**: The `store-set` tool allows mutations without authorization by default. See [SECURITY.md](./SECURITY.md#store-authorization) for implementing mutation guards.

## Why Valtio?

| Feature            | Benefit                                       |
| ------------------ | --------------------------------------------- |
| Proxy-based        | Automatic change detection, no actions needed |
| Framework-agnostic | Works with React, Vue, Svelte, vanilla JS     |
| Tiny bundle        | ~1KB gzipped                                  |
| TypeScript         | Full type inference                           |
| Devtools           | Built-in debugging support                    |

## Core Concepts

### Proxy State

Valtio uses JavaScript Proxy to track mutations:

```typescript
import { proxy } from 'valtio';

const state = proxy({ count: 0, user: null });

// Mutations are tracked automatically
state.count++; // Triggers subscribers
state.user = { name: 'Alice' }; // Triggers subscribers
```

### Snapshots

Immutable snapshots for rendering:

```typescript
import { snapshot } from 'valtio';

const snap = snapshot(state);
console.log(snap.count); // Read-only, won't trigger re-renders on access
```

### Subscriptions

React to changes:

```typescript
import { subscribe } from 'valtio';

// Subscribe to all changes
const unsubscribe = subscribe(state, () => {
  console.log('State changed:', snapshot(state));
});

// Subscribe to specific key
import { subscribeKey } from 'valtio/utils';
subscribeKey(state, 'count', (value) => {
  console.log('Count changed:', value);
});
```

---

## MCP Store Wrapper

### Interface

```typescript
interface McpStore<T extends object> {
  /**
   * The Valtio proxy state (mutable)
   */
  state: T;

  /**
   * Get immutable snapshot
   */
  getSnapshot(): T;

  /**
   * Subscribe to all changes
   */
  subscribe(callback: () => void): () => void;

  /**
   * Subscribe to specific key
   */
  subscribeKey<K extends keyof T>(key: K, callback: (value: T[K]) => void): () => void;

  /**
   * Subscribe with mutation operations info
   * Used for MCP notifications
   */
  onMutation(callback: (ops: MutationOperation[]) => void): () => void;
}

interface MutationOperation {
  type: 'set' | 'delete';
  path: string[];
  value?: unknown;
}
```

### Implementation

```typescript
import { proxy, subscribe, snapshot } from 'valtio';
import { subscribeKey } from 'valtio/utils';

export function createMcpStore<T extends object>(initial: T): McpStore<T> {
  const state = proxy(initial);

  return {
    state,

    getSnapshot() {
      return snapshot(state) as T;
    },

    subscribe(callback) {
      return subscribe(state, callback);
    },

    subscribeKey(key, callback) {
      return subscribeKey(state, key, callback);
    },

    onMutation(callback) {
      // Subscribe with ops parameter (second arg = true)
      return subscribe(
        state,
        (ops) => {
          callback(ops as MutationOperation[]);
        },
        true,
      );
    },
  };
}
```

---

## MCP Integration

### Store as MCP Resources

The store exposes values as MCP resources:

```typescript
// Resource URI pattern
store://{key}           // Single value
store://{key}/{subkey}  // Nested value

// Example URIs
store://count           // state.count
store://user            // state.user
store://user/name       // state.user.name
store://settings/theme  // state.settings.theme
```

### Resource Implementation

```typescript
@Resource({
  uri: 'store://{path}',
  name: 'Store Value',
  description: 'Access a value from the reactive store',
})
class StoreResource extends ResourceEntry {
  constructor(private store: McpStore<unknown>) {}

  async read(ctx: ResourceContext) {
    const path = ctx.params.path.split('/');
    let value = this.store.getSnapshot();

    for (const key of path) {
      value = value?.[key];
    }

    return {
      contents: [
        {
          uri: ctx.uri,
          mimeType: 'application/json',
          text: JSON.stringify(value),
        },
      ],
    };
  }
}
```

### Store Mutation Tool

```typescript
@Tool({
  name: 'store-set',
  description: 'Set a value in the reactive store',
  inputSchema: z.object({
    path: z.string().describe('Dot-separated path (e.g., "user.name")'),
    value: z.unknown().describe('Value to set'),
  }),
})
class StoreSetTool extends ToolEntry {
  constructor(private store: McpStore<unknown>) {}

  async execute(ctx: ToolContext) {
    const { path, value } = ctx.input;
    const keys = path.split('.');

    let target = this.store.state;
    for (let i = 0; i < keys.length - 1; i++) {
      target = target[keys[i]];
    }

    target[keys[keys.length - 1]] = value;

    return { success: true, path, value };
  }
}
```

### MCP Notifications on Change

```typescript
function setupStoreNotifications(store: McpStore<unknown>, notificationService: NotificationService) {
  store.onMutation((ops) => {
    for (const op of ops) {
      const uri = `store://${op.path.join('/')}`;

      notificationService.broadcast({
        method: 'notifications/resources/updated',
        params: { uri },
      });
    }
  });
}
```

---

## Persistence

### IndexedDB Adapter

```typescript
interface PersistenceOptions {
  /**
   * Database name
   */
  name: string;

  /**
   * Store name within database
   */
  storeName?: string;

  /**
   * Keys to persist (default: all)
   */
  include?: string[];

  /**
   * Keys to exclude from persistence
   */
  exclude?: string[];

  /**
   * Debounce writes (ms)
   * @default 100
   */
  debounce?: number;
}

async function createPersistedStore<T extends object>(initial: T, options: PersistenceOptions): Promise<McpStore<T>> {
  const db = await openDB(options.name, 1, {
    upgrade(db) {
      db.createObjectStore(options.storeName ?? 'state');
    },
  });

  // Load persisted state
  const persisted = await db.get(options.storeName ?? 'state', 'root');
  const merged = { ...initial, ...persisted };

  const store = createMcpStore(merged);

  // Persist on changes (debounced)
  let timeout: number;
  store.subscribe(() => {
    clearTimeout(timeout);
    timeout = setTimeout(async () => {
      const snap = store.getSnapshot();
      await db.put(options.storeName ?? 'state', snap, 'root');
    }, options.debounce ?? 100);
  });

  return store;
}
```

### localStorage Adapter (Simple)

```typescript
function createLocalStorageStore<T extends object>(key: string, initial: T): McpStore<T> {
  // Load from localStorage
  const saved = localStorage.getItem(key);
  const merged = saved ? { ...initial, ...JSON.parse(saved) } : initial;

  const store = createMcpStore(merged);

  // Save on changes
  store.subscribe(() => {
    localStorage.setItem(key, JSON.stringify(store.getSnapshot()));
  });

  return store;
}
```

---

## Framework Usage

### Vanilla JavaScript

```typescript
import { createMcpStore } from '@frontmcp/browser';

const store = createMcpStore({
  count: 0,
  user: null,
  todos: [],
});

// Subscribe to changes
store.subscribe(() => {
  document.getElementById('count').textContent = store.state.count;
});

// Mutate directly
document.getElementById('increment').onclick = () => {
  store.state.count++;
};
```

### React

```typescript
import { useSnapshot } from 'valtio/react';

function Counter() {
  // useSnapshot creates reactive binding
  const snap = useSnapshot(store.state);

  return <button onClick={() => store.state.count++}>Count: {snap.count}</button>;
}
```

### Vue

```typescript
import { useSnapshot } from 'valtio/vue';

const snap = useSnapshot(store.state);

// In template
// <button @click="store.state.count++">{{ snap.count }}</button>
```

### Svelte

```typescript
import { snapshot, subscribe } from 'valtio';
import { readable } from 'svelte/store';

// Create Svelte store from Valtio
const svelteStore = readable(snapshot(store.state), (set) => {
  return subscribe(store.state, () => set(snapshot(store.state)));
});

// In component
// $: count = $svelteStore.count
```

---

## Advanced Patterns

### Derived State

```typescript
import { derive } from 'valtio/utils';

const state = proxy({
  firstName: 'John',
  lastName: 'Doe',
});

// Derived value (computed)
derive(
  {
    fullName: (get) => `${get(state).firstName} ${get(state).lastName}`,
  },
  { proxy: state },
);

console.log(state.fullName); // 'John Doe'
```

### Actions (Optional Pattern)

```typescript
const store = createMcpStore({
  count: 0,
  loading: false,
  error: null,
});

// Actions are just functions that mutate state
const actions = {
  increment() {
    store.state.count++;
  },

  async fetchData() {
    store.state.loading = true;
    try {
      const data = await api.getData();
      store.state.data = data;
    } catch (e) {
      store.state.error = e.message;
    } finally {
      store.state.loading = false;
    }
  },
};
```

### Undo/Redo

```typescript
import { proxyWithHistory } from 'valtio/utils';

const state = proxyWithHistory({ count: 0 });

state.value.count++; // count = 1
state.value.count++; // count = 2

state.undo(); // count = 1
state.redo(); // count = 2
```

---

## File Structure

```
browser-poc/src/store/
├── valtio-store.ts             # McpStore wrapper
├── store.types.ts              # TypeScript interfaces
├── mcp-integration.ts          # Resource/Tool implementations
├── persistence/
│   ├── indexed-db.ts           # IndexedDB adapter
│   └── local-storage.ts        # localStorage adapter
└── index.ts                    # Barrel exports
```

---

## Testing

```typescript
describe('McpStore', () => {
  it('should create proxy state');
  it('should return immutable snapshots');
  it('should notify subscribers on mutation');
  it('should track mutation paths');
});

describe('MCP Integration', () => {
  it('should expose state as resources');
  it('should allow mutations via tools');
  it('should broadcast notifications on change');
});

describe('Persistence', () => {
  it('should load state from IndexedDB');
  it('should save state on changes');
  it('should debounce writes');
});
```

---

## Storage Limits

### Browser Storage Quotas

| Storage        | Typical Limit | Notes                      |
| -------------- | ------------- | -------------------------- |
| localStorage   | ~5 MB         | Per origin, synchronous    |
| sessionStorage | ~5 MB         | Per tab, cleared on close  |
| IndexedDB      | ~50 MB - 2 GB | Per origin, browser varies |
| Cache API      | Varies        | Part of storage quota      |

### Checking Available Space

```typescript
async function checkStorageQuota(): Promise<{
  usage: number;
  quota: number;
  percentUsed: number;
}> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const { usage, quota } = await navigator.storage.estimate();
    return {
      usage: usage ?? 0,
      quota: quota ?? 0,
      percentUsed: quota ? ((usage ?? 0) / quota) * 100 : 0,
    };
  }
  return { usage: 0, quota: 0, percentUsed: 0 };
}

// Usage
const { usage, quota, percentUsed } = await checkStorageQuota();
console.log(
  `Using ${(usage / 1024 / 1024).toFixed(2)} MB of ${(quota / 1024 / 1024).toFixed(2)} MB (${percentUsed.toFixed(1)}%)`,
);
```

### Requesting Persistent Storage

```typescript
async function requestPersistentStorage(): Promise<boolean> {
  if ('storage' in navigator && 'persist' in navigator.storage) {
    const isPersisted = await navigator.storage.persist();
    return isPersisted;
  }
  return false;
}

// Persistent storage won't be evicted under storage pressure
await requestPersistentStorage();
```

### Handling Quota Exceeded

```typescript
async function safeStorageWrite<T>(store: McpStore<T>, onQuotaExceeded?: () => void): Promise<void> {
  try {
    await persistStore(store);
  } catch (error) {
    if (error.name === 'QuotaExceededError') {
      console.warn('Storage quota exceeded');
      onQuotaExceeded?.();
      // Consider: Clear old data, compress, or warn user
    }
    throw error;
  }
}
```

### Safari Private Mode Handling

**⚠️ CRITICAL: Safari Private Mode Limitation**

Safari's private browsing mode throws `QuotaExceededError` immediately when attempting to use IndexedDB, even for small amounts of data. This affects all Safari private windows and tabs.

**Detection and Fallback:**

```typescript
/**
 * Detects Safari private mode by attempting IndexedDB write.
 * Returns true if in private mode (IndexedDB unavailable).
 */
async function detectSafariPrivateMode(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') {
    return true; // IndexedDB not available at all
  }

  try {
    const testDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('__safari_private_test__', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        db.createObjectStore('test');
      };
    });

    // Try to write - this fails in Safari private mode
    const tx = testDb.transaction('test', 'readwrite');
    const store = tx.objectStore('test');
    await new Promise<void>((resolve, reject) => {
      const request = store.put('test', 'key');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    testDb.close();
    indexedDB.deleteDatabase('__safari_private_test__');
    return false; // IndexedDB works normally
  } catch (error) {
    // QuotaExceededError or SecurityError = private mode
    return true;
  }
}

/**
 * Creates a store with automatic Safari private mode fallback.
 * Falls back to localStorage (limited) or memory-only.
 */
async function createStoreWithFallback<T extends object>(
  initial: T,
  options: PersistenceOptions,
): Promise<{ store: McpStore<T>; persistenceMode: 'indexeddb' | 'localstorage' | 'memory' }> {
  const isPrivateMode = await detectSafariPrivateMode();

  if (!isPrivateMode) {
    // Normal mode - use IndexedDB
    const store = await createPersistedStore(initial, options);
    return { store, persistenceMode: 'indexeddb' };
  }

  // Private mode fallback
  console.warn(
    'Safari private mode detected - falling back to localStorage. ' +
      'Data will be limited to ~5MB and cleared when window closes.',
  );

  try {
    // Try localStorage fallback (works in private mode but limited)
    const store = createMcpStore(initial);

    // Manual localStorage persistence
    const storageKey = `frontmcp_${options.name}`;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      Object.assign(store.state, JSON.parse(saved));
    }

    // Subscribe to changes
    store.subscribe(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(store.getSnapshot()));
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          console.error('localStorage quota exceeded in private mode');
        }
      }
    });

    return { store, persistenceMode: 'localstorage' };
  } catch (e) {
    // Ultimate fallback - memory only (no persistence)
    console.warn('All persistence unavailable - using memory-only store');
    const store = createMcpStore(initial);
    return { store, persistenceMode: 'memory' };
  }
}
```

**Usage with User Notification:**

```typescript
const { store, persistenceMode } = await createStoreWithFallback({ user: null, preferences: {} }, { name: 'my-app' });

if (persistenceMode === 'memory') {
  // Show user warning
  showNotification({
    type: 'warning',
    message: 'Private browsing detected. Your data will not be saved.',
    duration: 5000,
  });
}

if (persistenceMode === 'localstorage') {
  // Show limited storage warning
  showNotification({
    type: 'info',
    message: 'Limited storage mode. Large data may not persist.',
    duration: 3000,
  });
}
```

**Best Practices:**

1. Always use `createStoreWithFallback()` instead of `createPersistedStore()` directly
2. Inform users when persistence is degraded
3. Design for memory-only operation as fallback
4. Test in Safari private mode during development

---

## Schema Migrations

### IndexedDB Version Management

IndexedDB requires version-based schema migrations:

```typescript
interface MigrationContext {
  db: IDBDatabase;
  oldVersion: number;
  newVersion: number;
  transaction: IDBTransaction;
}

type Migration = (ctx: MigrationContext) => void;

const migrations: Record<number, Migration> = {
  1: (ctx) => {
    // Initial schema
    ctx.db.createObjectStore('state');
  },
  2: (ctx) => {
    // Add index for userId
    const store = ctx.transaction.objectStore('state');
    store.createIndex('userId', 'userId', { unique: false });
  },
  3: (ctx) => {
    // Rename field
    // Note: Data migration requires reading and rewriting
  },
};

async function openDBWithMigrations(name: string, version: number): Promise<IDBDatabase> {
  return openDB(name, version, {
    upgrade(db, oldVersion, newVersion, transaction) {
      const ctx = { db, oldVersion, newVersion: newVersion ?? version, transaction };

      // Run all migrations between oldVersion and newVersion
      for (let v = oldVersion + 1; v <= (newVersion ?? version); v++) {
        if (migrations[v]) {
          console.log(`Running migration v${v}`);
          migrations[v](ctx);
        }
      }
    },
  });
}
```

### Data Migration Pattern

```typescript
interface DataMigration<TOld, TNew> {
  version: number;
  migrate: (old: TOld) => TNew;
}

const dataMigrations: DataMigration<unknown, unknown>[] = [
  {
    version: 2,
    migrate: (state: { userName: string }) => ({
      ...state,
      user: { name: state.userName }, // Restructure
      userName: undefined, // Remove old field
    }),
  },
  {
    version: 3,
    migrate: (state: { theme: string }) => ({
      ...state,
      settings: { theme: state.theme }, // Move to settings
      theme: undefined,
    }),
  },
];

function migrateData<T>(data: unknown, fromVersion: number, toVersion: number): T {
  let result = data;

  for (const migration of dataMigrations) {
    if (migration.version > fromVersion && migration.version <= toVersion) {
      result = migration.migrate(result);
    }
  }

  return result as T;
}
```

### Versioned Persistence

```typescript
interface VersionedState<T> {
  version: number;
  data: T;
  migratedAt?: string;
}

async function createVersionedStore<T extends object>(
  initial: T,
  options: PersistenceOptions & { schemaVersion: number },
): Promise<McpStore<T>> {
  const db = await openDBWithMigrations(options.name, options.schemaVersion);

  // Load and migrate data
  const saved = (await db.get('state', 'root')) as VersionedState<unknown> | undefined;
  let data: T;

  if (saved) {
    if (saved.version < options.schemaVersion) {
      // Migrate data
      data = migrateData<T>(saved.data, saved.version, options.schemaVersion);
      // Save migrated data
      await db.put(
        'state',
        {
          version: options.schemaVersion,
          data,
          migratedAt: new Date().toISOString(),
        },
        'root',
      );
    } else {
      data = saved.data as T;
    }
  } else {
    data = initial;
  }

  const store = createMcpStore(data);

  // Persist with version
  store.subscribe(
    debounce(async () => {
      await db.put(
        'state',
        {
          version: options.schemaVersion,
          data: store.getSnapshot(),
        },
        'root',
      );
    }, options.debounce ?? 100),
  );

  return store;
}
```

---

## Valtio Limitations & Edge Cases

### Non-Extensible Objects

Valtio cannot proxy non-extensible, sealed, or frozen objects:

```typescript
// ERROR - Object.freeze makes object non-extensible
const frozen = Object.freeze({ count: 0 });
const state = proxy(frozen); // Throws error

// WORKAROUND - Clone before proxying
const state = proxy({ ...frozen });
```

### Map and Set

Map and Set require special handling with `proxyMap` and `proxySet`:

```typescript
import { proxyMap, proxySet } from 'valtio/utils';

// Regular Map/Set won't be reactive
const state = proxy({
  items: new Map(), // Changes won't trigger updates!
});

// Use proxyMap/proxySet instead
const state = proxy({
  items: proxyMap<string, Item>(),
  tags: proxySet<string>(),
});

// Now changes are tracked
state.items.set('key', { value: 1 }); // Triggers subscribers
state.tags.add('tag1'); // Triggers subscribers
```

### Circular References

Valtio handles circular references, but snapshots don't:

```typescript
const state = proxy({
  self: null as unknown,
});
state.self = state; // Works

// But snapshot() will fail on circular refs
snapshot(state); // Error: Converting circular structure
```

### Class Instances

Class instances lose their prototype chain when proxied:

```typescript
class User {
  constructor(public name: string) {}
  greet() {
    return `Hello, ${this.name}`;
  }
}

const state = proxy({
  user: new User('Alice'),
});

// Method calls work but instanceof check fails
state.user.greet(); // Works: 'Hello, Alice'
state.user instanceof User; // false!

// WORKAROUND - Keep instances in ref()
import { ref } from 'valtio';

const state = proxy({
  user: ref(new User('Alice')), // Not deeply proxied
});
state.user instanceof User; // true
```

### Date Objects

Dates are proxied and work, but mutations need care:

```typescript
const state = proxy({
  date: new Date(),
});

// This won't trigger update (mutating internal state)
state.date.setFullYear(2025);

// Do this instead (replace the object)
state.date = new Date(state.date.setFullYear(2025));
```

---

## Initialization Patterns

### Async Store Initialization

IndexedDB is async-only. Handle initialization state:

```typescript
interface AsyncStoreState<T> {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: Error | null;
}

async function createAsyncStore<T extends object>(
  loader: () => Promise<T>,
  fallback: T,
): Promise<McpStore<AsyncStoreState<T>>> {
  // Start with loading state
  const store = createMcpStore<AsyncStoreState<T>>({
    status: 'loading',
    data: null,
    error: null,
  });

  try {
    const data = await loader();
    store.state.status = 'ready';
    store.state.data = data;
  } catch (error) {
    store.state.status = 'error';
    store.state.error = error instanceof Error ? error : new Error(String(error));
    store.state.data = fallback;
  }

  return store;
}

// Usage
const store = await createAsyncStore(
  () => loadFromIndexedDB(),
  { count: 0, user: null }, // Fallback
);

// Check status before using
if (store.state.status === 'ready') {
  console.log(store.state.data);
}
```

### Lazy Loading Partitions

Load store partitions on demand:

```typescript
interface PartitionedStore {
  core: CoreState; // Always loaded
  settings?: SettingsState; // Lazy loaded
  history?: HistoryState; // Lazy loaded
}

async function loadPartition<K extends keyof PartitionedStore>(
  store: McpStore<PartitionedStore>,
  partition: K,
): Promise<void> {
  if (store.state[partition] !== undefined) return; // Already loaded

  const data = await loadFromDB(partition);
  store.state[partition] = data;
}

// Usage
const store = createMcpStore<PartitionedStore>({
  core: { count: 0 },
});

// Load settings when needed
await loadPartition(store, 'settings');
```

### Server-Side Rendering (SSR)

For SSR scenarios, use dehydrate/hydrate pattern:

```typescript
// Server: Dehydrate state to JSON
function dehydrate<T>(store: McpStore<T>): string {
  return JSON.stringify(store.getSnapshot());
}

// Client: Hydrate from server-rendered JSON
function hydrate<T extends object>(json: string): McpStore<T> {
  const data = JSON.parse(json) as T;
  return createMcpStore(data);
}

// In HTML
// <script>window.__INITIAL_STATE__ = ${dehydrate(store)}</script>

// On client
const store = hydrate<AppState>(window.__INITIAL_STATE__);
```

#### Full SSR Hydration Pattern

```typescript
// Server: serialize state
const initialState = store.getSnapshot();
const html = `<script>window.__FRONTMCP_STATE__ = ${JSON.stringify(initialState)}</script>`;

// Client: hydrate from serialized state
const store = await createStoreWithFallback(
  {
    ...defaultState,
    ...(window.__FRONTMCP_STATE__ || {}),
  },
  {
    name: 'my-app',
    skipInitialLoad: true, // Don't load from IndexedDB on hydrate
  },
);
```

#### Build Considerations for SSR

For SSR frameworks (Next.js, Remix, SvelteKit), build separate bundles for server and client:

```bash
# Build server bundle (Node.js - runs on server for initial render)
frontmcp build --adapter node --outDir dist/server

# Build client bundle (Browser - runs after hydration)
frontmcp build --adapter browser --outDir dist/client
```

This ensures:

- Server bundle uses Node.js crypto for any server-side operations
- Client bundle uses Web Crypto shim for browser execution
- State serialization/hydration bridges the two environments

#### Avoiding Hydration Mismatch

```typescript
// Use deterministic IDs during SSR to avoid mismatch
const createStore = (isServer: boolean) => {
  return createMcpStore({
    // Use stable IDs during SSR
    requestId: isServer ? 'ssr-initial' : crypto.randomUUID(),
    timestamp: isServer ? 0 : Date.now(),
    // ... other state
  });
};
```

See [BUILD.md](./BUILD.md) for detailed build configuration.

---

## See Also

- [SCHEMA-STORE.md](./SCHEMA-STORE.md) - Schema-driven stores with auto-registered actions
- [REACT.md](./REACT.md) - React hooks for store access
- [SECURITY.md](./SECURITY.md) - Store authorization patterns
- [API.md](./API.md) - Full API reference
