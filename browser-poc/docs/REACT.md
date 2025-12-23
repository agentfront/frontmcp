# React Integration

Optional React provider and hooks for FrontMCP Browser.

## Overview

React integration provides:

- **FrontMcpBrowserProvider** - Context provider for MCP access
- **useStore** - Reactive store access with Valtio
- **useTool** - Execute MCP tools
- **useResource** - Read MCP resources
- **useMcp** - Full context access

## Provider

### FrontMcpBrowserProvider

Wraps your app to provide MCP context to all hooks.

```typescript
interface FrontMcpBrowserProviderProps {
  /**
   * The browser MCP server instance
   */
  server: BrowserMcpServer;

  /**
   * Children components
   */
  children: React.ReactNode;
}
```

### Implementation

```typescript
import { createContext, useContext, useMemo, ReactNode } from 'react';

interface FrontMcpContextValue {
  server: BrowserMcpServer;
  transport: BrowserTransport;
  store: McpStore<unknown>;
  componentRegistry: ComponentRegistry;
  rendererRegistry: RendererRegistry;
}

const FrontMcpContext = createContext<FrontMcpContextValue | null>(null);

export function FrontMcpBrowserProvider({ server, children }: FrontMcpBrowserProviderProps) {
  const value = useMemo(
    () => ({
      server,
      transport: server.getTransport(),
      store: server.getStore(),
      componentRegistry: server.getComponentRegistry(),
      rendererRegistry: server.getRendererRegistry(),
    }),
    [server],
  );

  return <FrontMcpContext.Provider value={value}>{children}</FrontMcpContext.Provider>;
}

export function useFrontMcp(): FrontMcpContextValue {
  const context = useContext(FrontMcpContext);
  if (!context) {
    throw new Error('useFrontMcp must be used within FrontMcpBrowserProvider');
  }
  return context;
}
```

### Usage

```typescript
import { FrontMcpBrowserProvider } from '@frontmcp/browser/react';

// Create server outside component
const server = await createBrowserMcpServer({
  info: { name: 'MyApp', version: '1.0.0' },
});

function App() {
  return (
    <FrontMcpBrowserProvider server={server}>
      <MainContent />
    </FrontMcpBrowserProvider>
  );
}
```

---

## Hooks

### useStore

Access the Valtio store with reactive updates.

```typescript
interface UseStoreReturn<T extends object> {
  /**
   * Reactive snapshot (read-only, triggers re-renders)
   */
  state: T;

  /**
   * Mutable store reference (for mutations)
   */
  store: T;

  /**
   * Set a value at path
   */
  set: <K extends keyof T>(key: K, value: T[K]) => void;

  /**
   * Get current value
   */
  get: <K extends keyof T>(key: K) => T[K];
}
```

#### Implementation

```typescript
import { useSnapshot } from 'valtio/react';
import { useCallback } from 'react';

export function useStore<T extends object = Record<string, unknown>>(): UseStoreReturn<T> {
  const { store } = useFrontMcp();
  const state = useSnapshot(store.state) as T;

  const set = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      (store.state as T)[key] = value;
    },
    [store],
  );

  const get = useCallback(
    <K extends keyof T>(key: K): T[K] => {
      return (store.state as T)[key];
    },
    [store],
  );

  return {
    state,
    store: store.state as T,
    set,
    get,
  };
}
```

#### Usage

```typescript
function Counter() {
  const { state, store } = useStore<{ count: number }>();

  return (
    <div>
      <p>Count: {state.count}</p>
      <button onClick={() => store.count++}>Increment</button>
      <button onClick={() => store.count--}>Decrement</button>
    </div>
  );
}
```

---

### useTool

Execute MCP tools with loading state.

```typescript
interface UseToolReturn<TInput, TOutput> {
  /**
   * Execute the tool
   */
  execute: (args: TInput) => Promise<TOutput>;

  /**
   * Loading state
   */
  isLoading: boolean;

  /**
   * Last result
   */
  result: TOutput | null;

  /**
   * Last error
   */
  error: Error | null;

  /**
   * Reset state
   */
  reset: () => void;
}

interface UseToolOptions {
  /**
   * Auto-reset on new execution
   * @default true
   */
  autoReset?: boolean;
}
```

#### Implementation

```typescript
import { useState, useCallback } from 'react';

export function useTool<TInput = unknown, TOutput = unknown>(
  toolName: string,
  options: UseToolOptions = {},
): UseToolReturn<TInput, TOutput> {
  const { transport } = useFrontMcp();
  const { autoReset = true } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<TOutput | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const execute = useCallback(
    async (args: TInput): Promise<TOutput> => {
      if (autoReset) reset();
      setIsLoading(true);
      setError(null);

      try {
        const response = await transport.request({
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
        });

        if ('error' in response) {
          throw new Error(response.error.message);
        }

        const output = response.result as TOutput;
        setResult(output);
        return output;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [toolName, transport, autoReset, reset],
  );

  return { execute, isLoading, result, error, reset };
}
```

#### Usage

```typescript
function WeatherWidget() {
  const { execute, isLoading, result, error } = useTool<{ city: string }, { temperature: number; conditions: string }>(
    'get-weather',
  );

  const handleSearch = async (city: string) => {
    try {
      await execute({ city });
    } catch (e) {
      console.error('Failed to fetch weather:', e);
    }
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Enter city"
        onKeyDown={(e) => e.key === 'Enter' && handleSearch(e.currentTarget.value)}
      />
      {isLoading && <p>Loading...</p>}
      {error && <p>Error: {error.message}</p>}
      {result && (
        <p>
          {result.temperature}°C - {result.conditions}
        </p>
      )}
    </div>
  );
}
```

---

### useResource

Read MCP resources with caching.

```typescript
interface UseResourceReturn<T> {
  /**
   * Resource data
   */
  data: T | null;

  /**
   * Loading state
   */
  isLoading: boolean;

  /**
   * Error state
   */
  error: Error | null;

  /**
   * Refetch the resource
   */
  refetch: () => Promise<void>;
}

interface UseResourceOptions {
  /**
   * Auto-fetch on mount
   * @default true
   */
  autoFetch?: boolean;

  /**
   * Refetch interval (ms)
   */
  refetchInterval?: number;
}
```

#### Implementation

```typescript
import { useState, useEffect, useCallback } from 'react';

export function useResource<T = unknown>(uri: string, options: UseResourceOptions = {}): UseResourceReturn<T> {
  const { transport } = useFrontMcp();
  const { autoFetch = true, refetchInterval } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await transport.request({
        method: 'resources/read',
        params: { uri },
      });

      if ('error' in response) {
        throw new Error(response.error.message);
      }

      const content = response.result?.contents?.[0];
      if (content?.text) {
        setData(JSON.parse(content.text) as T);
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [uri, transport]);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      refetch();
    }
  }, [autoFetch, refetch]);

  // Refetch interval
  useEffect(() => {
    if (!refetchInterval) return;

    const interval = setInterval(refetch, refetchInterval);
    return () => clearInterval(interval);
  }, [refetchInterval, refetch]);

  return { data, isLoading, error, refetch };
}
```

#### Usage

```typescript
function ComponentList() {
  const { data, isLoading, error, refetch } = useResource<ComponentDefinition[]>('components://list');

  if (isLoading) return <p>Loading components...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <div>
      <button onClick={refetch}>Refresh</button>
      <ul>
        {data?.map((component) => (
          <li key={component.name}>
            <strong>{component.name}</strong>: {component.description}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

### useMcp

Full access to MCP context.

```typescript
export function useMcp() {
  const context = useFrontMcp();

  const callTool = useCallback(
    async <T = unknown>(name: string, args: unknown): Promise<T> => {
      const response = await context.transport.request({
        method: 'tools/call',
        params: { name, arguments: args },
      });
      return response.result as T;
    },
    [context.transport],
  );

  const readResource = useCallback(
    async <T = unknown>(uri: string): Promise<T> => {
      const response = await context.transport.request({
        method: 'resources/read',
        params: { uri },
      });
      const content = response.result?.contents?.[0];
      return JSON.parse(content?.text ?? 'null') as T;
    },
    [context.transport],
  );

  const listTools = useCallback(async () => {
    const response = await context.transport.request({
      method: 'tools/list',
      params: {},
    });
    return response.result?.tools ?? [];
  }, [context.transport]);

  const listResources = useCallback(async () => {
    const response = await context.transport.request({
      method: 'resources/list',
      params: {},
    });
    return response.result?.resources ?? [];
  }, [context.transport]);

  return {
    ...context,
    callTool,
    readResource,
    listTools,
    listResources,
  };
}
```

---

### useComponent

Render a registered component.

```typescript
interface UseComponentReturn {
  /**
   * Render the component
   */
  render: (props: unknown, target?: string) => Promise<RenderResult>;

  /**
   * Component definition
   */
  definition: ComponentDefinition | null;

  /**
   * Loading state
   */
  isLoading: boolean;

  /**
   * Error state
   */
  error: Error | null;
}

export function useComponent(componentName: string): UseComponentReturn {
  const { componentRegistry, rendererRegistry } = useFrontMcp();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const definition = componentRegistry.get(componentName) ?? null;

  const render = useCallback(
    async (props: unknown, target?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const renderer = rendererRegistry.get('default');
        if (!renderer) {
          throw new Error('No default renderer registered');
        }

        return await renderer.render({
          component: componentName,
          props,
          target,
        });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [componentName, rendererRegistry],
  );

  return { render, definition, isLoading, error };
}
```

---

## UIResourceRenderer

Render HTML resources returned by MCP tools in sandboxed iframes.

> **Competitor Feature**: Similar to MCP-UI's `UIResourceRenderer` component.

### Component Interface

```typescript
interface UIResourceRendererProps {
  /**
   * The UI resource to render (from tool response)
   */
  resource: UIResource;

  /**
   * Sandbox permissions for the iframe
   * @default ['allow-scripts']
   */
  sandbox?: SandboxPermission[];

  /**
   * Container width
   */
  width?: number | string;

  /**
   * Container height
   */
  height?: number | string;

  /**
   * Callback when iframe loads
   */
  onLoad?: () => void;

  /**
   * Callback for errors
   */
  onError?: (error: Error) => void;

  /**
   * Callback for messages from iframe
   */
  onMessage?: (message: unknown) => void;

  /**
   * Optional className for container
   */
  className?: string;

  /**
   * Optional styles for container
   */
  style?: React.CSSProperties;
}

type SandboxPermission = 'allow-scripts' | 'allow-same-origin' | 'allow-forms' | 'allow-popups' | 'allow-modals';

interface UIResource {
  uri: string;
  mimeType: 'text/html;profile=mcp-app' | string;
  text: string;
  title?: string;
  width?: number;
  height?: number;
}
```

### Implementation

```typescript
import { useRef, useEffect, useState, useCallback } from 'react';

export function UIResourceRenderer({
  resource,
  sandbox = ['allow-scripts'],
  width = '100%',
  height = 400,
  onLoad,
  onError,
  onMessage,
  className,
  style,
}: UIResourceRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Create blob URL for HTML content
  const blobUrl = useMemo(() => {
    const blob = new Blob([resource.text], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [resource.text]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  // Handle iframe load
  const handleLoad = useCallback(() => {
    setIsLoading(false);
    onLoad?.();
  }, [onLoad]);

  // Handle iframe errors
  const handleError = useCallback(
    (e: Event) => {
      const err = new Error('Failed to load UI resource');
      setError(err);
      setIsLoading(false);
      onError?.(err);
    },
    [onError],
  );

  // Handle messages from iframe
  useEffect(() => {
    if (!onMessage) return;

    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from our iframe
      if (iframeRef.current?.contentWindow !== event.source) {
        return;
      }
      onMessage(event.data);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onMessage]);

  // Validate resource type
  if (!resource.mimeType.includes('text/html')) {
    return (
      <div className={className} style={style}>
        <p>Unsupported resource type: {resource.mimeType}</p>
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width,
        height,
        ...style,
      }}
    >
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f5f5f5',
          }}
        >
          Loading...
        </div>
      )}

      {error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fee',
            color: '#c00',
          }}
        >
          {error.message}
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={blobUrl}
        sandbox={sandbox.join(' ')}
        title={resource.title ?? 'MCP UI Resource'}
        onLoad={handleLoad}
        onError={handleError}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          opacity: isLoading ? 0 : 1,
          transition: 'opacity 0.2s',
        }}
      />
    </div>
  );
}
```

### Usage with Tool Results

```typescript
function FormRenderer() {
  const { execute, result, isLoading } = useTool<{ fields: FormField[] }, ToolResult>('render-form');

  // Extract UI resource from tool result
  const uiResource = result?.content?.find(
    (c): c is { type: 'resource'; resource: UIResource } =>
      c.type === 'resource' && c.resource.mimeType.includes('text/html'),
  )?.resource;

  const handleRender = () => {
    execute({
      fields: [
        { name: 'email', type: 'email', label: 'Email' },
        { name: 'message', type: 'textarea', label: 'Message' },
      ],
    });
  };

  return (
    <div>
      <button onClick={handleRender} disabled={isLoading}>
        Render Form
      </button>

      {uiResource && (
        <UIResourceRenderer
          resource={uiResource}
          sandbox={['allow-scripts', 'allow-forms']}
          height={300}
          onMessage={(msg) => console.log('Form message:', msg)}
          onError={(err) => console.error('Render error:', err)}
        />
      )}
    </div>
  );
}
```

### Security Considerations

```typescript
// Recommended sandbox settings by use case
const SANDBOX_PRESETS = {
  // Most restrictive - display only
  display: ['allow-scripts'] as SandboxPermission[],

  // Allow forms
  form: ['allow-scripts', 'allow-forms'] as SandboxPermission[],

  // Allow storage (for stateful apps)
  stateful: ['allow-scripts', 'allow-same-origin'] as SandboxPermission[],

  // Full featured (use with caution)
  full: ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-modals'] as SandboxPermission[],
};

// Usage
<UIResourceRenderer resource={resource} sandbox={SANDBOX_PRESETS.form} />;
```

### Communication with Rendered UI

**⚠️ SECURITY: Always specify target origin - never use `'*'` in production**

```typescript
// Configuration - NEVER hardcode in production
const IFRAME_ORIGIN = import.meta.env.PROD
  ? 'https://ui-resources.example.com' // Production origin
  : 'http://localhost:3000'; // Development only

// Send message to iframe with origin validation
function useIframeCommunication(
  iframeRef: RefObject<HTMLIFrameElement>,
  targetOrigin: string, // REQUIRED - no default '*'
) {
  const sendMessage = useCallback(
    (message: unknown) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: 'frontmcp', payload: message },
          targetOrigin, // ✅ Always specify explicit origin
        );
      }
    },
    [targetOrigin],
  );

  return { sendMessage };
}

// Usage
const { sendMessage } = useIframeCommunication(iframeRef, IFRAME_ORIGIN);
```

```html
<!-- In the rendered HTML - validate incoming messages -->
<script>
  // REQUIRED: Define allowed parent origins
  const ALLOWED_ORIGINS = ['https://app.example.com', 'http://localhost:3000'];

  window.addEventListener('message', (event) => {
    // ✅ ALWAYS validate origin first
    if (!ALLOWED_ORIGINS.includes(event.origin)) {
      console.warn('Rejected message from untrusted origin:', event.origin);
      return;
    }

    if (event.data?.type === 'frontmcp') {
      // Handle message from validated parent
      console.log('Received:', event.data.payload);
    }
  });

  // Send message to parent with explicit origin
  const PARENT_ORIGIN = 'https://app.example.com'; // Configure for your app
  window.parent.postMessage(
    { type: 'formSubmit', data: formData },
    PARENT_ORIGIN, // ✅ Never use '*' in production
  );
</script>
```

**❌ DANGEROUS - Never do this:**

```typescript
// These patterns are vulnerable to cross-origin attacks
window.parent.postMessage(data, '*'); // ❌ Accepts any origin
iframe.contentWindow.postMessage(data, '*'); // ❌ Sends to any origin
```

### useUIResource Hook

Convenience hook for working with UI resources:

```typescript
interface UseUIResourceReturn {
  resource: UIResource | null;
  isLoading: boolean;
  error: Error | null;
  render: () => void;
}

export function useUIResource(toolName: string, args: unknown): UseUIResourceReturn {
  const { execute, result, isLoading, error } = useTool(toolName);
  const [resource, setResource] = useState<UIResource | null>(null);

  // Extract UI resource when result changes
  useEffect(() => {
    if (result?.content) {
      const uiContent = result.content.find(
        (c): c is { type: 'resource'; resource: UIResource } =>
          c.type === 'resource' && c.resource?.mimeType?.includes('text/html'),
      );
      setResource(uiContent?.resource ?? null);
    }
  }, [result]);

  const render = useCallback(() => {
    execute(args);
  }, [execute, args]);

  return { resource, isLoading, error, render };
}

// Usage
function DynamicForm() {
  const { resource, isLoading, error, render } = useUIResource('render-form', {
    fields: [{ name: 'email', type: 'email' }],
  });

  useEffect(() => {
    render(); // Auto-render on mount
  }, []);

  if (isLoading) return <p>Loading form...</p>;
  if (error) return <p>Error: {error.message}</p>;
  if (!resource) return null;

  return <UIResourceRenderer resource={resource} />;
}
```

---

## Complete Example

```typescript
import { FrontMcpBrowserProvider, useStore, useTool, useResource } from '@frontmcp/browser/react';

// Initialize server
const server = await createBrowserMcpServer({
  info: { name: 'MyApp', version: '1.0.0' },
  store: { count: 0, user: null },
});

// Root component
function App() {
  return (
    <FrontMcpBrowserProvider server={server}>
      <Dashboard />
    </FrontMcpBrowserProvider>
  );
}

// Dashboard using hooks
function Dashboard() {
  const { state, store } = useStore<{ count: number; user: User | null }>();
  const { data: tools } = useResource('tools://list');
  const { execute: login, isLoading } = useTool('auth-login');

  const handleLogin = async () => {
    const result = await login({ email: 'user@example.com' });
    store.user = result.user;
  };

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Count: {state.count}</p>
      <button onClick={() => store.count++}>Increment</button>

      {state.user ? (
        <p>Welcome, {state.user.name}!</p>
      ) : (
        <button onClick={handleLogin} disabled={isLoading}>
          {isLoading ? 'Logging in...' : 'Login'}
        </button>
      )}

      <h2>Available Tools</h2>
      <ul>
        {tools?.map((tool) => (
          <li key={tool.name}>{tool.name}</li>
        ))}
      </ul>
    </div>
  );
}
```

---

## File Structure

```
browser-poc/src/react/
├── provider.tsx            # FrontMcpBrowserProvider
├── context.ts              # React context definition
├── hooks/
│   ├── use-store.ts        # useStore hook
│   ├── use-tool.ts         # useTool hook
│   ├── use-resource.ts     # useResource hook
│   ├── use-mcp.ts          # useMcp hook
│   └── use-component.ts    # useComponent hook
└── index.ts                # Barrel exports
```

---

## Testing

```typescript
import { renderHook, act } from '@testing-library/react-hooks';
import { FrontMcpBrowserProvider, useStore, useTool } from '@frontmcp/browser/react';

describe('useStore', () => {
  it('should return reactive state');
  it('should update on mutations');
  it('should provide set/get helpers');
});

describe('useTool', () => {
  it('should execute tools');
  it('should track loading state');
  it('should handle errors');
});

describe('useResource', () => {
  it('should fetch resources');
  it('should support refetch');
  it('should handle refetch intervals');
});
```

---

## Error Handling

### Error Boundary Component

Catch and handle errors in the MCP component tree:

```typescript
import { Component, ErrorInfo, ReactNode } from 'react';

interface McpErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface McpErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class McpErrorBoundary extends Component<McpErrorBoundaryProps, McpErrorBoundaryState> {
  constructor(props: McpErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): McpErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);
    console.error('MCP Error:', error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props;
      const { error } = this.state;

      if (typeof fallback === 'function') {
        return fallback(error!, this.reset);
      }

      return (
        fallback ?? (
          <div role="alert">
            <h2>Something went wrong</h2>
            <pre>{error?.message}</pre>
            <button onClick={this.reset}>Try again</button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
```

### Usage

```typescript
function App() {
  return (
    <FrontMcpBrowserProvider server={server}>
      <McpErrorBoundary
        fallback={(error, reset) => (
          <div>
            <p>Error: {error.message}</p>
            <button onClick={reset}>Retry</button>
          </div>
        )}
        onError={(error) => {
          // Log to analytics or error tracking service
          analytics.trackError('mcp_error', error);
        }}
      >
        <Dashboard />
      </McpErrorBoundary>
    </FrontMcpBrowserProvider>
  );
}
```

### Granular Error Boundaries

Wrap specific sections to prevent full app crashes:

```typescript
function Dashboard() {
  return (
    <div>
      <Header /> {/* Unprotected - errors bubble up */}
      <McpErrorBoundary fallback={<ToolsSectionError />}>
        <ToolsSection /> {/* Error here won't crash whole app */}
      </McpErrorBoundary>
      <McpErrorBoundary fallback={<ResourcesSectionError />}>
        <ResourcesSection /> {/* Independent error handling */}
      </McpErrorBoundary>
    </div>
  );
}
```

### Hook Error Handling

Handle errors at the hook level for more control:

```typescript
function useToolWithErrorBoundary<In, Out>(toolName: string): UseToolReturn<In, Out> & { retry: () => void } {
  const tool = useTool<In, Out>(toolName);
  const [lastArgs, setLastArgs] = useState<In | null>(null);

  const execute = async (args: In) => {
    setLastArgs(args);
    return tool.execute(args);
  };

  const retry = () => {
    if (lastArgs !== null) {
      tool.reset();
      execute(lastArgs);
    }
  };

  return { ...tool, execute, retry };
}

// Usage
function ToolComponent() {
  const { execute, result, error, isLoading, retry } = useToolWithErrorBoundary('my-tool');

  if (error) {
    return (
      <div>
        <p>Tool failed: {error.message}</p>
        <button onClick={retry}>Retry</button>
      </div>
    );
  }

  // ...
}
```

### Async Error Handling Pattern

For async operations in hooks:

```typescript
function useSafeAsync<T>() {
  const [state, setState] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    data: T | null;
    error: Error | null;
  }>({
    status: 'idle',
    data: null,
    error: null,
  });

  const execute = useCallback(async (asyncFn: () => Promise<T>) => {
    setState((s) => ({ ...s, status: 'loading', error: null }));

    try {
      const data = await asyncFn();
      setState({ status: 'success', data, error: null });
      return data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState((s) => ({ ...s, status: 'error', error }));
      throw error;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: 'idle', data: null, error: null });
  }, []);

  return { ...state, execute, reset };
}

// Usage in component
function DataFetcher() {
  const { status, data, error, execute, reset } = useSafeAsync<Data>();
  const { readResource } = useMcp();

  useEffect(() => {
    execute(() => readResource('data://config'));
  }, []);

  if (status === 'loading') return <p>Loading...</p>;
  if (status === 'error') return <ErrorDisplay error={error!} onRetry={reset} />;
  if (status === 'success') return <DataDisplay data={data!} />;
  return null;
}
```

### Transport Error Handling

Handle transport-level errors:

```typescript
function useTransportStatus() {
  const { transport } = useFrontMcp();
  const [isConnected, setIsConnected] = useState(transport.isConnected);
  const [lastError, setLastError] = useState<Error | null>(null);

  useEffect(() => {
    // Monitor connection status
    const checkConnection = () => {
      setIsConnected(transport.isConnected);
    };

    // Poll connection status
    const interval = setInterval(checkConnection, 5000);

    return () => clearInterval(interval);
  }, [transport]);

  return { isConnected, lastError };
}

// Usage
function ConnectionStatusBanner() {
  const { isConnected, lastError } = useTransportStatus();

  if (!isConnected) {
    return (
      <div className="connection-error">
        <p>Connection lost. Attempting to reconnect...</p>
        {lastError && <p>Error: {lastError.message}</p>}
      </div>
    );
  }

  return null;
}
```

### Error Types

Common error types to handle:

```typescript
// Custom error classes for better error handling
export class McpToolError extends Error {
  constructor(message: string, public readonly toolName: string, public readonly code?: number) {
    super(message);
    this.name = 'McpToolError';
  }
}

export class McpResourceError extends Error {
  constructor(message: string, public readonly uri: string, public readonly code?: number) {
    super(message);
    this.name = 'McpResourceError';
  }
}

export class McpTransportError extends Error {
  constructor(message: string, public readonly isRecoverable: boolean = true) {
    super(message);
    this.name = 'McpTransportError';
  }
}

// Type guard for error handling
function isMcpError(error: unknown): error is McpToolError | McpResourceError {
  return error instanceof McpToolError || error instanceof McpResourceError;
}
```

---

## Server-Side Rendering (SSR)

FrontMCP Browser supports SSR/SSG scenarios with special considerations.

> **Note**: For complete SSR patterns including store dehydration/hydration, see [STORE.md#server-side-rendering-ssr](./STORE.md#server-side-rendering-ssr).

### SSR Considerations

1. **IndexedDB is client-only** - Persistence must be disabled or mocked during SSR
2. **Transport requires browser APIs** - Use lazy initialization
3. **Store state hydration** - Dehydrate on server, hydrate on client

### SSR-Safe Provider

```tsx
import { FrontMcpBrowserProvider } from '@frontmcp/browser/react';
import { createBrowserMcpServer } from '@frontmcp/browser';

function App() {
  const [server, setServer] = useState<BrowserMcpServer | null>(null);

  useEffect(() => {
    // Initialize client-side only
    async function init() {
      const srv = await createBrowserMcpServer({
        info: { name: 'MyApp', version: '1.0.0' },
        store: window.__INITIAL_STATE__ ?? { count: 0 },
        persistence: { name: 'my-app-db' },
      });
      setServer(srv);
    }
    init();
  }, []);

  if (!server) {
    // SSR fallback - render without MCP context
    return <AppShell />;
  }

  return (
    <FrontMcpBrowserProvider server={server}>
      <AppWithMcp />
    </FrontMcpBrowserProvider>
  );
}
```

### Next.js Integration

```tsx
// pages/_app.tsx
import dynamic from 'next/dynamic';

// Dynamically import MCP provider (client-side only)
const McpProvider = dynamic(() => import('../components/McpProvider'), { ssr: false });

export default function App({ Component, pageProps }) {
  return (
    <McpProvider initialState={pageProps.initialState}>
      <Component {...pageProps} />
    </McpProvider>
  );
}
```

### Remix Integration

```tsx
// app/root.tsx
import { useHydrated } from 'remix-utils';

export default function App() {
  const hydrated = useHydrated();

  return (
    <html>
      <body>
        {hydrated ? (
          <McpProvider>
            <Outlet />
          </McpProvider>
        ) : (
          <Outlet />
        )}
      </body>
    </html>
  );
}
```
