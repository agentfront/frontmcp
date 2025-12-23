# Architecture

High-level system design for FrontMCP Browser.

> **SDK Integration**: Browser-poc uses `@frontmcp/sdk` with build-time module replacement via `frontmcp build --adapter browser`. See [BUILD.md](./BUILD.md) for build configuration and [SDK-INTEGRATION.md](./SDK-INTEGRATION.md) for extension patterns.

## Table of Contents

- [Build-Time Platform Abstraction](#build-time-platform-abstraction)
- [System Overview](#system-overview)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Execution Contexts](#execution-contexts)
- [Security Considerations](#security-considerations)
- [SDK Reuse vs Browser-Specific](#sdk-reuse-vs-browser-specific)
- [Environment Comparison](#environment-comparison)
- [MCP Protocol Version](#mcp-protocol-version)
- [MCP Capabilities Scope](#mcp-capabilities-scope)
- [Initialize Handler](#initialize-handler)
- [W3C Standard Alignment](#w3c-standard-alignment)
- [App Bridge Architecture](#app-bridge-architecture)
- [UI Resource Delivery](#ui-resource-delivery)
- [Extension Points](#extension-points)

---

## Build-Time Platform Abstraction

The SDK uses **build-time module replacement** instead of runtime detection or separate entry points. This preserves `declare module` augmentation for decorator metadata while enabling browser support.

### How It Works

```bash
# Build for browser - uses esbuild with module replacement
frontmcp build --adapter browser --outDir dist/browser

# Build for Node.js - uses tsc directly
frontmcp build --adapter node --outDir dist
```

The browser build replaces Node.js-specific modules at compile time:

| Node.js Module           | Browser Replacement                     |
| ------------------------ | --------------------------------------- |
| `crypto` / `node:crypto` | `@frontmcp/sdk/platform/browser-crypto` |
| `url`                    | Native `URL` API                        |
| `buffer`                 | `Uint8Array` polyfill                   |

### Compile-Time Constants

Use `process.env.FRONTMCP_BROWSER` for platform-specific code:

```typescript
if (process.env.FRONTMCP_BROWSER === 'true') {
  // Browser-specific code - eliminated in Node.js builds
  console.log('Running in browser');
} else {
  // Node.js-specific code - eliminated in browser builds
  console.log('Running in Node.js');
}
```

### Benefits

- **Single SDK package** - No `/core` split, preserves module augmentation
- **Zero runtime overhead** - Platform detection happens at build time
- **Full type safety** - TypeScript decorators work unchanged
- **Tree-shaking** - Unused platform code is eliminated

### SDK Imports (Same for Both Platforms)

```typescript
// Works in both Node.js and browser builds
import { Tool, Resource, ToolContext } from '@frontmcp/sdk';
```

See [BUILD.md](./BUILD.md) for detailed build configuration.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           WEB APPLICATION                                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                        React / Vue / Vanilla                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐   │  │
│  │  │  useStore() │  │  useTool()  │  │  useResource()          │   │  │
│  │  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘   │  │
│  └─────────┼────────────────┼─────────────────────┼─────────────────┘  │
│            │                │                     │                     │
│  ┌─────────▼────────────────▼─────────────────────▼─────────────────┐  │
│  │                    FrontMcpBrowserProvider                        │  │
│  │  ┌─────────────────────────────────────────────────────────────┐ │  │
│  │  │                   BrowserMcpServer                           │ │  │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │ │  │
│  │  │  │   Store     │  │  Registry   │  │  MCP Server         │  │ │  │
│  │  │  │  (Valtio)   │  │ (Components)│  │  (JSON-RPC)         │  │ │  │
│  │  │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │ │  │
│  │  │         │                │                    │              │ │  │
│  │  │         └────────────────┼────────────────────┘              │ │  │
│  │  │                          │                                   │ │  │
│  │  │                   ┌──────▼──────┐                            │ │  │
│  │  │                   │  Transport  │                            │ │  │
│  │  │                   │  (Events)   │                            │ │  │
│  │  │                   └──────┬──────┘                            │ │  │
│  │  └──────────────────────────┼───────────────────────────────────┘ │  │
│  └─────────────────────────────┼─────────────────────────────────────┘  │
│                                │                                        │
└────────────────────────────────┼────────────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │      AI Agent Client    │
                    │   (Claude, GPT, etc.)   │
                    └─────────────────────────┘
```

## Core Components

### 1. BrowserMcpServer

The main server instance that runs in the browser, built on @frontmcp/sdk patterns.

**SDK Patterns Used:**

- Extends registry patterns from `RegistryAbstract`
- Uses entry patterns from `ToolEntry`/`ResourceEntry`
- Adapts notification patterns from `NotificationService`
- Reuses MCP error classes directly

**Responsibilities:**

- Initialize and manage MCP server instance
- Register tools, resources, and prompts
- Handle JSON-RPC requests/responses
- Manage transport connections

**Key Differences from Node.js SDK:**

- No HTTP server (Express/Fastify) → EventEmitter transport
- No file system access → IndexedDB/localStorage
- No external authentication → Token injection
- Event-based transport only

### 2. Transport Layer

Abstraction for bidirectional message passing, extending SDK's `TransportAdapterBase`.

**SDK Pattern:** Both transports extend `TransportAdapterBase` from `@frontmcp/sdk/core`, implementing browser-specific `connect()`, `send()`, and `destroy()` methods.

| Transport                     | Use Case    | Communication        | SDK Base               |
| ----------------------------- | ----------- | -------------------- | ---------------------- |
| `EventTransportAdapter`       | Main thread | EventEmitter pattern | `TransportAdapterBase` |
| `PostMessageTransportAdapter` | WebWorker   | `postMessage()` API  | `TransportAdapterBase` |

**Message Flow:**

```
AI Agent                    Transport                   MCP Server
   │                            │                            │
   │──── JSON-RPC Request ─────▶│                            │
   │                            │──── onMessage() ──────────▶│
   │                            │                            │
   │                            │◀──── send() ───────────────│
   │◀─── JSON-RPC Response ─────│                            │
```

### 3. Store (Valtio)

Reactive state management with MCP integration.

**Features:**

- Proxy-based reactivity (automatic change detection)
- Framework-agnostic (works without React)
- MCP notifications on mutations
- Optional persistence (IndexedDB/localStorage)

**MCP Integration:**

```
Store Mutation ──▶ Valtio Subscribe ──▶ MCP Notification
     │                                        │
     │                                        ▼
     │                          notifications/resources/updated
     │                                { uri: 'store://key' }
     │                                        │
     ▼                                        ▼
 UI Updates                            AI Agent Notified
```

### 4. Component Registry

Registry for UI components exposed as MCP resources, extending SDK's `RegistryAbstract`.

**SDK Pattern:** Both `ComponentRegistry` and `RendererRegistry` extend `RegistryAbstract` from @frontmcp/sdk, providing O(1) lookups and consistent indexing.

**Pattern:**

- **Components = MCP Resources** (read-only metadata)
- **Renderers = MCP Tools** (executable actions)

```
┌─────────────────────────────────────────────────────────────┐
│                    Component Registry                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Button    │  │    Form     │  │    CodeEditor       │  │
│  │  component  │  │  component  │  │     component       │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                    │              │
│         └────────────────┼────────────────────┘              │
│                          ▼                                   │
│              MCP Resource: component://{name}                │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Renderer (MCP Tool)                       │
│                                                              │
│  AI calls: tools/call { name: 'render', arguments: {...} }  │
│                          │                                   │
│                          ▼                                   │
│           Developer-defined render function                  │
│                          │                                   │
│                          ▼                                   │
│                   DOM manipulation                           │
└─────────────────────────────────────────────────────────────┘
```

### 5. React Integration (Optional)

Provider and hooks for React applications.

```
FrontMcpBrowserProvider
         │
         ├── useStore()      ──▶ Valtio useSnapshot
         ├── useTool()       ──▶ transport.request()
         ├── useResource()   ──▶ transport.request()
         └── useMcp()        ──▶ Full context access
```

## Data Flow

### Request Flow (AI → App)

```
1. AI Agent sends JSON-RPC request
   │
2. Transport receives message
   │
3. MCP Server routes to handler
   │
4. Handler executes (tool/resource/prompt)
   │
5. Response sent back via transport
   │
6. AI Agent receives result
```

### Notification Flow (App → AI)

```
1. Store mutation (state.count++)
   │
2. Valtio detects change via Proxy
   │
3. MCP notification triggered
   │
4. Transport sends notification
   │
5. AI Agent receives update
```

## Execution Contexts

### Main Thread

```typescript
// Everything runs in main thread
const server = await createBrowserMcpServer({
  transport: new EventTransport(emitter),
});
```

**Pros:** Simple, direct DOM access
**Cons:** Can block UI on heavy operations

### WebWorker

```typescript
// worker.ts - MCP server in worker
const server = await createBrowserMcpServer({
  transport: new PostMessageTransport(self),
});

// main.ts - Client in main thread
const client = new McpBrowserClient(worker);
```

**Pros:** Non-blocking, isolated execution
**Cons:** No direct DOM access, serialization overhead

## Security Considerations

### Same-Origin Policy

- All communication is same-origin (no CORS issues)
- postMessage uses origin validation

### No External Auth

- No OAuth flows (would require server)
- Token passed from parent application if needed
- Session stored in memory/IndexedDB

### Input Validation

- All MCP inputs validated via Zod schemas
- Tool arguments sanitized before execution

## SDK Reuse vs Browser-Specific

Browser-poc **extends** `@frontmcp/sdk/core` (not the main entry point). Here's what's reused vs adapted:

### Reused from SDK/core (Direct Import)

| SDK Module             | Import               | Usage                                           |
| ---------------------- | -------------------- | ----------------------------------------------- |
| `RegistryAbstract`     | `@frontmcp/sdk/core` | Base for ComponentRegistry, RendererRegistry    |
| `ToolEntry`            | `@frontmcp/sdk/core` | Base for browser tools with Zod validation      |
| `ResourceEntry`        | `@frontmcp/sdk/core` | Base for browser resources                      |
| `TransportAdapterBase` | `@frontmcp/sdk/core` | Base for EventTransport, PostMessageTransport   |
| `NoOpHostAdapter`      | `@frontmcp/sdk/core` | No-op HTTP server for browser                   |
| `McpError` classes     | `@frontmcp/sdk/core` | ResourceNotFoundError, InvalidParamsError, etc. |
| `MCP_ERROR_CODES`      | `@frontmcp/sdk/core` | Standard error codes                            |
| `initializeConfig`     | `@frontmcp/sdk/core` | Runtime config (REQUIRED for browser)           |
| `generateUUID`         | `@frontmcp/sdk/core` | Web Crypto UUID generation                      |

### Adapted for Browser

| SDK Pattern           | Browser Adaptation                                |
| --------------------- | ------------------------------------------------- |
| `NotificationService` | `BrowserNotificationAdapter` (EventEmitter-based) |
| HTTP/SSE Transport    | EventEmitter/postMessage transport                |
| Flow system           | Simplified pre/execute/finalize stages            |
| Session management    | In-memory only (no Redis)                         |
| `process.env`         | `initializeConfig()` + `getConfig()`              |

### Browser-Specific (No SDK Equivalent)

| Module                   | Description                          |
| ------------------------ | ------------------------------------ |
| `ValtioStore`            | Reactive state with Valtio proxy     |
| `IndexedDB/localStorage` | Browser persistence                  |
| `ComponentRegistry`      | UI component discovery               |
| React hooks              | `useStore`, `useTool`, `useResource` |

> **Full Details:** See [SDK-INTEGRATION.md](./SDK-INTEGRATION.md) for extension patterns and import guide.

## Environment Comparison

| Feature   | Node.js SDK      | Browser POC              |
| --------- | ---------------- | ------------------------ |
| Transport | HTTP/SSE         | EventEmitter/postMessage |
| Server    | Express/Fastify  | None (event-based)       |
| Crypto    | Node.js `crypto` | Web Crypto API           |
| Storage   | Redis/File       | IndexedDB/localStorage   |
| Auth      | OAuth/JWT/JWKS   | Token injection          |
| Process   | `process.env`    | Config object            |

---

## MCP Protocol Version

### Version Negotiation

FrontMCP Browser supports MCP protocol version `2024-11-05` (or latest stable).

```typescript
// Initialize request from client
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "clientInfo": {
      "name": "AI Agent",
      "version": "1.0.0"
    },
    "capabilities": {
      "roots": { "listChanged": true },
      "sampling": {}
    }
  }
}

// Initialize response from server
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": {
      "name": "MyBrowserMCP",
      "version": "1.0.0"
    },
    "capabilities": {
      "tools": { "listChanged": true },
      "resources": { "subscribe": true, "listChanged": true }
    }
  }
}
```

### Initialization Flow

```
Client                                    Server
   │                                         │
   │───── initialize ───────────────────────▶│
   │      { protocolVersion, capabilities }  │
   │                                         │
   │◀──── initialize result ─────────────────│
   │      { protocolVersion, capabilities }  │
   │                                         │
   │───── initialized (notification) ───────▶│
   │                                         │
   │           CONNECTION READY              │
```

### Protocol Version Handling

```typescript
const SUPPORTED_VERSIONS = ['2024-11-05', '2024-10-07'];
const LATEST_VERSION = '2024-11-05';

function handleInitialize(params: InitializeParams): InitializeResult {
  const requestedVersion = params.protocolVersion;

  // Check if requested version is supported
  if (!SUPPORTED_VERSIONS.includes(requestedVersion)) {
    // Fall back to latest supported version
    console.warn(`Protocol version ${requestedVersion} not supported, using ${LATEST_VERSION}`);
  }

  return {
    protocolVersion: LATEST_VERSION,
    serverInfo: {
      name: serverConfig.name,
      version: serverConfig.version,
    },
    capabilities: buildCapabilities(),
  };
}
```

---

## MCP Capabilities Scope

### Supported Features

| Feature                                | Status    | Notes                             |
| -------------------------------------- | --------- | --------------------------------- |
| `tools/list`                           | Supported | List registered tools             |
| `tools/call`                           | Supported | Execute tools                     |
| `resources/list`                       | Supported | List available resources          |
| `resources/read`                       | Supported | Read resource content             |
| `resources/subscribe`                  | Supported | Subscribe to resource changes     |
| `resources/unsubscribe`                | Supported | Unsubscribe from resources        |
| `notifications/resources/updated`      | Supported | Resource change notifications     |
| `notifications/resources/list_changed` | Supported | Resource list change notification |
| `notifications/tools/list_changed`     | Supported | Tool list change notification     |
| `ping`                                 | Supported | Connection health check           |

### Out of Scope (Not Implemented)

| Feature                       | Reason                                          |
| ----------------------------- | ----------------------------------------------- |
| `prompts/list`, `prompts/get` | Prompts are typically AI-side, not browser-side |
| `sampling/createMessage`      | Requires LLM access, not available in browser   |
| `logging/setLevel`            | Browser console is the logging target           |
| `roots/list`                  | File system roots don't apply to browser        |
| OAuth/PKCE flows              | Requires server-side component                  |
| JWKS/JWT validation           | Requires server-side key management             |

### Future Consideration

These features may be added if use cases emerge:

| Feature        | Consideration                                   |
| -------------- | ----------------------------------------------- |
| Prompts        | If browser-side prompt templates are needed     |
| Logging        | If structured logging to MCP client is required |
| Custom methods | Extension points for domain-specific needs      |

---

## Initialize Handler

### Server Capabilities

```typescript
interface ServerCapabilities {
  tools?: {
    listChanged?: boolean; // Can notify when tool list changes
  };
  resources?: {
    subscribe?: boolean; // Supports resource subscriptions
    listChanged?: boolean; // Can notify when resource list changes
  };
  prompts?: {
    listChanged?: boolean; // Not supported in browser
  };
  logging?: {}; // Not supported in browser
}

function buildCapabilities(): ServerCapabilities {
  return {
    tools: {
      listChanged: componentRegistry.hasAny(),
    },
    resources: {
      subscribe: true,
      listChanged: true,
    },
    // prompts and logging intentionally omitted
  };
}
```

### Client Capabilities Handling

```typescript
interface ClientCapabilities {
  roots?: {
    listChanged?: boolean;
  };
  sampling?: {}; // Ignored - server can't request sampling
}

function handleClientCapabilities(capabilities: ClientCapabilities): void {
  // Store for reference, but browser server doesn't use most client capabilities
  this.clientCapabilities = capabilities;

  // Log if client expects unsupported features
  if (capabilities.sampling) {
    console.warn('Client expects sampling capability, which is not supported in browser');
  }
}
```

### Initialization State Machine

```typescript
type ConnectionState = 'disconnected' | 'initializing' | 'ready' | 'error';

class ConnectionManager {
  private state: ConnectionState = 'disconnected';

  async handleMessage(message: JSONRPCMessage): Promise<void> {
    if (isRequest(message)) {
      if (message.method === 'initialize') {
        if (this.state !== 'disconnected') {
          throw new Error('Already initialized');
        }
        this.state = 'initializing';
        // Handle initialize...
        return;
      }

      if (this.state !== 'ready') {
        throw new Error('Connection not initialized');
      }
      // Handle other requests...
    }

    if (isNotification(message)) {
      if (message.method === 'initialized') {
        if (this.state !== 'initializing') {
          throw new Error('Unexpected initialized notification');
        }
        this.state = 'ready';
        return;
      }
      // Handle other notifications...
    }
  }
}
```

---

## W3C Standard Alignment

### navigator.modelContext Polyfill

FrontMCP Browser provides a polyfill for the emerging W3C `navigator.modelContext` API, enabling compatibility with AI browsers and clients expecting this standard interface.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Web Application                                  │
│                                                                          │
│    // Standard W3C API (via polyfill)                                   │
│    const mcp = await navigator.modelContext.connect();                  │
│    mcp.registerTool('search', { ... });                                 │
│    mcp.registerResource('docs', { ... });                               │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │              navigator.modelContext Polyfill                        │ │
│  │  ┌──────────────────────────────────────────────────────────────┐  │ │
│  │  │               BrowserMcpServer (internal)                     │  │ │
│  │  └──────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                │                                         │
└────────────────────────────────┼─────────────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │      AI Agent Client    │
                    │   (W3C Compatible)      │
                    └─────────────────────────┘
```

### Polyfill API

```typescript
// Usage - import once to install polyfill
import '@frontmcp/browser/polyfill';

// Then use standard API
const mcp = await navigator.modelContext.connect({
  serverInfo: { name: 'MyApp', version: '1.0.0' },
});

// Dynamic tool registration
mcp.registerTool('search', {
  description: 'Search documents',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  handler: async (args) => ({ results: [] }),
});

// Dynamic resource registration
mcp.registerResource('docs', {
  description: 'Application documents',
  handler: async () => ({ contents: [{ text: '...' }] }),
});

// Check connection status
if (mcp.isConnected()) {
  console.log('MCP server running');
}

// Disconnect
mcp.disconnect();
```

### Compatibility Goals

| Standard API                       | FrontMCP Mapping            |
| ---------------------------------- | --------------------------- |
| `navigator.modelContext.connect()` | `createBrowserMcpServer()`  |
| `mcp.registerTool()`               | `server.registerTool()`     |
| `mcp.registerResource()`           | `server.registerResource()` |
| `mcp.registerPrompt()`             | `server.registerPrompt()`   |
| `mcp.isConnected()`                | `server.isConnected()`      |
| `mcp.disconnect()`                 | `server.close()`            |

---

## App Bridge Architecture

### Overview

The App Bridge enables host applications (Claude Desktop, chat UIs, AI browsers) to embed FrontMCP applications securely within sandboxed iframes.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      HOST APPLICATION                                    │
│                  (Claude Desktop, Chat UI)                               │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         App Host SDK                                │ │
│  │  ┌──────────────────────────────────────────────────────────────┐  │ │
│  │  │  createAppHost()                                              │  │ │
│  │  │    ├── container: '#app-container'                           │  │ │
│  │  │    ├── sandbox: ['allow-scripts', 'allow-same-origin']       │  │ │
│  │  │    ├── allowedOrigins: ['https://app.example.com']           │  │ │
│  │  │    ├── onToolCall: (name, args) => ai.callTool(name, args)   │  │ │
│  │  │    └── onResourceRequest: (uri) => ai.readResource(uri)      │  │ │
│  │  └──────────────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────┬──────────────────────────────┘ │
│                                        │                                 │
│  ┌─────────────────────────────────────▼──────────────────────────────┐ │
│  │                    Sandboxed Iframe                                 │ │
│  │  ┌──────────────────────────────────────────────────────────────┐  │ │
│  │  │              FrontMCP Application                             │  │ │
│  │  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │  │ │
│  │  │  │ IframeChild    │  │ MCP Server     │  │ Components     │  │  │ │
│  │  │  │ Transport      │  │                │  │                │  │  │ │
│  │  │  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘  │  │ │
│  │  └──────────┼───────────────────┼───────────────────┼───────────┘  │ │
│  └─────────────┼───────────────────┼───────────────────┼──────────────┘ │
│                │                   │                   │                 │
│            postMessage         MCP Protocol       UI Events              │
└────────────────┼───────────────────┼───────────────────┼─────────────────┘
                 │                   │                   │
        ┌────────▼───────────────────▼───────────────────▼────────┐
        │                    AI Agent                              │
        │            (Tools, Resources, Decisions)                 │
        └─────────────────────────────────────────────────────────┘
```

### Host SDK API

```typescript
import { createAppHost } from '@frontmcp/browser/host';

const host = createAppHost({
  // Container element for iframe
  container: document.getElementById('app-container'),

  // Sandbox restrictions
  sandbox: ['allow-scripts', 'allow-same-origin', 'allow-forms'],

  // Security
  allowedOrigins: ['https://trusted-app.com'],
  csp: "default-src 'self'; script-src 'self'",

  // AI integration callbacks
  onToolCall: async (name, args) => {
    // Forward tool calls to AI
    return await aiClient.callTool(name, args);
  },
  onResourceRequest: async (uri) => {
    // Forward resource requests to AI
    return await aiClient.readResource(uri);
  },

  // Event handlers
  onAppMessage: (message) => {
    console.log('App sent:', message);
  },
  onAppError: (error) => {
    console.error('App error:', error);
  },
});

// Load an application
const connection = await host.loadApp('https://app.example.com/frontmcp');

// Send messages to app
connection.send({ type: 'config', theme: 'dark' });

// Listen for app events
connection.on('render-complete', (data) => {
  console.log('App rendered:', data);
});

// Unload app
host.unloadApp();
```

### Iframe Transports

**IframeParentTransport** - For host applications:

```typescript
class IframeParentTransport implements BrowserTransport {
  constructor(
    iframe: HTMLIFrameElement,
    options: {
      targetOrigin: string;
    },
  );

  send(message: JSONRPCMessage): void;
  onMessage(handler: MessageHandler): () => void;
  close(): void;
}
```

**IframeChildTransport** - For embedded applications:

```typescript
class IframeChildTransport implements BrowserTransport {
  constructor(options: { parentOrigin: string });

  send(message: JSONRPCMessage): void;
  onMessage(handler: MessageHandler): () => void;
  close(): void;

  // Handshake with parent
  async connect(): Promise<void>;
}
```

### Connection Handshake

```
Host (Parent)                              App (Child Iframe)
     │                                              │
     │◀──────── iframe load complete ───────────────│
     │                                              │
     │───── mcp:connect { capabilities } ──────────▶│
     │                                              │
     │◀──── mcp:connected { capabilities } ─────────│
     │                                              │
     │           CONNECTION ESTABLISHED             │
     │                                              │
     │───── mcp:request { method, params } ────────▶│
     │                                              │
     │◀──── mcp:response { result } ────────────────│
```

---

## UI Resource Delivery

### HTML Resource Pattern

Tools can return renderable HTML that AI clients display in sandboxed iframes.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AI Client                                         │
│                                                                          │
│  1. AI calls: tools/call { name: 'render-form', args: {...} }           │
│                                                                          │
│  2. Tool returns:                                                        │
│     {                                                                    │
│       content: [{                                                        │
│         type: 'resource',                                               │
│         resource: {                                                      │
│           uri: 'ui://form/abc123',                                      │
│           mimeType: 'text/html;profile=mcp-app',                        │
│           text: '<form>...</form>'                                      │
│         }                                                               │
│       }],                                                               │
│       _meta: { 'mcp:resourceUri': 'ui://form/abc123' }                  │
│     }                                                                    │
│                                                                          │
│  3. AI Client renders HTML in sandboxed iframe                          │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  <iframe sandbox="allow-scripts allow-forms">                       │ │
│  │    <form>...</form>                                                 │ │
│  │  </iframe>                                                          │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### createUIResource Helper

```typescript
import { createUIResource } from '@frontmcp/browser';

@Tool({
  name: 'render-form',
  description: 'Render a form and return HTML',
})
class RenderFormTool {
  async execute(ctx) {
    const html = renderFormToString(ctx.input.fields);

    return {
      content: [
        createUIResource({
          html,
          title: 'Contact Form',
          width: 400,
          height: 300,
        }),
      ],
      _meta: {
        'mcp:resourceUri': `ui://form/${ctx.input.id}`,
        'mcp:instanceUri': `instance://form/${crypto.randomUUID()}`,
      },
    };
  }
}
```

### \_meta Linking Pattern

The `_meta` field links tool responses to their associated UI resources:

```typescript
{
  content: [/* ... */],
  _meta: {
    // Component definition (static)
    'mcp:resourceUri': 'component://Form',

    // Specific rendered instance (dynamic)
    'mcp:instanceUri': 'ui://form/abc123',

    // HTML resource for display
    'mcp:htmlUri': 'ui://form/abc123/html',

    // Custom metadata
    'frontmcp:formId': 'contact-form',
    'frontmcp:version': '1.0'
  }
}
```

---

## Extension Points

### Custom Methods

Developers can register custom JSON-RPC methods:

```typescript
server.registerMethod('custom/myMethod', async (params) => {
  // Handle custom method
  return { result: 'custom response' };
});
```

### Custom Notifications

Send custom notifications to clients:

```typescript
server.notify('custom/event', {
  type: 'myEvent',
  data: { ... }
});
```

### Middleware Pattern

Process messages before/after handling:

```typescript
server.use(async (message, next) => {
  console.log('Incoming:', message);
  const result = await next(message);
  console.log('Outgoing:', result);
  return result;
});
```
