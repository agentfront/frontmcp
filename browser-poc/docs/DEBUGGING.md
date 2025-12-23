# Debugging Guide

Debugging strategies and tools for FrontMCP Browser applications.

## Table of Contents

- [Debug Mode](#debug-mode)
- [Browser DevTools](#browser-devtools)
- [Message Inspection](#message-inspection)
- [Store Debugging](#store-debugging)
- [Transport Debugging](#transport-debugging)
- [React DevTools](#react-devtools)
- [Production Debugging](#production-debugging)
- [Common Debug Scenarios](#common-debug-scenarios)

---

## Debug Mode

### Enable Debug Logging

```typescript
// Enable debug mode globally
localStorage.setItem('frontmcp:debug', 'true');

// Or configure programmatically
const server = await createBrowserMcpServer({
  info: { name: 'MyApp', version: '1.0.0' },
  debug: true,
  logger: {
    debug: (msg, ...args) => console.debug('[MCP:DEBUG]', msg, ...args),
    info: (msg, ...args) => console.info('[MCP:INFO]', msg, ...args),
    warn: (msg, ...args) => console.warn('[MCP:WARN]', msg, ...args),
    error: (msg, ...args) => console.error('[MCP:ERROR]', msg, ...args),
  },
});
```

### Debug Levels

```typescript
// Configure log levels
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const logLevel: LogLevel = import.meta.env.DEV ? 'debug' : (import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'warn';

const logger = createLogger(logLevel);
```

### Conditional Debug Output

```typescript
// Debug helper that only logs in development
function debugLog(category: string, message: string, data?: unknown) {
  if (localStorage.getItem('frontmcp:debug') === 'true') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${category}]`, message, data ?? '');
  }
}

// Usage
debugLog('TRANSPORT', 'Message sent', { method: 'tools/call', params });
debugLog('STORE', 'State updated', { path: 'user.name', value: 'John' });
```

---

## Browser DevTools

### Console Helpers

```typescript
// Expose FrontMCP internals for DevTools access
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__FRONTMCP__ = {
    server: null as BrowserMcpServer | null,
    store: null as McpStore<unknown> | null,
    transport: null as BrowserTransport | null,
    registry: null as ComponentRegistry | null,

    // Helper methods
    listTools: () => window.__FRONTMCP__.server?.listTools(),
    listResources: () => window.__FRONTMCP__.server?.listResources(),
    getState: () => window.__FRONTMCP__.store?.getState(),
    callTool: (name: string, args: unknown) => window.__FRONTMCP__.server?.callTool(name, args),
    readResource: (uri: string) => window.__FRONTMCP__.server?.readResource(uri),
  };
}

// After server creation
window.__FRONTMCP__.server = server;
window.__FRONTMCP__.store = server.getStore();
window.__FRONTMCP__.transport = server.getTransport();
```

### Console Commands

```javascript
// In browser console:

// List all registered tools
__FRONTMCP__.listTools();

// Call a tool
__FRONTMCP__.callTool('search', { query: 'test' });

// Read a resource
__FRONTMCP__.readResource('store://user');

// Get current store state
__FRONTMCP__.getState();

// Subscribe to store changes (temporary)
const unsub = __FRONTMCP__.store.subscribe((state) => {
  console.log('State changed:', state);
});
// Call unsub() to stop
```

### Network Tab Inspection

For PostMessage debugging:

```typescript
// Log all postMessage traffic
const originalPostMessage = window.postMessage.bind(window);
window.postMessage = function (message, targetOrigin, transfer) {
  console.log('[postMessage OUT]', { message, targetOrigin });
  return originalPostMessage(message, targetOrigin, transfer);
};

window.addEventListener('message', (event) => {
  console.log('[postMessage IN]', {
    data: event.data,
    origin: event.origin,
    source: event.source,
  });
});
```

---

## Message Inspection

### MCP Message Logger

```typescript
// Create message interceptor
function createMessageLogger(transport: BrowserTransport) {
  const messages: Array<{
    direction: 'in' | 'out';
    timestamp: number;
    message: JSONRPCMessage;
  }> = [];

  // Intercept outgoing messages
  const originalSend = transport.send.bind(transport);
  transport.send = (message) => {
    messages.push({
      direction: 'out',
      timestamp: Date.now(),
      message,
    });
    console.log('[MCP OUT]', formatMessage(message));
    return originalSend(message);
  };

  // Intercept incoming messages
  const originalOnMessage = transport.onMessage.bind(transport);
  transport.onMessage = (handler) => {
    return originalOnMessage((message) => {
      messages.push({
        direction: 'in',
        timestamp: Date.now(),
        message,
      });
      console.log('[MCP IN]', formatMessage(message));
      handler(message);
    });
  };

  return {
    getMessages: () => messages,
    clear: () => (messages.length = 0),
    export: () => JSON.stringify(messages, null, 2),
  };
}

function formatMessage(msg: JSONRPCMessage): string {
  if ('method' in msg) {
    return `${msg.method}(${JSON.stringify(msg.params)})`;
  }
  if ('result' in msg) {
    return `Response[${msg.id}]: ${JSON.stringify(msg.result)}`;
  }
  if ('error' in msg) {
    return `Error[${msg.id}]: ${msg.error.message}`;
  }
  return JSON.stringify(msg);
}
```

### Request/Response Matching

```typescript
// Track request/response pairs
class RequestTracker {
  private pending = new Map<
    string | number,
    {
      request: JSONRPCRequest;
      startTime: number;
    }
  >();

  trackRequest(request: JSONRPCRequest) {
    this.pending.set(request.id, {
      request,
      startTime: performance.now(),
    });
  }

  trackResponse(response: JSONRPCResponse) {
    const tracked = this.pending.get(response.id);
    if (tracked) {
      const duration = performance.now() - tracked.startTime;
      console.log(`[MCP] ${tracked.request.method} completed in ${duration.toFixed(2)}ms`);
      this.pending.delete(response.id);
    }
  }

  getPending() {
    return Array.from(this.pending.entries()).map(([id, data]) => ({
      id,
      method: data.request.method,
      waiting: performance.now() - data.startTime,
    }));
  }
}
```

---

## Store Debugging

### Valtio DevTools Integration

```typescript
import { devtools } from 'valtio/utils';

// Enable Redux DevTools integration
const store = createMcpStore({ count: 0, user: null });
const unsub = devtools(store.state, { name: 'FrontMCP Store' });

// Now visible in Redux DevTools extension
```

### Mutation Tracking

```typescript
// Track all store mutations
store.onMutation((ops) => {
  ops.forEach((op) => {
    console.log('[STORE MUTATION]', {
      type: op[0], // 'set', 'delete', etc.
      path: op[1], // ['user', 'name']
      value: op[2], // new value
      previousValue: op[3], // old value
    });
  });
});

// Detailed mutation logger
function createMutationLogger(store: McpStore<unknown>) {
  const history: Array<{
    timestamp: number;
    ops: unknown[];
    snapshot: unknown;
  }> = [];

  store.onMutation((ops) => {
    history.push({
      timestamp: Date.now(),
      ops: [...ops],
      snapshot: JSON.parse(JSON.stringify(store.getState())),
    });

    // Keep last 100 mutations
    if (history.length > 100) {
      history.shift();
    }
  });

  return {
    getHistory: () => history,
    undo: (steps = 1) => {
      // Restore previous state
      const target = history[history.length - 1 - steps];
      if (target) {
        Object.assign(store.state, target.snapshot);
      }
    },
  };
}
```

### State Snapshots

```typescript
// Create state snapshots for debugging
class StateDebugger {
  private snapshots: Map<string, unknown> = new Map();

  snapshot(name: string, store: McpStore<unknown>) {
    this.snapshots.set(name, JSON.parse(JSON.stringify(store.getState())));
    console.log(`[SNAPSHOT] "${name}" saved`);
  }

  compare(name1: string, name2: string) {
    const s1 = this.snapshots.get(name1);
    const s2 = this.snapshots.get(name2);

    if (!s1 || !s2) {
      console.error('Snapshot not found');
      return;
    }

    console.log(`[DIFF] "${name1}" vs "${name2}":`);
    this.deepDiff(s1, s2, []);
  }

  private deepDiff(a: unknown, b: unknown, path: string[]) {
    if (typeof a !== typeof b) {
      console.log(`  ${path.join('.')}: type changed from ${typeof a} to ${typeof b}`);
      return;
    }

    if (typeof a !== 'object' || a === null) {
      if (a !== b) {
        console.log(`  ${path.join('.')}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      }
      return;
    }

    const keys = new Set([...Object.keys(a), ...Object.keys(b as object)]);
    keys.forEach(key => {
      this.deepDiff(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        [...path, key]
      );
    });
  }
}

// Usage
const debugger = new StateDebugger();
debugger.snapshot('before', store);
// ... do something
debugger.snapshot('after', store);
debugger.compare('before', 'after');
```

---

## Transport Debugging

### Connection State Monitoring

```typescript
// Monitor transport connection state
function monitorTransport(transport: BrowserTransport) {
  console.log('[TRANSPORT] Monitoring started');

  // Track connection state
  let connected = false;

  transport.onConnect?.(() => {
    connected = true;
    console.log('[TRANSPORT] Connected');
  });

  transport.onClose?.(() => {
    connected = false;
    console.log('[TRANSPORT] Disconnected');
  });

  transport.onError?.((error) => {
    console.error('[TRANSPORT] Error:', error);
  });

  // Periodic health check
  setInterval(() => {
    console.log('[TRANSPORT] Health:', {
      connected,
      pending: transport.getPendingCount?.() ?? 'N/A',
    });
  }, 10000);
}
```

### PostMessage Origin Debugging

```typescript
// Debug origin validation issues
const transport = new PostMessageTransport(target, {
  origin: 'https://expected-origin.com',
  onOriginMismatch: (received, expected) => {
    console.error('[TRANSPORT] Origin mismatch:', {
      received,
      expected,
      action: 'Message rejected',
    });
  },
});

// Log all received origins
window.addEventListener('message', (event) => {
  console.log('[ORIGIN DEBUG]', {
    origin: event.origin,
    hasData: !!event.data,
    dataType: typeof event.data,
    isMcpMessage: event.data?.jsonrpc === '2.0',
  });
});
```

### WebWorker Debugging

```typescript
// Debug worker communication
const worker = new Worker('./mcp-worker.js');

// Wrap worker for debugging
const debugWorker = {
  postMessage: (msg: unknown) => {
    console.log('[WORKER OUT]', msg);
    worker.postMessage(msg);
  },
  onmessage: null as ((e: MessageEvent) => void) | null,
  onerror: null as ((e: ErrorEvent) => void) | null,
};

worker.onmessage = (e) => {
  console.log('[WORKER IN]', e.data);
  debugWorker.onmessage?.(e);
};

worker.onerror = (e) => {
  console.error('[WORKER ERROR]', e);
  debugWorker.onerror?.(e);
};
```

---

## React DevTools

### Component Debugging

```tsx
// Add display names for DevTools
const FrontMcpBrowserProvider = ({ children, ...props }) => {
  // ... implementation
};
FrontMcpBrowserProvider.displayName = 'FrontMcpBrowserProvider';

// Debug hook values
function useDebugTool(name: string) {
  const result = useTool(name);

  useDebugValue(result, (r) => ({
    name,
    loading: r.loading,
    error: r.error?.message,
    hasResult: !!r.result,
  }));

  return result;
}
```

### Profiler Integration

```tsx
import { Profiler } from 'react';

function onRenderCallback(
  id: string,
  phase: 'mount' | 'update',
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
) {
  console.log('[REACT PROFILER]', {
    id,
    phase,
    actualDuration: `${actualDuration.toFixed(2)}ms`,
    baseDuration: `${baseDuration.toFixed(2)}ms`,
  });
}

function App() {
  return (
    <Profiler id="McpApp" onRender={onRenderCallback}>
      <FrontMcpBrowserProvider server={server}>
        <AppContent />
      </FrontMcpBrowserProvider>
    </Profiler>
  );
}
```

---

## Production Debugging

### Source Maps

```typescript
// vite.config.ts - Enable hidden source maps
export default defineConfig({
  build: {
    sourcemap: 'hidden', // Maps uploaded to error tracking, not served
  },
});

// Upload source maps to Sentry
// sentry-cli releases files upload-sourcemaps ./dist
```

### Error Boundaries with Debug Info

```tsx
class McpErrorBoundary extends React.Component<Props, State> {
  state = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to error tracking
    console.error('[MCP ERROR BOUNDARY]', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    // Send to monitoring
    reportError(error, {
      componentStack: errorInfo.componentStack,
      state: this.context?.store?.getState(),
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          {import.meta.env.DEV && <pre>{this.state.error?.stack}</pre>}
          <button onClick={() => this.setState({ hasError: false })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### Debug Headers

```typescript
// Add debug headers in development
const transport = new PostMessageTransport(target, {
  transformMessage: (msg) => {
    if (import.meta.env.DEV) {
      return {
        ...msg,
        _debug: {
          timestamp: Date.now(),
          source: 'frontmcp-client',
          version: __APP_VERSION__,
        },
      };
    }
    return msg;
  },
});
```

---

## Common Debug Scenarios

### "Tool call never returns"

```typescript
// Debug hanging tool calls
const timeout = 30000;
const controller = new AbortController();

const timeoutId = setTimeout(() => {
  console.error('[DEBUG] Tool call timeout:', {
    tool: name,
    args,
    pending: transport.getPendingRequests?.(),
  });
  controller.abort();
}, timeout);

try {
  const result = await server.callTool(name, args, { signal: controller.signal });
  clearTimeout(timeoutId);
  return result;
} catch (error) {
  if (error.name === 'AbortError') {
    console.error('[DEBUG] Tool call aborted after timeout');
  }
  throw error;
}
```

### "Store not updating"

```typescript
// Debug store update issues
console.log('[DEBUG] Before mutation:', JSON.stringify(store.getState()));

store.state.value = newValue;

// Check if mutation triggered
console.log('[DEBUG] After mutation:', JSON.stringify(store.getState()));

// Verify subscription is working
const unsub = store.subscribe((state) => {
  console.log('[DEBUG] Subscription triggered:', state);
});
```

### "Messages not received"

```typescript
// Debug message delivery
window.addEventListener(
  'message',
  (event) => {
    console.log('[DEBUG] Raw message received:', {
      data: event.data,
      origin: event.origin,
      source: event.source === window ? 'self' : 'other',
    });
  },
  true,
); // Use capture phase

// Check if postMessage target is correct
console.log('[DEBUG] PostMessage target:', {
  type: target.constructor.name,
  isWorker: target instanceof Worker,
  isWindow: target === window || target instanceof Window,
});
```

### "Component not rendering"

```tsx
// Debug component rendering
function DebugComponent({ name }: { name: string }) {
  const component = useComponent(name);

  console.log('[DEBUG] useComponent result:', {
    name,
    found: !!component,
    registry: __FRONTMCP__.registry?.list()?.map((c) => c.name),
  });

  if (!component) {
    return (
      <div>
        Component "{name}" not found. Available:{' '}
        {__FRONTMCP__.registry
          ?.list()
          ?.map((c) => c.name)
          .join(', ')}
      </div>
    );
  }

  return <component.render {...props} />;
}
```

---

## Debug Tools Summary

| Tool            | Purpose                   | Location          |
| --------------- | ------------------------- | ----------------- |
| `__FRONTMCP__`  | Global debug object       | Browser console   |
| Redux DevTools  | Store state inspection    | Browser extension |
| React DevTools  | Component hierarchy       | Browser extension |
| Network tab     | WebSocket/fetch debugging | Browser DevTools  |
| Console logging | Message flow tracing      | Browser DevTools  |
| Source maps     | Stack trace resolution    | Error tracking    |

---

## See Also

- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions
- [TESTING.md](./TESTING.md) - Test debugging strategies
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Production debugging setup
