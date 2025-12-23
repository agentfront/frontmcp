# Troubleshooting Guide

Common issues and solutions for FrontMCP Browser.

## Table of Contents

- [Connection Issues](#connection-issues)
- [Transport Errors](#transport-errors)
- [Store Issues](#store-issues)
- [Component Registry Issues](#component-registry-issues)
- [React Hook Issues](#react-hook-issues)
- [Performance Issues](#performance-issues)
- [Security Errors](#security-errors)
- [Browser Compatibility](#browser-compatibility)

---

## Connection Issues

### "Transport not connected" Error

**Symptom**: Tools fail with "Transport not connected" error.

**Causes**:

1. Transport was closed prematurely
2. WebWorker crashed
3. Iframe was removed from DOM

**Solutions**:

```typescript
// Check connection status before calls
if (!transport.isConnected) {
  console.error('Transport disconnected, attempting reconnect...');
  await transport.connect?.();
}

// Add reconnection logic
transport.onClose?.(() => {
  console.warn('Transport closed, scheduling reconnect...');
  setTimeout(() => reconnect(), 1000);
});
```

### Tool Calls Never Return

**Symptom**: `callTool()` or `useTool()` hangs indefinitely.

**Causes**:

1. No handler registered for the tool on server side
2. Server crashed during execution
3. Message lost in transit

**Solutions**:

```typescript
// Add timeout to tool calls
async function callToolWithTimeout<T>(name: string, args: unknown, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await transport.request({
      method: 'tools/call',
      params: { name, arguments: args },
    });
    return result as T;
  } finally {
    clearTimeout(timeout);
  }
}

// Debug: List available tools first
const tools = await transport.request({ method: 'tools/list' });
console.log('Available tools:', tools);
```

---

## Transport Errors

### "Origin not allowed" Error

**Symptom**: `PostMessageTransport` rejects messages with origin error.

**Cause**: The message origin doesn't match configured `allowedOrigins`.

**Solutions**:

```typescript
// 1. Check the actual origin being received
transport.onMessage((msg, event) => {
  console.log('Message from origin:', event?.origin);
});

// 2. Ensure correct origin configuration
const transport = new PostMessageTransport(iframe.contentWindow!, {
  origin: 'https://exact-origin.example.com', // Must match exactly
});

// 3. For development, use dynamic origin detection
const origin = new URL(iframe.src).origin;
const transport = new PostMessageTransport(iframe.contentWindow!, {
  origin: origin,
});
```

### "Message structure invalid" Error

**Symptom**: Transport receives messages but they're rejected as invalid.

**Cause**: Messages don't conform to JSON-RPC 2.0 format.

**Solution**:

```typescript
// Correct JSON-RPC 2.0 format
const validRequest = {
  jsonrpc: '2.0',      // Required
  id: 'unique-id',     // Required for requests
  method: 'tools/call', // Required
  params: { ... }      // Optional
};

const validResponse = {
  jsonrpc: '2.0',      // Required
  id: 'unique-id',     // Must match request
  result: { ... }      // OR error, not both
};

// Debug: Log raw messages
transport.onMessage((msg) => {
  console.log('Raw message:', JSON.stringify(msg, null, 2));
});
```

### WebWorker "Uncaught Error"

**Symptom**: Worker crashes without useful error message.

**Solutions**:

```typescript
// 1. Add global error handler in worker
self.onerror = (event) => {
  console.error('Worker error:', event.message, event.filename, event.lineno);
  // Send error back to main thread
  self.postMessage({
    type: 'error',
    error: { message: event.message, stack: event.error?.stack },
  });
};

self.onunhandledrejection = (event) => {
  console.error('Unhandled rejection in worker:', event.reason);
};

// 2. In main thread, listen for errors
worker.onerror = (event) => {
  console.error('Worker error in main:', event);
};
```

---

## Store Issues

### "Store mutation detected during render"

**Symptom**: React warning about mutating state during render.

**Cause**: Mutating Valtio proxy inside render function.

**Solution**:

```tsx
// WRONG - mutating during render
function Counter() {
  const { state, store } = useStore();
  store.count++; // Don't do this!
  return <div>{state.count}</div>;
}

// CORRECT - mutate in event handlers or effects
function Counter() {
  const { state, store } = useStore();

  const increment = () => {
    store.count++; // OK in handler
  };

  useEffect(() => {
    store.initialized = true; // OK in effect
  }, []);

  return <button onClick={increment}>{state.count}</button>;
}
```

### IndexedDB "QuotaExceededError"

**Symptom**: Store persistence fails with quota error.

**Cause**: Browser storage limit exceeded (typically 50-500MB).

**Solutions**:

```typescript
// 1. Clear old data
const db = await openDB('my-app-db');
await db.clear('store');

// 2. Implement selective persistence
const store = createMcpStore({
  essential: {}, // Always persist
  cache: {}, // Don't persist
});

// 3. Use compressed storage
import { compress, decompress } from 'lz-string';

async function persistWithCompression(data: unknown) {
  const json = JSON.stringify(data);
  const compressed = compress(json);
  await idb.put('store', compressed, 'data');
}
```

### Store Not Persisting

**Symptom**: Data lost after page refresh.

**Causes**:

1. Persistence not configured
2. `name` mismatch between sessions
3. Browser private/incognito mode

**Solutions**:

```typescript
// 1. Verify persistence config
const server = await createBrowserMcpServer({
  store: { count: 0 },
  persistence: {
    name: 'my-app-db', // Consistent name
    storage: 'indexeddb', // Or 'localstorage'
    debounceMs: 100,
  },
});

// 2. Debug: Check if data is being saved
store.onMutation((ops) => {
  console.log('Mutations:', ops);
  console.log('Persistence active:', persistence.isEnabled);
});

// 3. Manually trigger persistence
await store.flush?.();
```

---

## Component Registry Issues

### "Component not found"

**Symptom**: `useComponent()` returns null or throws.

**Cause**: Component not registered or typo in name.

**Solutions**:

```typescript
// 1. List all registered components
const components = registry.list();
console.log(
  'Registered components:',
  components.map((c) => c.name),
);

// 2. Check exact name match (case-sensitive)
registry.register({
  name: 'MyButton', // Must match exactly when using
  // ...
});

// 3. Ensure registration happens before use
// In provider:
useEffect(() => {
  registerAllComponents(registry);
}, [registry]);
```

### Component Props Validation Failed

**Symptom**: "Invalid props" error when rendering component.

**Cause**: Props don't match registered schema.

**Solution**:

```typescript
// Check the schema
const meta = registry.get('Button');
console.log('Expected props:', meta?.inputSchema);

// Validate before calling
const validation = meta?.inputSchema?.safeParse(props);
if (!validation?.success) {
  console.error('Invalid props:', validation?.error);
}
```

---

## React Hook Issues

### "useMcp must be used within FrontMcpBrowserProvider"

**Symptom**: Hook throws context error.

**Cause**: Component not wrapped in provider.

**Solution**:

```tsx
// Ensure provider wraps all components using hooks
function App() {
  return (
    <FrontMcpBrowserProvider server={server}>
      <ComponentUsingHooks /> {/* Must be inside provider */}
    </FrontMcpBrowserProvider>
  );
}

// For conditional rendering, check inside component
function ConditionalMcp() {
  const mcp = useMcpContext(); // nullable version

  if (!mcp) {
    return <p>MCP not available</p>;
  }

  return <McpFeature />;
}
```

### useTool Returns Stale Result

**Symptom**: `result` from `useTool` doesn't update.

**Cause**: Missing dependency or stale closure.

**Solution**:

```tsx
function SearchComponent({ initialQuery }) {
  const { execute, result, reset } = useTool('search');

  // Reset when query changes
  useEffect(() => {
    reset();
    execute({ query: initialQuery });
  }, [initialQuery, execute, reset]);

  // Or use autoReset option
  const { execute, result } = useTool('search', { autoReset: true });
}
```

### useResource Infinite Loop

**Symptom**: Resource refetches continuously.

**Cause**: `uri` or options object recreated each render.

**Solution**:

```tsx
// WRONG - creates new options object each render
function ResourceViewer({ id }) {
  const { data } = useResource(`item://${id}`, {
    refetchInterval: 5000, // New object each render!
  });
}

// CORRECT - stable options
const OPTIONS = { refetchInterval: 5000 };

function ResourceViewer({ id }) {
  const uri = useMemo(() => `item://${id}`, [id]);
  const { data } = useResource(uri, OPTIONS);
}
```

---

## Performance Issues

### High CPU Usage

**Symptom**: Page becomes unresponsive, high CPU.

**Causes**:

1. Too many store subscriptions
2. Unnecessary re-renders
3. Complex component in render loop

**Solutions**:

```typescript
// 1. Use selective subscriptions
const count = useSnapshot(store.state).count; // Only count
// Not: const { state } = useStore(); // All state

// 2. Move expensive operations out of render
const Component = memo(({ data }) => {
  const processed = useMemo(() => expensiveProcess(data), [data]);
  return <div>{processed}</div>;
});

// 3. Throttle store mutations
import { throttle } from 'lodash';

const throttledUpdate = throttle((value) => {
  store.data = value;
}, 100);
```

### Memory Leak

**Symptom**: Memory usage grows over time.

**Cause**: Subscriptions not cleaned up.

**Solutions**:

```tsx
// 1. Always cleanup subscriptions in useEffect
useEffect(() => {
  const unsubscribe = store.subscribe((state) => {
    console.log('Changed:', state);
  });

  return () => unsubscribe(); // Cleanup!
}, [store]);

// 2. Cleanup transport handlers
useEffect(() => {
  const unsubscribe = transport.onMessage((msg) => {
    handleMessage(msg);
  });

  return () => unsubscribe();
}, [transport]);

// 3. Use React DevTools Profiler to find leaks
```

### Slow Initial Load

**Symptom**: App takes long time to become interactive.

**Solutions**:

```typescript
// 1. Lazy load MCP server
const McpProvider = lazy(() => import('./McpProvider'));

// 2. Don't block on persistence load
const server = await createBrowserMcpServer({
  persistence: {
    name: 'my-app-db',
    loadMode: 'async', // Don't block server creation
  },
});

// 3. Use code splitting for tools
server.registerTool('heavy-tool', {
  execute: async (args) => {
    const { heavyProcess } = await import('./heavy-process');
    return heavyProcess(args);
  },
});
```

---

## Security Errors

### "CSRF Token Invalid"

**Symptom**: Tool calls rejected with CSRF error.

**Cause**: Token expired or mismatch.

**Solution**:

```typescript
// Refresh token before sensitive operations
async function secureTool(name: string, args: unknown) {
  const token = await refreshCSRFToken();
  return callTool(name, { ...args, _csrf: token });
}
```

### "Unauthorized" Tool Call

**Symptom**: Tool rejected with 403/unauthorized.

**Cause**: Missing or invalid auth context.

**Solution**:

```typescript
// Ensure auth context is provided
const server = await createBrowserMcpServer({
  authContext: {
    user: getCurrentUser(),
    token: getAuthToken(),
  },
});

// Refresh token if expired
if (isTokenExpired(token)) {
  const newToken = await refreshToken();
  server.updateAuthContext({ token: newToken });
}
```

---

## Browser Compatibility

### "crypto.randomUUID is not a function"

**Symptom**: Error in older browsers.

**Cause**: Web Crypto API not available.

**Solution**:

```typescript
// Polyfill for older browsers
if (!crypto.randomUUID) {
  crypto.randomUUID = function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
}
```

### IndexedDB Not Available

**Symptom**: Persistence fails, error about IndexedDB.

**Cause**: Private browsing mode or disabled.

**Solution**:

```typescript
// Check availability and fallback
function getStorageAdapter() {
  if (typeof indexedDB !== 'undefined') {
    return createIndexedDBAdapter();
  }
  if (typeof localStorage !== 'undefined') {
    console.warn('IndexedDB unavailable, using localStorage');
    return createLocalStorageAdapter();
  }
  console.warn('No persistent storage available');
  return createMemoryAdapter();
}
```

### WebWorker Not Supported

**Symptom**: Worker creation fails.

**Solution**:

```typescript
// Check support and fallback to main thread
function createTransport() {
  if (typeof Worker !== 'undefined') {
    const worker = new Worker('./mcp-worker.js');
    return new PostMessageTransport(worker);
  }

  console.warn('WebWorkers not supported, using main thread');
  return new EventTransport(createSimpleEmitter());
}
```

---

## Debugging Tips

### Enable Debug Mode

```typescript
// Set environment variable or localStorage
localStorage.setItem('frontmcp:debug', 'true');

// Or configure programmatically
const server = await createBrowserMcpServer({
  debug: true,
  logger: {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  },
});
```

### Log All Messages

```typescript
// Intercept all transport messages
const originalSend = transport.send.bind(transport);
transport.send = (msg) => {
  console.log('[MCP OUT]', msg);
  return originalSend(msg);
};

const originalOnMessage = transport.onMessage.bind(transport);
transport.onMessage = (handler) => {
  return originalOnMessage((msg) => {
    console.log('[MCP IN]', msg);
    handler(msg);
  });
};
```

### DevTools Extension

```typescript
// Expose for DevTools inspection
if (typeof window !== 'undefined') {
  (window as any).__FRONTMCP__ = {
    server,
    store: server.getStore(),
    transport: server.getTransport(),
    registry: server.getComponentRegistry(),
  };
}

// In console:
// __FRONTMCP__.store.state
// __FRONTMCP__.registry.list()
```

---

## Getting Help

If this guide doesn't solve your issue:

1. **Check existing issues** - Search the GitHub repository
2. **Enable debug logging** - Capture full logs before reporting
3. **Create minimal reproduction** - Isolate the problem
4. **Report with details** - Include browser version, error messages, and code samples

See also:

- [SECURITY.md](./SECURITY.md) - Security-related errors
- [LIMITATIONS.md](./LIMITATIONS.md) - Known limitations
- [API.md](./API.md) - API reference
