# App Bridge (Host SDK)

The App Bridge enables embedding MCP-powered applications within sandboxed iframes, providing secure communication between host applications and embedded MCP servers.

## Overview

The App Bridge consists of two parts:

1. **Host SDK** (`@frontmcp/browser/host`) - For applications that embed MCP apps
2. **Child SDK** (`@frontmcp/browser/child`) - For applications that run inside iframes

This architecture enables:

- **Secure Isolation** - MCP apps run in sandboxed iframes
- **Cross-Origin Communication** - Type-safe postMessage protocol
- **Permission Control** - Fine-grained sandbox permissions
- **Lifecycle Management** - Mount, unmount, and connection handling

## Quick Start

### Host Application

```typescript
import { createAppHost, IframeParentTransport } from '@frontmcp/browser/host';

// Create the app host
const host = createAppHost({
  container: document.getElementById('app-container'),
  sandbox: ['allow-scripts', 'allow-forms'],
  allowedOrigins: ['https://trusted-app.example.com'],
});

// Load an MCP app
const app = await host.load({
  src: 'https://trusted-app.example.com/mcp-app',
  name: 'MyMCPApp',
});

// Connect to the app's MCP server
const transport = new IframeParentTransport({ iframe: app.iframe });
await transport.connect();

// Call tools with auth context
const result = await transport.callTool('search', {
  query: 'hello',
  _auth: { userId: getCurrentUser().id },
});
```

### Embedded Application (Child)

```typescript
import { createAppChild, IframeChildTransport } from '@frontmcp/browser/child';

// Initialize the child SDK
const child = createAppChild({
  allowedOrigins: ['https://host-app.example.com'],
});

// Create MCP server with iframe transport
const transport = new IframeChildTransport({ parent: window.parent });

const server = await createBrowserMcpServer({
  info: { name: 'EmbeddedApp', version: '1.0.0' },
  transport,
});

// Register tools
server.registerTool('search', {
  description: 'Search functionality',
  inputSchema: z.object({ query: z.string() }),
  execute: async (args) => ({ results: await doSearch(args.query) }),
});

// Signal ready to host
child.ready();
```

## Host SDK API

### `createAppHost(options)`

Creates an app host instance for managing embedded MCP applications.

```typescript
interface AppHostOptions {
  /**
   * Container element for iframe mounting
   */
  container: HTMLElement;

  /**
   * Default sandbox permissions for iframes
   * @default ['allow-scripts']
   */
  sandbox?: SandboxPermission[];

  /**
   * Allowed origins for cross-origin communication
   */
  allowedOrigins?: string[];

  /**
   * Default iframe styles
   */
  style?: Partial<CSSStyleDeclaration>;

  /**
   * Connection timeout in milliseconds
   * @default 30000
   */
  connectionTimeout?: number;

  /**
   * Human-in-the-loop configuration
   */
  hitl?: HiTLConfig;

  /**
   * Authentication context to pass to embedded apps
   */
  authContext?: AuthContext;

  /**
   * Error handler
   */
  onError?: (error: AppHostError) => void;
}

interface AuthContext {
  /**
   * Bearer token for API authentication
   */
  token?: string;

  /**
   * Current user identifier
   */
  userId?: string;

  /**
   * User's permissions/roles
   */
  permissions?: string[];

  /**
   * Session identifier for tracking
   */
  sessionId?: string;

  /**
   * Custom claims or metadata
   */
  claims?: Record<string, unknown>;
}

const host = createAppHost(options);
```

### `AppHost` Interface

```typescript
interface AppHost {
  /**
   * Load an MCP app into an iframe
   */
  load(config: AppLoadConfig): Promise<LoadedApp>;

  /**
   * Unload a specific app
   */
  unload(appId: string): Promise<void>;

  /**
   * Unload all apps
   */
  unloadAll(): Promise<void>;

  /**
   * Get a loaded app by ID
   */
  get(appId: string): LoadedApp | undefined;

  /**
   * List all loaded apps
   */
  list(): LoadedApp[];

  /**
   * Listen for app events
   */
  on(event: AppHostEvent, handler: AppEventHandler): () => void;

  /**
   * Destroy the host and cleanup
   */
  destroy(): Promise<void>;
}
```

### `AppLoadConfig`

```typescript
interface AppLoadConfig {
  /**
   * URL of the MCP app to load
   */
  src: string;

  /**
   * Unique identifier for this app instance
   * @default auto-generated UUID
   */
  id?: string;

  /**
   * Human-readable name
   */
  name?: string;

  /**
   * Override default sandbox permissions
   */
  sandbox?: SandboxPermission[];

  /**
   * Iframe dimensions
   */
  width?: number | string;
  height?: number | string;

  /**
   * Additional iframe attributes
   */
  attributes?: Record<string, string>;

  /**
   * Data to pass to the app on load
   */
  initialData?: unknown;

  /**
   * Whether to auto-connect on load
   * @default true
   */
  autoConnect?: boolean;
}
```

### `LoadedApp`

```typescript
interface LoadedApp {
  /**
   * Unique app identifier
   */
  readonly id: string;

  /**
   * App name
   */
  readonly name: string;

  /**
   * The iframe element
   */
  readonly iframe: HTMLIFrameElement;

  /**
   * Connection state
   */
  readonly state: 'loading' | 'ready' | 'connected' | 'error' | 'disconnected';

  /**
   * MCP transport for this app
   */
  readonly transport: IframeParentTransport;

  /**
   * App metadata from MCP server info
   */
  readonly serverInfo?: ServerInfo;

  /**
   * Connect to the app's MCP server
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the app
   */
  disconnect(): Promise<void>;

  /**
   * Call a tool on the app
   */
  callTool<T>(name: string, args: unknown): Promise<T>;

  /**
   * Read a resource from the app
   */
  readResource(uri: string): Promise<ReadResourceResult>;

  /**
   * Get a prompt from the app
   */
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>;

  /**
   * Send a message to the app
   */
  postMessage(type: string, payload: unknown): void;

  /**
   * Listen for messages from the app
   */
  onMessage(handler: (type: string, payload: unknown) => void): () => void;
}
```

## Child SDK API

### `createAppChild(options)`

Initializes the child SDK for embedded MCP applications.

```typescript
interface AppChildOptions {
  /**
   * Allowed parent origins for security
   */
  allowedOrigins?: string[];

  /**
   * Handler for initial data from host
   */
  onInitialData?: (data: unknown) => void;

  /**
   * Error handler
   */
  onError?: (error: AppChildError) => void;
}

const child = createAppChild(options);
```

### `AppChild` Interface

```typescript
interface AppChild {
  /**
   * Signal to host that app is ready
   */
  ready(): void;

  /**
   * Get initial data sent by host
   */
  getInitialData<T>(): T | undefined;

  /**
   * Send a message to the host
   */
  postMessage(type: string, payload: unknown): void;

  /**
   * Listen for messages from the host
   */
  onMessage(handler: (type: string, payload: unknown) => void): () => void;

  /**
   * Request additional permissions from host
   */
  requestPermission(permission: string): Promise<boolean>;

  /**
   * Get current sandbox permissions
   */
  getPermissions(): string[];
}
```

## Sandbox Permissions

Control iframe capabilities through sandbox permissions:

```typescript
type SandboxPermission =
  | 'allow-scripts' // Execute JavaScript
  | 'allow-forms' // Submit forms
  | 'allow-same-origin' // Access same-origin APIs
  | 'allow-popups' // Open new windows
  | 'allow-modals' // Show alert/confirm/prompt
  | 'allow-downloads' // Trigger downloads
  | 'allow-pointer-lock' // Lock pointer
  | 'allow-orientation-lock' // Lock screen orientation
  | 'allow-presentation' // Start presentation
  | 'allow-top-navigation' // Navigate top frame
  | 'allow-top-navigation-by-user-activation'
  | 'allow-storage-access-by-user-activation';
```

### Security Recommendations

```typescript
// Minimal permissions (most secure)
const minimalSandbox: SandboxPermission[] = ['allow-scripts'];

// Form-capable app
const formSandbox: SandboxPermission[] = ['allow-scripts', 'allow-forms'];

// App needing storage
const storageSandbox: SandboxPermission[] = [
  'allow-scripts',
  'allow-same-origin', // Required for localStorage/IndexedDB
];

// Full-featured app (use sparingly)
const fullSandbox: SandboxPermission[] = [
  'allow-scripts',
  'allow-forms',
  'allow-same-origin',
  'allow-modals',
  'allow-downloads',
];
```

## Communication Protocol

### Message Types

```typescript
// Host → Child messages
type HostMessage =
  | { type: 'mcp:request'; id: string; method: string; params?: unknown }
  | { type: 'app:init'; data?: unknown }
  | { type: 'app:focus' }
  | { type: 'app:blur' }
  | { type: 'custom'; payload: unknown };

// Child → Host messages
type ChildMessage =
  | { type: 'mcp:response'; id: string; result?: unknown; error?: unknown }
  | { type: 'mcp:notification'; method: string; params?: unknown }
  | { type: 'app:ready'; serverInfo: ServerInfo }
  | { type: 'app:resize'; width: number; height: number }
  | { type: 'custom'; payload: unknown };
```

### Handshake Protocol

```
┌──────────┐                    ┌──────────┐
│   Host   │                    │  Child   │
└────┬─────┘                    └────┬─────┘
     │                               │
     │  1. Create iframe, load src   │
     │ ─────────────────────────────►│
     │                               │
     │  2. app:init (initialData)    │
     │ ─────────────────────────────►│
     │                               │
     │  3. app:ready (serverInfo)    │
     │ ◄─────────────────────────────│
     │                               │
     │  4. MCP initialize request    │
     │ ─────────────────────────────►│
     │                               │
     │  5. MCP initialize response   │
     │ ◄─────────────────────────────│
     │                               │
     │    [Connection established]   │
     │                               │
```

## React Integration

### `AppHostProvider`

```tsx
import { AppHostProvider, useAppHost, useLoadedApp } from '@frontmcp/browser/react';

function App() {
  return (
    <AppHostProvider sandbox={['allow-scripts', 'allow-forms']} allowedOrigins={['https://trusted.example.com']}>
      <Dashboard />
    </AppHostProvider>
  );
}
```

### `useAppHost`

```tsx
function Dashboard() {
  const host = useAppHost();

  const loadApp = async () => {
    const app = await host.load({
      src: 'https://trusted.example.com/widget',
      name: 'Widget',
    });
    await app.connect();
  };

  return (
    <div>
      <button onClick={loadApp}>Load Widget</button>
      <AppList />
    </div>
  );
}
```

### `useLoadedApp`

```tsx
function AppInstance({ appId }: { appId: string }) {
  const app = useLoadedApp(appId);

  if (!app) return null;

  const handleSearch = async () => {
    const result = await app.callTool('search', { query: 'hello' });
    console.log(result);
  };

  return (
    <div>
      <h3>{app.name}</h3>
      <p>State: {app.state}</p>
      <button onClick={handleSearch}>Search</button>
    </div>
  );
}
```

### `EmbeddedApp` Component

```tsx
import { EmbeddedApp } from '@frontmcp/browser/react';

function Widget() {
  return (
    <EmbeddedApp
      src="https://trusted.example.com/widget"
      name="Widget"
      sandbox={['allow-scripts', 'allow-forms']}
      width={400}
      height={300}
      onReady={(app) => console.log('App ready:', app.serverInfo)}
      onError={(error) => console.error('App error:', error)}
      onMessage={(type, payload) => console.log('Message:', type, payload)}
    />
  );
}
```

## Advanced Usage

### Multiple Apps

```typescript
const host = createAppHost({
  container: document.getElementById('apps'),
});

// Load multiple apps
const [searchApp, chartApp, formApp] = await Promise.all([
  host.load({ src: 'https://apps.example.com/search', name: 'Search' }),
  host.load({ src: 'https://apps.example.com/chart', name: 'Chart' }),
  host.load({ src: 'https://apps.example.com/form', name: 'Form' }),
]);

// Connect to all
await Promise.all([searchApp.connect(), chartApp.connect(), formApp.connect()]);

// Coordinate between apps
const searchResults = await searchApp.callTool('search', { query: 'sales' });
await chartApp.callTool('render', { data: searchResults });
```

### App-to-App Communication

```typescript
// Host coordinates communication between apps
searchApp.onMessage((type, payload) => {
  if (type === 'results:updated') {
    chartApp.postMessage('data:update', payload);
  }
});
```

### Human-in-the-Loop Integration

```typescript
const host = createAppHost({
  container: document.getElementById('apps'),
  hitl: {
    alwaysConfirm: ['delete', 'purchase', 'submit'],
    onConfirmationRequired: async (action, args) => {
      return await showConfirmDialog(`Allow ${action}?`, args);
    },
  },
});

// Tool calls requiring confirmation will trigger the dialog
const result = await app.callTool('delete', { id: '123' });
// User sees: "Allow delete?" with args displayed
```

### Custom Message Protocol

```typescript
// Host side
app.postMessage('theme:change', { mode: 'dark' });

app.onMessage((type, payload) => {
  if (type === 'analytics:event') {
    trackEvent(payload);
  }
});

// Child side
child.onMessage((type, payload) => {
  if (type === 'theme:change') {
    applyTheme(payload.mode);
  }
});

child.postMessage('analytics:event', {
  name: 'button_click',
  properties: { button: 'submit' },
});
```

## Authentication

### Passing Auth Context to Apps

```typescript
const host = createAppHost({
  container: document.getElementById('apps'),
  authContext: {
    token: getJWTToken(),
    userId: currentUser.id,
    permissions: currentUser.permissions,
    sessionId: getSessionId(),
    claims: {
      org: currentUser.organizationId,
      role: currentUser.role,
    },
  },
});

// Auth context is automatically passed during handshake
const app = await host.load({
  src: 'https://trusted-app.example.com/widget',
  name: 'SecureWidget',
});
```

### Receiving Auth in Embedded App

```typescript
// In the embedded child app
const child = createAppChild({
  allowedOrigins: ['https://host-app.example.com'],
  onInitialData: (data) => {
    if (data.auth) {
      // Validate and use auth context
      setAuthContext(data.auth);
    }
  },
});

// Access auth in tool handlers
server.registerTool('secure-action', {
  description: 'Action requiring auth',
  inputSchema: z.object({
    action: z.string(),
    _auth: z
      .object({
        userId: z.string(),
        permissions: z.array(z.string()),
      })
      .optional(),
  }),
  execute: async (args) => {
    // Verify permissions before executing
    if (!args._auth?.permissions?.includes('write')) {
      throw new UnauthorizedError('Write permission required');
    }
    return performSecureAction(args.action, args._auth.userId);
  },
});
```

### Token Refresh

```typescript
// Host-side: Update auth context when token refreshes
const host = createAppHost({
  /* ... */
});

// When token refreshes
onTokenRefresh((newToken) => {
  host.updateAuthContext({
    token: newToken,
  });

  // Notify all loaded apps
  host.list().forEach((app) => {
    app.postMessage('auth:refresh', { token: newToken });
  });
});

// Child-side: Listen for auth updates
child.onMessage((type, payload) => {
  if (type === 'auth:refresh') {
    updateStoredToken(payload.token);
  }
});
```

### Per-Tool Authorization

```typescript
// Define tool permissions
const toolPermissions: Record<string, string[]> = {
  'read-data': ['read'],
  'write-data': ['read', 'write'],
  'delete-data': ['read', 'write', 'delete'],
  'admin-action': ['admin'],
};

// Middleware to check permissions
function withAuthorization<T>(toolName: string, execute: (args: T, auth: AuthContext) => Promise<unknown>) {
  return async (args: T & { _auth?: AuthContext }) => {
    const required = toolPermissions[toolName] || [];
    const has = args._auth?.permissions || [];

    const missing = required.filter((p) => !has.includes(p));
    if (missing.length > 0) {
      throw new UnauthorizedError(`Missing permissions: ${missing.join(', ')}`);
    }

    return execute(args, args._auth!);
  };
}

// Usage
server.registerTool('delete-data', {
  description: 'Delete data (requires delete permission)',
  inputSchema: z.object({ id: z.string() }),
  execute: withAuthorization('delete-data', async (args, auth) => {
    await auditLog('delete', args.id, auth.userId);
    return deleteData(args.id);
  }),
});
```

---

## Error Handling

```typescript
const host = createAppHost({
  container: document.getElementById('apps'),
  onError: (error) => {
    if (error instanceof AppLoadError) {
      console.error('Failed to load app:', error.src);
    } else if (error instanceof AppConnectionError) {
      console.error('Connection failed:', error.appId);
    } else if (error instanceof AppTimeoutError) {
      console.error('App timed out:', error.appId);
    }
  },
});

// Per-app error handling
try {
  const app = await host.load({
    src: 'https://untrusted.example.com/app',
  });
} catch (error) {
  if (error instanceof OriginNotAllowedError) {
    console.error('Origin not in allowlist');
  }
}
```

## Security Best Practices

1. **Always specify `allowedOrigins`** - Never accept messages from unknown origins
2. **Use minimal sandbox permissions** - Only add permissions when needed
3. **Validate all messages** - Don't trust message content blindly
4. **Use HiTL for sensitive operations** - Require user confirmation
5. **Implement CSP headers** - Add frame-ancestors directive
6. **Monitor for anomalies** - Log and alert on suspicious behavior

```typescript
// Secure host configuration
const host = createAppHost({
  container: document.getElementById('apps'),
  allowedOrigins: ['https://trusted-app.example.com', 'https://another-trusted.example.com'],
  sandbox: ['allow-scripts'], // Minimal permissions
  hitl: {
    alwaysConfirm: ['delete', 'purchase', 'transfer'],
    confirmationTimeout: 30000,
    timeoutBehavior: 'deny',
  },
  onError: (error) => {
    // Log security events
    securityLogger.log(error);
  },
});
```

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall architecture documentation
- [TRANSPORT.md](./TRANSPORT.md) - Transport layer including IframeParentTransport
- [SECURITY.md](./SECURITY.md) - Security patterns and sandboxing
- [UI-RESOURCES.md](./UI-RESOURCES.md) - UI resource delivery for embedded apps
