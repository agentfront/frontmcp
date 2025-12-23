# API Reference

Complete API documentation for FrontMCP Browser.

> **Related Documentation**:
>
> - [SECURITY.md](./SECURITY.md) - Security best practices
> - [LIMITATIONS.md](./LIMITATIONS.md) - Known limitations
> - [ARCHITECTURE.md](./ARCHITECTURE.md) - System design

## Table of Contents

- [Server](#server)
- [Transport](#transport)
- [Store](#store)
- [Schema Store](#schema-store)
- [Telemetry](#telemetry)
- [Registry](#registry)
- [UI Resources](#ui-resources)
- [React](#react)
- [Errors](#errors)
- [Constants](#constants)

---

## Server

### createBrowserMcpServer

Factory function to create a browser MCP server.

```typescript
function createBrowserMcpServer(options: BrowserMcpServerOptions): Promise<BrowserMcpServer>;
```

#### Options

| Property      | Type                                | Required | Description                                |
| ------------- | ----------------------------------- | -------- | ------------------------------------------ |
| `info`        | `{ name: string; version: string }` | Yes      | Server information                         |
| `transport`   | `BrowserTransport`                  | No       | Custom transport (default: EventTransport) |
| `store`       | `Record<string, unknown>`           | No       | Initial store state                        |
| `persistence` | `PersistenceOptions`                | No       | Store persistence config                   |

#### Example

```typescript
const server = await createBrowserMcpServer({
  info: { name: 'MyApp', version: '1.0.0' },
  store: { count: 0, user: null },
  persistence: { name: 'my-app-db' },
});
```

### BrowserMcpServer

Main server class.

#### Methods

| Method                   | Return Type         | Description            |
| ------------------------ | ------------------- | ---------------------- |
| `getTransport()`         | `BrowserTransport`  | Get transport instance |
| `getStore()`             | `McpStore<T>`       | Get store instance     |
| `getComponentRegistry()` | `ComponentRegistry` | Get component registry |
| `getRendererRegistry()`  | `RendererRegistry`  | Get renderer registry  |
| `close()`                | `void`              | Shutdown server        |

---

## Transport

### EventTransport

Event-based transport for same-context communication.

```typescript
class EventTransport implements BrowserTransport, RequestTransport
```

#### Constructor

```typescript
new EventTransport(
  emitter: MinimalEventEmitter,
  options?: EventTransportOptions
)
```

#### Options

| Property       | Type     | Default          | Description             |
| -------------- | -------- | ---------------- | ----------------------- |
| `sendEvent`    | `string` | `'mcp:response'` | Event name for outgoing |
| `receiveEvent` | `string` | `'mcp:request'`  | Event name for incoming |

#### Methods

| Method      | Signature                                              | Description           |
| ----------- | ------------------------------------------------------ | --------------------- |
| `send`      | `(message: JSONRPCMessage) => void`                    | Send message          |
| `onMessage` | `(handler: MessageHandler) => () => void`              | Subscribe to messages |
| `request`   | `<T>(req: JSONRPCRequest) => Promise<JSONRPCResponse>` | Request/response      |
| `close`     | `() => void`                                           | Close transport       |

#### Properties

| Property      | Type      | Description       |
| ------------- | --------- | ----------------- |
| `isConnected` | `boolean` | Connection status |

#### Example

```typescript
import mitt from 'mitt';

const emitter = mitt();
const transport = new EventTransport(emitter);

transport.onMessage((msg) => console.log('Received:', msg));
transport.send({ jsonrpc: '2.0', method: 'ping' });
```

---

### PostMessageTransport

Transport for WebWorker/iframe communication.

> **⚠️ SECURITY WARNING**: When using `PostMessageTransport` with `Window` targets (iframes, popups), you **MUST** specify an explicit `origin`. Using the default `'*'` origin in production is a critical security vulnerability. See [SECURITY.md](./SECURITY.md#origin-validation) for details.

```typescript
class PostMessageTransport implements BrowserTransport, RequestTransport
```

#### Constructor

```typescript
new PostMessageTransport(
  target: Worker | Window | MessagePort,
  options?: PostMessageTransportOptions
)
```

#### Options

| Property      | Type     | Default | Description                                                        |
| ------------- | -------- | ------- | ------------------------------------------------------------------ |
| `origin`      | `string` | `'*'`   | ⚠️ **REQUIRED for Window targets** - Never use `'*'` in production |
| `messageType` | `string` | `'mcp'` | Message type identifier                                            |

#### Example

```typescript
// ✅ SECURE: Worker (origin not needed)
const worker = new Worker('./worker.js', { type: 'module' });
const transport = new PostMessageTransport(worker);

// ✅ SECURE: Iframe with explicit origin
const iframe = document.getElementById('mcp-frame') as HTMLIFrameElement;
const transport = new PostMessageTransport(iframe.contentWindow!, {
  origin: 'https://trusted-app.example.com', // Always specify!
});

// ❌ DANGEROUS: Never do this in production
const transport = new PostMessageTransport(iframe.contentWindow!);
// Default origin '*' accepts messages from ANY origin
```

---

### createSimpleEmitter

Create a minimal EventEmitter for transport.

```typescript
function createSimpleEmitter(): MinimalEventEmitter;
```

#### Example

```typescript
const emitter = createSimpleEmitter();
const transport = new EventTransport(emitter);
```

---

## Store

### createMcpStore

Create a Valtio-based reactive store.

```typescript
function createMcpStore<T extends object>(initial: T): McpStore<T>;
```

#### Example

```typescript
const store = createMcpStore({
  count: 0,
  user: null,
  todos: [],
});

// Mutate directly
store.state.count++;

// Subscribe to changes
store.subscribe(() => {
  console.log('Changed:', store.getSnapshot());
});
```

### McpStore

Reactive store interface.

#### Properties

| Property | Type | Description         |
| -------- | ---- | ------------------- |
| `state`  | `T`  | Mutable proxy state |

#### Methods

| Method         | Signature                                                | Description              |
| -------------- | -------------------------------------------------------- | ------------------------ |
| `getSnapshot`  | `() => T`                                                | Get immutable snapshot   |
| `subscribe`    | `(callback: () => void) => () => void`                   | Subscribe to all changes |
| `subscribeKey` | `<K>(key: K, cb: (v: T[K]) => void) => () => void`       | Subscribe to key         |
| `onMutation`   | `(cb: (ops: MutationOperation[]) => void) => () => void` | Subscribe with ops       |

---

### createPersistedStore

Create a store with persistence.

```typescript
function createPersistedStore<T extends object>(initial: T, options: PersistenceOptions): Promise<McpStore<T>>;
```

#### Options

| Property    | Type       | Default   | Description          |
| ----------- | ---------- | --------- | -------------------- |
| `name`      | `string`   | -         | Database name        |
| `storeName` | `string`   | `'state'` | Object store name    |
| `include`   | `string[]` | All       | Keys to persist      |
| `exclude`   | `string[]` | None      | Keys to exclude      |
| `debounce`  | `number`   | `100`     | Debounce writes (ms) |

#### Example

```typescript
const store = await createPersistedStore({ count: 0 }, { name: 'my-app', debounce: 200 });
```

---

## Schema Store

Schema-driven stores with auto-registered actions. See [SCHEMA-STORE.md](./SCHEMA-STORE.md) for full documentation.

### defineStore

Create a store from a Zod schema where actions automatically become MCP tools.

```typescript
function defineStore<TShape, TActions>(
  options: DefineStoreOptions<TShape, TActions>,
): SchemaStore<z.infer<z.ZodObject<TShape>>, TActions>;
```

#### Options

| Property      | Type                        | Required | Description                                |
| ------------- | --------------------------- | -------- | ------------------------------------------ |
| `name`        | `string`                    | Yes      | Store name (used for tool/resource naming) |
| `schema`      | `z.ZodObject`               | Yes      | Zod schema defining state shape            |
| `actions`     | `Record<string, ActionDef>` | Yes      | Action definitions                         |
| `persistence` | `PersistenceConfig`         | No       | Storage configuration                      |
| `resources`   | `ResourceConfig`            | No       | Resource exposure config                   |

#### Example

```typescript
const todoStore = defineStore({
  name: 'todos',
  schema: z.object({
    items: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          done: z.boolean(),
        }),
      )
      .default([]),
  }),
  actions: {
    addTodo: {
      input: z.object({ text: z.string() }),
      output: z.object({ id: z.string() }),
      execute: async (input, ctx) => {
        const id = crypto.randomUUID();
        ctx.state.items.push({ id, text: input.text, done: false });
        return { id };
      },
    },
  },
});

// Auto-registers: todos:addTodo tool, store://todos resource
todoStore.registerWith(server);
```

---

## Telemetry

Browser event capture with PII filtering. See [TELEMETRY.md](./TELEMETRY.md) for full documentation.

### createEventCollector

Create an event collector to capture browser telemetry.

```typescript
function createEventCollector(options: EventCollectorOptions): EventCollector;
```

#### Options

| Property        | Type                  | Required | Description                            |
| --------------- | --------------------- | -------- | -------------------------------------- |
| `categories`    | `EventCategoryConfig` | Yes      | Event categories to capture            |
| `filters`       | `PiiFilterPlugin[]`   | No       | PII filter plugins (default: built-in) |
| `buffer`        | `EventBufferConfig`   | No       | Event buffer configuration             |
| `notifications` | `NotificationConfig`  | No       | MCP notification settings              |
| `autoStart`     | `boolean`             | No       | Auto-start collection (default: false) |

#### Example

```typescript
import { createEventCollector, createBuiltInPiiFilter } from '@frontmcp/browser/telemetry';

const collector = createEventCollector({
  categories: {
    interaction: { keyboard: true, click: true },
    network: { fetch: true, xhr: true },
    errors: { console: true, unhandled: true },
    logs: { level: 'warn' },
  },
  filters: [createBuiltInPiiFilter()],
  autoStart: true,
});

// Register with server (exposes events:// resources)
collector.registerWith(server);
```

---

### createBuiltInPiiFilter

Create the built-in PII filter with common patterns.

```typescript
function createBuiltInPiiFilter(options?: BuiltInPiiFilterOptions): PiiFilterPlugin;
```

#### Options

| Property             | Type            | Description                      |
| -------------------- | --------------- | -------------------------------- |
| `patterns`           | `PatternConfig` | Enable/disable specific patterns |
| `additionalPatterns` | `PiiPattern[]`  | Custom patterns to add           |
| `allowlistFields`    | `string[]`      | Fields to never filter           |
| `blocklistFields`    | `string[]`      | Fields to always filter          |

#### Built-in Patterns

- `email` - Email addresses
- `creditCard` - Credit card numbers
- `ssn` - Social Security Numbers
- `phone` - Phone numbers
- `apiKey` - API keys
- `bearerToken` - Bearer tokens
- `jwt` - JWT tokens
- `ipAddress` - IP addresses

#### Example

```typescript
const filter = createBuiltInPiiFilter({
  patterns: {
    email: true,
    creditCard: true,
    apiKey: true,
  },
  additionalPatterns: [{ name: 'internal-id', pattern: /INTERNAL-[A-Z0-9]{8}/g }],
});
```

---

### createPiiFilterPlugin

Create a custom PII filter plugin.

```typescript
function createPiiFilterPlugin(options: PiiFilterPluginOptions): PiiFilterPlugin;
```

#### Options

| Property   | Type             | Required | Description                         |
| ---------- | ---------------- | -------- | ----------------------------------- |
| `name`     | `string`         | Yes      | Plugin identifier                   |
| `priority` | `number`         | No       | Execution priority (higher = first) |
| `patterns` | `PiiPattern[]`   | No       | Regex patterns to auto-redact       |
| `filter`   | `FilterFunction` | No       | Custom filter function              |

#### Example

```typescript
const healthcareFilter = createPiiFilterPlugin({
  name: 'hipaa',
  priority: 100,
  patterns: [{ name: 'mrn', pattern: /MRN[:\s]*\d{6,10}/gi }],
  filter(event, ctx) {
    // Drop events from patient URLs
    if (event.data?.url?.includes('/patient/')) {
      return null;
    }
    return event;
  },
});
```

---

### Telemetry MCP Resources

| Resource                | Description                    |
| ----------------------- | ------------------------------ |
| `events://recent`       | Recent events (all categories) |
| `events://errors`       | Error events only              |
| `events://network`      | Network requests               |
| `events://interactions` | User interactions              |
| `events://logs`         | Console logs                   |
| `events://stats`        | Collector statistics           |

---

## Registry

### createComponentRegistry

Create a component registry.

```typescript
function createComponentRegistry(): ComponentRegistry;
```

### ComponentRegistry

#### Methods

| Method           | Signature                                            | Description        |
| ---------------- | ---------------------------------------------------- | ------------------ |
| `register`       | `<P>(def: ComponentDefinition<P>) => void`           | Register component |
| `get`            | `(name: string) => ComponentDefinition \| undefined` | Get by name        |
| `list`           | `() => ComponentDefinition[]`                        | List all           |
| `listByCategory` | `(category: string) => ComponentDefinition[]`        | Filter by category |
| `search`         | `(tags: string[]) => ComponentDefinition[]`          | Search by tags     |
| `has`            | `(name: string) => boolean`                          | Check existence    |

### ComponentDefinition

```typescript
interface ComponentDefinition<Props = unknown> {
  name: string;
  description: string;
  propsSchema: ZodSchema<Props>;
  defaultProps?: Partial<Props>;
  category?: string;
  tags?: string[];
  examples?: ComponentExample[];
}
```

#### Example

```typescript
const registry = createComponentRegistry();

registry.register({
  name: 'Button',
  description: 'A clickable button',
  propsSchema: z.object({
    label: z.string(),
    variant: z.enum(['primary', 'secondary']).default('primary'),
  }),
  category: 'inputs',
  tags: ['interactive', 'form'],
});
```

---

### createRendererRegistry

Create a renderer registry.

```typescript
function createRendererRegistry(): RendererRegistry;
```

### RendererRegistry

#### Methods

| Method     | Signature                                           | Description       |
| ---------- | --------------------------------------------------- | ----------------- |
| `register` | `(renderer: RendererDefinition) => void`            | Register renderer |
| `get`      | `(name: string) => RendererDefinition \| undefined` | Get by name       |
| `list`     | `() => RendererDefinition[]`                        | List all          |

### RendererDefinition

```typescript
interface RendererDefinition<Props = unknown, Result = unknown> {
  name: string;
  description: string;
  inputSchema: ZodSchema;
  render: (input: RenderInput<Props>) => Promise<Result>;
}

interface RenderInput<Props> {
  component: string;
  props: Props;
  target?: string;
}
```

#### Example

```typescript
const registry = createRendererRegistry();

registry.register({
  name: 'default',
  description: 'Default DOM renderer',
  inputSchema: z.object({
    component: z.string(),
    props: z.record(z.unknown()),
    target: z.string().optional(),
  }),
  async render({ component, props, target }) {
    // Render to DOM
    return { elementId: 'rendered-123' };
  },
});
```

---

## UI Resources

> **Related**: See [UI-RESOURCES.md](./UI-RESOURCES.md) for comprehensive documentation.

### createUIResource

Create a UI resource for HTML content rendering.

```typescript
function createUIResource(options: CreateUIResourceOptions): UIResource;
```

#### Options

| Property  | Type               | Required | Description                            |
| --------- | ------------------ | -------- | -------------------------------------- |
| `html`    | `string`           | Yes      | HTML content to render                 |
| `title`   | `string`           | No       | Resource title                         |
| `width`   | `number`           | No       | Suggested width                        |
| `height`  | `number \| 'auto'` | No       | Suggested height                       |
| `uri`     | `string`           | No       | Custom URI (auto-generated if omitted) |
| `css`     | `string`           | No       | Additional CSS to inject               |
| `scripts` | `string[]`         | No       | External scripts to load               |

#### Returns

```typescript
interface UIResource {
  uri: string; // Resource URI for _meta.resourceUri
  mimeType: string; // 'text/html;profile=mcp-app'
  content: string; // Full HTML document
  dimensions?: {
    width: number;
    height: number;
  };
}
```

#### Example

```typescript
// In tool execution
server.registerTool('render-chart', {
  description: 'Render data as a chart',
  inputSchema: z.object({
    data: z.array(z.object({ label: z.string(), value: z.number() })),
    type: z.enum(['bar', 'line', 'pie']),
  }),
  execute: async (args) => {
    const uiResource = createUIResource({
      html: generateChartHtml(args.data, args.type),
      title: 'Data Chart',
      width: 600,
      height: 400,
    });

    return {
      success: true,
      chartType: args.type,
      _meta: {
        resourceUri: uiResource.uri, // Links result to UI
      },
    };
  },
});
```

---

### UIResourceRenderer

React component for rendering UI resources in sandboxed iframes.

> **⚠️ SECURITY**: UI resources are always rendered in sandboxed iframes for security isolation. See [SECURITY.md](./SECURITY.md#iframe-sandboxing).

```typescript
function UIResourceRenderer(props: UIResourceRendererProps): JSX.Element;
```

#### Props

| Property    | Type                         | Required | Description                |
| ----------- | ---------------------------- | -------- | -------------------------- |
| `resource`  | `UIResource`                 | Yes      | UI resource to render      |
| `sandbox`   | `SandboxPermission[]`        | No       | Iframe sandbox permissions |
| `width`     | `number \| string`           | No       | Iframe width               |
| `height`    | `number \| string`           | No       | Iframe height              |
| `onLoad`    | `() => void`                 | No       | Callback when loaded       |
| `onError`   | `(error: Error) => void`     | No       | Error callback             |
| `onMessage` | `(message: unknown) => void` | No       | Message from iframe        |

#### Example

```tsx
function ChartDisplay({ toolResult }) {
  const resourceUri = toolResult._meta?.resourceUri;
  const { resource, isLoading } = useUIResource(resourceUri);

  if (isLoading) return <p>Loading...</p>;
  if (!resource) return <p>No UI available</p>;

  return (
    <UIResourceRenderer
      resource={resource}
      sandbox={['allow-scripts']}
      width={600}
      height={400}
      onMessage={(msg) => console.log('From iframe:', msg)}
    />
  );
}
```

---

### useUIResource

Hook to fetch and manage a UI resource.

```typescript
function useUIResource(uri: string | undefined): {
  resource: UIResource | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};
```

#### Example

```tsx
function DynamicUI({ uri }) {
  const { resource, isLoading, error, refetch } = useUIResource(uri);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!resource) return null;

  return <UIResourceRenderer resource={resource} />;
}
```

---

## React

### FrontMcpBrowserProvider

React context provider.

```typescript
function FrontMcpBrowserProvider(props: { server: BrowserMcpServer; children: React.ReactNode }): JSX.Element;
```

#### Example

```typescript
<FrontMcpBrowserProvider server={server}>
  <App />
</FrontMcpBrowserProvider>
```

---

### useStore

Access reactive store.

```typescript
function useStore<T extends object>(): {
  state: T; // Reactive snapshot (read-only)
  store: T; // Mutable reference
  set: <K>(key: K, value: T[K]) => void;
  get: <K>(key: K) => T[K];
};
```

#### Example

```typescript
function Counter() {
  const { state, store } = useStore<{ count: number }>();

  return <button onClick={() => store.count++}>Count: {state.count}</button>;
}
```

---

### useTool

Execute MCP tools.

```typescript
function useTool<TInput, TOutput>(
  toolName: string,
  options?: { autoReset?: boolean },
): {
  execute: (args: TInput) => Promise<TOutput>;
  isLoading: boolean;
  result: TOutput | null;
  error: Error | null;
  reset: () => void;
};
```

#### Example

```typescript
function SearchForm() {
  const { execute, isLoading, result } = useTool<{ query: string }, { results: string[] }>('search');

  return (
    <div>
      <input onKeyDown={(e) => e.key === 'Enter' && execute({ query: e.currentTarget.value })} />
      {isLoading && <p>Searching...</p>}
      {result?.results.map((r) => (
        <p key={r}>{r}</p>
      ))}
    </div>
  );
}
```

---

### useResource

Read MCP resources.

```typescript
function useResource<T>(
  uri: string,
  options?: {
    autoFetch?: boolean;
    refetchInterval?: number;
  },
): {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};
```

#### Example

```typescript
function ComponentList() {
  const { data, isLoading } = useResource<ComponentDefinition[]>('components://list');

  if (isLoading) return <p>Loading...</p>;

  return (
    <ul>
      {data?.map((c) => (
        <li key={c.name}>{c.name}</li>
      ))}
    </ul>
  );
}
```

---

### useMcp

Full MCP context access.

```typescript
function useMcp(): {
  server: BrowserMcpServer;
  transport: BrowserTransport;
  store: McpStore<unknown>;
  componentRegistry: ComponentRegistry;
  rendererRegistry: RendererRegistry;
  callTool: <T>(name: string, args: unknown) => Promise<T>;
  readResource: <T>(uri: string) => Promise<T>;
  listTools: () => Promise<Tool[]>;
  listResources: () => Promise<Resource[]>;
};
```

#### Example

```typescript
function AdvancedComponent() {
  const { callTool, readResource, componentRegistry } = useMcp();

  const handleAction = async () => {
    const result = await callTool('my-tool', { arg: 'value' });
    console.log(result);
  };

  return <button onClick={handleAction}>Execute</button>;
}
```

---

### useComponent

Render registered components.

```typescript
function useComponent(componentName: string): {
  render: (props: unknown, target?: string) => Promise<RenderResult>;
  definition: ComponentDefinition | null;
  isLoading: boolean;
  error: Error | null;
};
```

#### Example

```typescript
function DynamicRenderer() {
  const { render, definition } = useComponent('Form');

  const handleRender = async () => {
    await render({ fields: [{ name: 'email', type: 'email' }] }, '#form-container');
  };

  return (
    <div>
      <p>Component: {definition?.name}</p>
      <button onClick={handleRender}>Render Form</button>
      <div id="form-container" />
    </div>
  );
}
```

---

## Types

### JSONRPCMessage

```typescript
type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;
```

### JSONRPCRequest

```typescript
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}
```

### JSONRPCResponse

```typescript
interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
```

### MutationOperation

```typescript
interface MutationOperation {
  type: 'set' | 'delete';
  path: string[];
  value?: unknown;
}
```

### MinimalEventEmitter

```typescript
interface MinimalEventEmitter {
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
}
```

---

## Errors

### TransportError

Base class for transport-related errors.

```typescript
class TransportError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'TransportError';
  }
}
```

### TransportClosedError

Thrown when attempting to send on a closed transport.

```typescript
class TransportClosedError extends TransportError {
  constructor() {
    super('Transport is closed', 'TRANSPORT_CLOSED');
  }
}
```

### RequestTimeoutError

Thrown when a request times out waiting for response.

```typescript
class RequestTimeoutError extends TransportError {
  constructor(public readonly requestId: string | number) {
    super(`Request ${requestId} timed out`, 'REQUEST_TIMEOUT');
  }
}
```

### RequestCancelledError

Thrown when a request is cancelled.

```typescript
class RequestCancelledError extends TransportError {
  constructor(public readonly requestId: string | number) {
    super(`Request ${requestId} was cancelled`, 'REQUEST_CANCELLED');
  }
}
```

### McpError

Base class for MCP protocol errors.

```typescript
class McpError extends Error {
  constructor(message: string, public readonly code: number, public readonly data?: unknown) {
    super(message);
    this.name = 'McpError';
  }

  toJsonRpcError(): { code: number; message: string; data?: unknown } {
    return { code: this.code, message: this.message, data: this.data };
  }
}
```

### ResourceNotFoundError

Thrown when a requested resource doesn't exist.

```typescript
class ResourceNotFoundError extends McpError {
  constructor(public readonly uri: string) {
    super(`Resource not found: ${uri}`, -32002, { uri });
  }
}
```

### ToolNotFoundError

Thrown when a requested tool doesn't exist.

```typescript
class ToolNotFoundError extends McpError {
  constructor(public readonly toolName: string) {
    super(`Tool not found: ${toolName}`, -32601, { tool: toolName });
  }
}
```

### InvalidParamsError

Thrown when tool/resource parameters are invalid.

```typescript
class InvalidParamsError extends McpError {
  constructor(message: string, public readonly errors?: unknown) {
    super(message, -32602, { errors });
  }
}
```

---

## Constants

### MCP Error Codes

Standard JSON-RPC and MCP error codes.

```typescript
const MCP_ERROR_CODES = {
  // JSON-RPC standard errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // MCP-specific errors
  RESOURCE_NOT_FOUND: -32002,
  TOOL_EXECUTION_ERROR: -32001,
} as const;
```

### Default Timeouts

```typescript
const DEFAULT_TIMEOUTS = {
  /** Request timeout in milliseconds */
  REQUEST: 30000,

  /** Heartbeat interval in milliseconds */
  HEARTBEAT_INTERVAL: 30000,

  /** Heartbeat timeout in milliseconds */
  HEARTBEAT_TIMEOUT: 5000,

  /** Store persistence debounce in milliseconds */
  PERSISTENCE_DEBOUNCE: 100,
} as const;
```

### Protocol Version

```typescript
const MCP_PROTOCOL_VERSION = '2024-11-05';

const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2024-10-07'] as const;
```

### Event Names

Default event names for EventTransport.

```typescript
const EVENT_NAMES = {
  /** Event for messages from client to server */
  REQUEST: 'mcp:request',

  /** Event for messages from server to client */
  RESPONSE: 'mcp:response',
} as const;
```

### Message Types

For PostMessageTransport and BroadcastChannelTransport.

```typescript
const MESSAGE_TYPES = {
  /** Default message type identifier */
  MCP: 'mcp',
} as const;
```
