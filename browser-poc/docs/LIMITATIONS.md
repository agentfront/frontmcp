# Known Limitations

This document covers known limitations of FrontMCP Browser and recommended workarounds.

## Browser Environment Limitations

### No File System Access

**Limitation**: Browsers cannot access the local file system directly.

**Impact**:

- Cannot read/write arbitrary files
- No `fs` module equivalent
- File paths are meaningless

**Workarounds**:

- Use File API with user-initiated file picker
- Store data in IndexedDB or localStorage
- Use drag-and-drop for file input

```typescript
// Instead of fs.readFile()
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.onload = (e) => {
    const contents = e.target.result;
    // Use contents...
  };
  reader.readAsText(file);
};
```

### No Native Crypto Module

**Limitation**: Node.js `crypto` module not available.

**Impact**:

- No `createHash()`, `createCipheriv()`, etc.
- Different API surface for cryptographic operations

**Workaround**: Use Web Crypto API.

```typescript
// Node.js
import { createHash } from 'crypto';
const hash = createHash('sha256').update(data).digest('hex');

// Browser
const encoder = new TextEncoder();
const data = encoder.encode(input);
const hashBuffer = await crypto.subtle.digest('SHA-256', data);
const hashArray = Array.from(new Uint8Array(hashBuffer));
const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
```

### No Process Environment

**Limitation**: `process.env` is not available.

**Impact**:

- Cannot access environment variables
- No `process.cwd()`, `process.platform`, etc.

**Workaround**: Use configuration injection.

```typescript
// Instead of process.env
const config = {
  apiUrl: window.__APP_CONFIG__?.apiUrl ?? 'https://default.api',
  debug: window.__APP_CONFIG__?.debug ?? false,
};

// Or inject via build tool (Vite, webpack)
const config = {
  apiUrl: import.meta.env.VITE_API_URL,
};
```

---

## Storage Limitations

### localStorage Size Limit (~5 MB)

**Limitation**: localStorage is limited to approximately 5 MB per origin.

**Impact**:

- Cannot store large datasets
- Synchronous API can block UI
- No structured queries

**Workarounds**:

- Use IndexedDB for large data (50 MB - 2 GB+)
- Compress data before storing
- Use pagination/lazy loading

```typescript
// Check remaining space (approximate)
function getLocalStorageUsage(): number {
  let total = 0;
  for (const key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      total += localStorage[key].length * 2; // UTF-16
    }
  }
  return total;
}
```

### IndexedDB is Async-Only

**Limitation**: All IndexedDB operations are asynchronous.

**Impact**:

- Cannot synchronously read initial state
- Requires handling loading state
- More complex initialization

**Workaround**: Use loading state pattern.

```typescript
// Show loading until IndexedDB ready
const [isReady, setIsReady] = useState(false);
const [store, setStore] = useState(null);

useEffect(() => {
  createPersistedStore({ count: 0 }, { name: 'app' })
    .then(setStore)
    .finally(() => setIsReady(true));
}, []);

if (!isReady) return <Loading />;
```

### Storage May Be Evicted

**Limitation**: Browser may evict storage under memory pressure.

**Impact**:

- Data loss without warning
- Unpredictable on low-storage devices

**Workaround**: Request persistent storage.

```typescript
// Request persistent storage (may prompt user)
if (navigator.storage && navigator.storage.persist) {
  const isPersisted = await navigator.storage.persist();
  if (!isPersisted) {
    console.warn('Storage may be evicted under pressure');
  }
}
```

---

## WebWorker Limitations

### No DOM Access

**Limitation**: WebWorkers cannot access the DOM.

**Impact**:

- Render tools cannot execute in Worker
- Cannot read/write DOM state
- Cannot access `document` or `window`

**Workaround**: Post results to main thread for DOM operations.

```typescript
// worker.ts
const result = computeExpensiveOperation();
self.postMessage({ type: 'render-request', data: result });

// main.ts
worker.onmessage = (e) => {
  if (e.data.type === 'render-request') {
    // Perform DOM operations in main thread
    document.getElementById('output').innerHTML = e.data.data;
  }
};
```

### No localStorage in Workers

**Limitation**: Workers cannot access localStorage.

**Impact**:

- Must use IndexedDB for persistence
- Cannot share localStorage state with Worker

**Workaround**: Use IndexedDB (accessible from Workers) or postMessage.

```typescript
// Worker can use IndexedDB
const db = await openDB('app', 1);
const data = await db.get('state', 'key');
```

### Structured Clone Restrictions

**Limitation**: postMessage uses structured clone, which cannot clone:

- Functions
- DOM nodes
- Symbols
- WeakMap/WeakSet

**Impact**:

- Cannot pass callbacks to Worker
- Cannot serialize React components

**Workaround**: Only pass serializable data.

```typescript
// BAD - function cannot be cloned
worker.postMessage({ callback: () => {} });

// GOOD - only data
worker.postMessage({ action: 'compute', data: [1, 2, 3] });
```

---

## Valtio Limitations

### Non-Extensible Objects

**Limitation**: Valtio cannot proxy frozen/sealed/non-extensible objects.

**Impact**:

- Cannot use `Object.freeze()` on state
- Some library outputs are non-extensible

**Workaround**: Clone objects before proxying.

```typescript
const frozenData = Object.freeze(apiResponse);

// BAD
const state = proxy(frozenData); // Error!

// GOOD
const state = proxy({ ...frozenData });
```

### Map/Set Require Special Handling

**Limitation**: Standard Map/Set are not reactive in Valtio.

**Impact**:

- Changes to Map/Set don't trigger updates
- Need to use special utilities

**Workaround**: Use `proxyMap` and `proxySet`.

```typescript
import { proxy } from 'valtio';
import { proxyMap, proxySet } from 'valtio/utils';

const state = proxy({
  // BAD - not reactive
  users: new Map(),

  // GOOD - reactive
  users: proxyMap(),
  tags: proxySet(),
});
```

### Circular References

**Limitation**: `snapshot()` cannot handle circular references.

**Impact**:

- Cannot create immutable snapshot of circular state
- May cause stack overflow

**Workaround**: Avoid circular references or use `ref()`.

```typescript
import { proxy, ref } from 'valtio';

// If you need circular refs, use ref() to break the cycle
const state = proxy({
  node: ref({
    children: [],
    parent: null, // Will be circular
  }),
});
```

### Class Instances Lose Prototype

**Limitation**: Class instances lose their prototype when proxied.

**Impact**:

- `instanceof` checks fail
- Methods may not work as expected

**Workaround**: Use `ref()` for class instances.

```typescript
import { proxy, ref } from 'valtio';

class User {
  constructor(public name: string) {}
  greet() {
    return `Hello, ${this.name}`;
  }
}

const state = proxy({
  // BAD - loses prototype
  user: new User('Alice'),

  // GOOD - preserves prototype
  user: ref(new User('Alice')),
});
```

---

## Transport Limitations

### No Native HTTP Server

**Limitation**: Cannot run HTTP server in browser.

**Impact**:

- Cannot use Express/Fastify adapters
- Cannot receive external HTTP requests
- Limited to same-origin communication

**Workaround**: Use event-based transports.

```typescript
// Instead of HTTP server
const transport = new EventTransport(emitter);
// or
const transport = new PostMessageTransport(worker);
```

### SharedWorker Not Supported

**Limitation**: SharedWorker support is not included due to:

- Not available in Safari
- Complex connection management
- Limited debugging support

**Impact**:

- Cannot share single MCP server across tabs

**Workaround**: Use BroadcastChannel for tab synchronization.

```typescript
// Each tab runs its own server
const transport = new BroadcastChannelTransport({
  channelName: 'mcp-sync',
});

// State syncs across tabs via broadcast
```

### No WebSocket Server

**Limitation**: Cannot create WebSocket server in browser.

**Impact**:

- Cannot accept incoming WebSocket connections
- Must connect to external WS server

**Workaround**: Use postMessage or EventEmitter within browser.

---

## MCP Protocol Limitations

### No Prompts Support

**Limitation**: `prompts/list` and `prompts/get` are not implemented.

**Reason**: Prompts are typically managed by the AI client, not the browser application.

**Workaround**: If needed, expose prompts as resources.

```typescript
// Expose prompt templates as resources
@Resource({ uri: 'prompts://{name}' })
class PromptResource {
  async read(ctx) {
    const template = templates[ctx.params.name];
    return { contents: [{ text: template }] };
  }
}
```

### No Sampling Support

**Limitation**: `sampling/createMessage` is not implemented.

**Reason**: Requires LLM access, which browsers don't have natively.

**Workaround**: Call external LLM API if needed.

```typescript
// Use external API instead
async function createMessage(prompt: string): Promise<string> {
  const response = await fetch('/api/llm', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
  return response.json();
}
```

### No File System Roots

**Limitation**: `roots/list` is not implemented.

**Reason**: Browser has no file system roots concept.

**Workaround**: Use virtual file system or resources.

```typescript
// Expose virtual file structure as resources
@Resource({ uri: 'files://{path}' })
class VirtualFileResource {
  async read(ctx) {
    const file = virtualFS.get(ctx.params.path);
    return { contents: [{ text: file.content }] };
  }
}
```

---

## Performance Limitations

### Main Thread Blocking

**Limitation**: Heavy computation blocks UI if run in main thread.

**Impact**:

- UI becomes unresponsive
- Animations stutter
- User interactions delayed

**Workaround**: Use WebWorker for heavy computation.

```typescript
// Move heavy work to Worker
const worker = new Worker('./heavy-computation.worker.ts');
worker.postMessage({ data: largeDataset });
worker.onmessage = (e) => {
  // Update UI with result
  updateUI(e.data.result);
};
```

### Bundle Size

**Limitation**: Large bundles affect initial load time.

**Impact**:

- Slower time-to-interactive
- Higher bandwidth usage
- Poor mobile experience

**Workaround**: Tree-shaking and code splitting.

```typescript
// Import only what you need
import { createMcpStore } from '@frontmcp/browser/store';
import { EventTransport } from '@frontmcp/browser/transport';

// Don't import entire package
// import * as FrontMcp from '@frontmcp/browser'; // BAD
```

---

## Browser Compatibility

### Minimum Browser Versions

| Feature          | Chrome | Firefox | Safari | Edge |
| ---------------- | ------ | ------- | ------ | ---- |
| Web Crypto API   | 37+    | 34+     | 11+    | 79+  |
| IndexedDB        | 23+    | 10+     | 10+    | 79+  |
| WebWorker        | 4+     | 3.5+    | 4+     | 79+  |
| postMessage      | 2+     | 3+      | 4+     | 79+  |
| BroadcastChannel | 54+    | 38+     | 15.4+  | 79+  |
| Proxy            | 49+    | 18+     | 10+    | 79+  |

### Feature Detection

```typescript
function checkBrowserSupport(): { supported: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!window.crypto?.subtle) missing.push('Web Crypto API');
  if (!window.indexedDB) missing.push('IndexedDB');
  if (!window.Worker) missing.push('WebWorker');
  if (!window.Proxy) missing.push('Proxy');
  if (!window.BroadcastChannel) missing.push('BroadcastChannel');

  return {
    supported: missing.length === 0,
    missing,
  };
}
```

---

## Summary

| Category    | Limitation       | Severity | Workaround        |
| ----------- | ---------------- | -------- | ----------------- |
| Environment | No fs access     | High     | IndexedDB/FileAPI |
| Environment | No crypto module | Medium   | Web Crypto API    |
| Storage     | 5MB localStorage | Medium   | Use IndexedDB     |
| Storage     | IndexedDB async  | Low      | Loading state     |
| Workers     | No DOM           | High     | postMessage       |
| Workers     | No localStorage  | Low      | Use IndexedDB     |
| Valtio      | Frozen objects   | Low      | Clone first       |
| Valtio      | Map/Set          | Low      | proxyMap/Set      |
| Transport   | No HTTP server   | Medium   | Event transport   |
| MCP         | No prompts       | Low      | Resources         |
| MCP         | No sampling      | Low      | External API      |
