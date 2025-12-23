# Transport Layer

Browser-native transport implementations for MCP communication.

> **Security Notice**: See [SECURITY.md](./SECURITY.md) for critical security considerations including origin validation, rate limiting, and message integrity.

## Overview

The transport layer provides bidirectional message passing between the MCP server and AI agent clients without HTTP.

| Transport                   | Context       | API                 | Use Case                                 |
| --------------------------- | ------------- | ------------------- | ---------------------------------------- |
| `EventTransport`            | Main thread   | EventEmitter        | Same-context communication               |
| `PostMessageTransport`      | Cross-context | postMessage         | WebWorker, iframe, window                |
| `BroadcastChannelTransport` | Multi-tab     | BroadcastChannel    | Cross-tab communication                  |
| `IframeParentTransport`     | Host app      | postMessage         | Embedding MCP apps (host side)           |
| `IframeChildTransport`      | Embedded app  | postMessage         | Embedded MCP apps (app side)             |
| `TabServerTransport`        | Multi-page    | sessionStorage + BC | Persistent connections across navigation |
| `ExtensionServerTransport`  | Extension     | chrome.runtime      | Chrome Extension communication           |

## Core Interface

### BrowserTransport

```typescript
interface BrowserTransport {
  /**
   * Send a JSON-RPC message to the other side
   */
  send(message: JSONRPCMessage): void;

  /**
   * Register handler for incoming messages
   * @returns Unsubscribe function
   */
  onMessage(handler: (message: JSONRPCMessage) => void): () => void;

  /**
   * Close transport and cleanup resources
   */
  close(): void;

  /**
   * Connection status
   */
  readonly isConnected: boolean;
}
```

### RequestTransport (Extended)

```typescript
interface RequestTransport extends BrowserTransport {
  /**
   * Send request and wait for response
   * Handles request ID tracking automatically
   */
  request<TResult = unknown>(request: JSONRPCRequest): Promise<JSONRPCResponse & { result?: TResult }>;
}
```

---

## EventTransport

For same-context communication using EventEmitter pattern.

### Interface

```typescript
interface EventTransportOptions {
  /**
   * Event name for outgoing messages (server -> client)
   * @default 'mcp:response'
   */
  sendEvent?: string;

  /**
   * Event name for incoming messages (client -> server)
   * @default 'mcp:request'
   */
  receiveEvent?: string;
}

interface MinimalEventEmitter {
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
}
```

### Implementation Spec

```typescript
class EventTransport implements BrowserTransport, RequestTransport {
  private emitter: MinimalEventEmitter;
  private sendEvent: string;
  private receiveEvent: string;
  private handlers: Set<MessageHandler>;
  private pendingRequests: Map<RequestId, PendingRequest>;
  private connected: boolean;

  constructor(emitter: MinimalEventEmitter, options?: EventTransportOptions);

  // BrowserTransport
  send(message: JSONRPCMessage): void;
  onMessage(handler: MessageHandler): () => void;
  close(): void;
  get isConnected(): boolean;

  // RequestTransport
  request<T>(request: JSONRPCRequest): Promise<JSONRPCResponse>;
}
```

### Usage Examples

**With mitt (lightweight EventEmitter):**

```typescript
import mitt from 'mitt';
import { EventTransport } from '@frontmcp/browser';

const emitter = mitt();
const transport = new EventTransport(emitter);

// Server side - handle incoming requests
transport.onMessage((message) => {
  if (isRequest(message)) {
    // Handle request
    transport.send({
      jsonrpc: '2.0',
      id: message.id,
      result: { success: true },
    });
  }
});

// Client side - send request
const response = await transport.request({
  method: 'tools/list',
  params: {},
});
```

**With custom emitter:**

```typescript
const emitter = createSimpleEmitter(); // Built-in helper
const transport = new EventTransport(emitter);
```

**Custom event names:**

```typescript
const transport = new EventTransport(emitter, {
  sendEvent: 'server:message',
  receiveEvent: 'client:message',
});
```

### Message Flow

```
┌─────────────┐                    ┌─────────────┐
│   Client    │                    │   Server    │
│             │                    │             │
│  request()  │───mcp:request────▶│ onMessage() │
│             │                    │             │
│             │◀──mcp:response────│   send()    │
│  Promise    │                    │             │
│  resolves   │                    │             │
└─────────────┘                    └─────────────┘
```

---

## PostMessageTransport

For cross-context communication (WebWorker, iframe, window).

> **SECURITY WARNING**: The default origin `'*'` accepts messages from ANY origin. This is a security risk. Always specify an explicit origin in production. See [SECURITY.md](./SECURITY.md#origin-validation).

### Interface

```typescript
interface PostMessageTransportOptions {
  /**
   * Target for postMessage
   */
  target: Worker | Window | MessagePort;

  /**
   * Origin for security (Window targets only)
   * SECURITY: Never use '*' in production!
   * @default '*'
   */
  origin?: string;

  /**
   * Message type identifier
   * @default 'mcp'
   */
  messageType?: string;

  /**
   * Callback for origin validation failures
   */
  onOriginViolation?: (origin: string) => void;
}
```

### Implementation Spec

```typescript
class PostMessageTransport implements BrowserTransport, RequestTransport {
  private target: Worker | Window | MessagePort;
  private origin: string;
  private messageType: string;
  private handlers: Set<MessageHandler>;
  private pendingRequests: Map<RequestId, PendingRequest>;
  private connected: boolean;
  private messageListener: (event: MessageEvent) => void;

  constructor(target: Worker | Window | MessagePort, options?: PostMessageTransportOptions);

  // BrowserTransport
  send(message: JSONRPCMessage): void;
  onMessage(handler: MessageHandler): () => void;
  close(): void;
  get isConnected(): boolean;

  // RequestTransport
  request<T>(request: JSONRPCRequest): Promise<JSONRPCResponse>;
}
```

### Usage Examples

**WebWorker (from main thread):**

```typescript
// main.ts
const worker = new Worker('./mcp-worker.ts', { type: 'module' });
const transport = new PostMessageTransport(worker);

const response = await transport.request({
  method: 'tools/call',
  params: { name: 'my-tool', arguments: { foo: 'bar' } },
});
```

**WebWorker (from worker):**

```typescript
// mcp-worker.ts
const transport = new PostMessageTransport(self);

transport.onMessage((message) => {
  // Handle MCP requests
});
```

**Iframe communication:**

```typescript
const iframe = document.getElementById('mcp-frame') as HTMLIFrameElement;
const transport = new PostMessageTransport(iframe.contentWindow!, {
  origin: 'https://trusted-origin.com',
});
```

**MessageChannel (bidirectional):**

```typescript
const channel = new MessageChannel();

// Side A
const transportA = new PostMessageTransport(channel.port1);

// Side B
const transportB = new PostMessageTransport(channel.port2);
```

### Message Format

```typescript
interface PostMessagePayload {
  type: 'mcp'; // Identifies MCP messages
  payload: JSONRPCMessage;
}
```

### Message Flow (WebWorker)

```
┌─────────────────┐                      ┌─────────────────┐
│   Main Thread   │                      │    WebWorker    │
│                 │                      │                 │
│ postMessage()   │───{ type: 'mcp' }───▶│  onmessage()   │
│                 │      payload          │                 │
│                 │                      │  MCP Server     │
│                 │◀──{ type: 'mcp' }────│  postMessage()  │
│ onmessage()     │      payload          │                 │
└─────────────────┘                      └─────────────────┘
```

### Security Considerations

**Origin validation (Window targets):**

```typescript
// Strict origin checking
const transport = new PostMessageTransport(window.parent, {
  origin: 'https://parent-app.com'
});

// Internal validation
private handleMessage(event: MessageEvent) {
  if (this.origin !== '*' && event.origin !== this.origin) {
    return; // Ignore messages from untrusted origins
  }
  // Process message...
}
```

---

## Helper Utilities

### Simple EventEmitter

Built-in lightweight emitter for cases where mitt/eventemitter3 isn't needed:

```typescript
function createSimpleEmitter(): MinimalEventEmitter {
  const listeners = new Map<string, Set<Handler>>();

  return {
    emit(event, data) {
      listeners.get(event)?.forEach((handler) => handler(data));
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
  };
}
```

### Type Guards

```typescript
function isJSONRPCRequest(msg: JSONRPCMessage): msg is JSONRPCRequest {
  return 'method' in msg && 'id' in msg;
}

function isJSONRPCResponse(msg: JSONRPCMessage): msg is JSONRPCResponse {
  return 'id' in msg && ('result' in msg || 'error' in msg);
}

function isJSONRPCNotification(msg: JSONRPCMessage): msg is JSONRPCNotification {
  return 'method' in msg && !('id' in msg);
}
```

### Request ID Generation

```typescript
function generateRequestId(): string {
  return crypto.randomUUID();
}
```

---

## Error Handling

### Transport Errors

```typescript
class TransportError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'TransportError';
  }
}

class TransportClosedError extends TransportError {
  constructor() {
    super('Transport is closed', 'TRANSPORT_CLOSED');
  }
}

class RequestTimeoutError extends TransportError {
  constructor(requestId: string | number) {
    super(`Request ${requestId} timed out`, 'REQUEST_TIMEOUT');
  }
}
```

### Request Timeout

```typescript
async request<T>(
  request: JSONRPCRequest,
  timeout = 30000
): Promise<JSONRPCResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this.pendingRequests.delete(request.id);
      reject(new RequestTimeoutError(request.id));
    }, timeout);

    this.pendingRequests.set(request.id, {
      resolve: (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      reject
    });

    this.send(request);
  });
}
```

---

## File Structure

```
browser-poc/src/transport/
├── transport.interface.ts      # Interfaces and types
├── event-transport.ts          # EventTransport implementation
├── postmessage-transport.ts    # PostMessageTransport implementation
├── utils.ts                    # Helpers (createSimpleEmitter, type guards)
├── errors.ts                   # Transport error classes
└── index.ts                    # Barrel exports
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('EventTransport', () => {
  it('should send messages via emitter');
  it('should receive messages from emitter');
  it('should handle request/response cycle');
  it('should reject pending requests on close');
  it('should unsubscribe handlers correctly');
});

describe('PostMessageTransport', () => {
  it('should send messages via postMessage');
  it('should filter messages by type');
  it('should validate origin for Window targets');
  it('should work with Worker');
  it('should work with MessagePort');
});
```

### Integration Tests

```typescript
describe('Transport Integration', () => {
  it('should handle full MCP request/response cycle');
  it('should handle notifications');
  it('should handle multiple concurrent requests');
  it('should recover from errors');
});
```

---

## BroadcastChannelTransport

For cross-tab communication within the same origin.

### Interface

```typescript
interface BroadcastChannelTransportOptions {
  /**
   * Channel name for communication
   */
  channelName: string;

  /**
   * Optional instance ID to prevent echo
   * @default crypto.randomUUID()
   */
  instanceId?: string;
}
```

### Implementation Spec

```typescript
class BroadcastChannelTransport implements BrowserTransport, RequestTransport {
  private channel: BroadcastChannel;
  private instanceId: string;
  private handlers: Set<MessageHandler>;
  private pendingRequests: Map<RequestId, PendingRequest>;
  private connected: boolean;

  constructor(options: BroadcastChannelTransportOptions);

  // BrowserTransport
  send(message: JSONRPCMessage): void;
  onMessage(handler: MessageHandler): () => void;
  close(): void;
  get isConnected(): boolean;

  // RequestTransport
  request<T>(request: JSONRPCRequest): Promise<JSONRPCResponse>;
}
```

### Usage Example

```typescript
// Tab 1 - Server
const serverTransport = new BroadcastChannelTransport({
  channelName: 'mcp-channel',
});

// Tab 2 - Client
const clientTransport = new BroadcastChannelTransport({
  channelName: 'mcp-channel',
});

// Messages are broadcast to all tabs on the same channel
const response = await clientTransport.request({
  jsonrpc: '2.0',
  id: '1',
  method: 'tools/list',
  params: {},
});
```

### Message Format

```typescript
interface BroadcastMessage {
  type: 'mcp';
  instanceId: string; // Sender's instance ID (to prevent echo)
  payload: JSONRPCMessage;
}
```

### Use Cases

- Multi-tab applications sharing MCP server state
- Tab synchronization for collaborative features
- Fallback when SharedWorker isn't available

### Limitations

- Same-origin only (browser security)
- No message ordering guarantees
- All tabs receive all messages (filter by instanceId)

---

## IframeParentTransport

For host applications embedding FrontMCP apps in sandboxed iframes.

> **Related**: See [APP-BRIDGE.md](./APP-BRIDGE.md) for the full App Bridge SDK documentation.

### Interface

```typescript
interface IframeParentTransportOptions {
  /**
   * The iframe element containing the MCP app
   */
  iframe: HTMLIFrameElement;

  /**
   * Expected origin of the iframe content
   * SECURITY: Always specify to prevent cross-origin attacks
   */
  targetOrigin: string;

  /**
   * Message type identifier
   * @default 'mcp'
   */
  messageType?: string;

  /**
   * Timeout for connection handshake (ms)
   * @default 10000
   */
  connectionTimeout?: number;

  /**
   * Callback for origin validation failures
   */
  onOriginViolation?: (origin: string) => void;
}
```

### Implementation Spec

```typescript
class IframeParentTransport implements BrowserTransport, RequestTransport {
  private iframe: HTMLIFrameElement;
  private targetOrigin: string;
  private messageType: string;
  private handlers: Set<MessageHandler>;
  private pendingRequests: Map<RequestId, PendingRequest>;
  private connected: boolean;

  constructor(options: IframeParentTransportOptions);

  // Connection handshake with iframe
  async connect(): Promise<void>;

  // BrowserTransport
  send(message: JSONRPCMessage): void;
  onMessage(handler: MessageHandler): () => void;
  close(): void;
  get isConnected(): boolean;

  // RequestTransport
  request<T>(request: JSONRPCRequest): Promise<JSONRPCResponse>;
}
```

### Usage Example

```typescript
import { IframeParentTransport } from '@frontmcp/browser/transport';

// Create iframe for MCP app
const iframe = document.createElement('iframe');
iframe.src = 'https://my-mcp-app.com';
iframe.sandbox.add('allow-scripts', 'allow-same-origin');
document.body.appendChild(iframe);

// Create transport
const transport = new IframeParentTransport({
  iframe,
  targetOrigin: 'https://my-mcp-app.com',
});

// Wait for iframe to load and establish connection
await transport.connect();

// Now communicate with the MCP app
const tools = await transport.request({
  jsonrpc: '2.0',
  id: '1',
  method: 'tools/list',
  params: {},
});
```

### Connection Handshake Protocol

```
Parent (Host)                           Child (Iframe)
     │                                        │
     │          iframe load complete          │
     │◀───────────────────────────────────────│
     │                                        │
     │─────── mcp:connect ──────────────────▶ │
     │        { capabilities, version }       │
     │                                        │
     │◀────── mcp:connected ──────────────────│
     │        { capabilities, version }       │
     │                                        │
     │          CONNECTION READY              │
```

---

## IframeChildTransport

For MCP applications running inside an iframe, communicating with parent host.

### Interface

```typescript
interface IframeChildTransportOptions {
  /**
   * Expected origin of the parent window
   * SECURITY: Always specify to prevent cross-origin attacks
   */
  parentOrigin: string;

  /**
   * Message type identifier
   * @default 'mcp'
   */
  messageType?: string;

  /**
   * Callback when connection established
   */
  onConnected?: () => void;

  /**
   * Callback for origin validation failures
   */
  onOriginViolation?: (origin: string) => void;
}
```

### Implementation Spec

```typescript
class IframeChildTransport implements BrowserTransport, RequestTransport {
  private parentOrigin: string;
  private messageType: string;
  private handlers: Set<MessageHandler>;
  private pendingRequests: Map<RequestId, PendingRequest>;
  private connected: boolean;

  constructor(options: IframeChildTransportOptions);

  // Respond to parent's connection handshake
  async waitForConnection(): Promise<void>;

  // BrowserTransport
  send(message: JSONRPCMessage): void;
  onMessage(handler: MessageHandler): () => void;
  close(): void;
  get isConnected(): boolean;

  // RequestTransport
  request<T>(request: JSONRPCRequest): Promise<JSONRPCResponse>;
}
```

### Usage Example

```typescript
// In iframe app (child)
import { IframeChildTransport } from '@frontmcp/browser/transport';
import { createBrowserMcpServer } from '@frontmcp/browser';

// Create transport that communicates with parent
const transport = new IframeChildTransport({
  parentOrigin: 'https://host-app.com',
  onConnected: () => console.log('Connected to host!'),
});

// Wait for parent to initiate connection
await transport.waitForConnection();

// Create MCP server using this transport
const server = await createBrowserMcpServer({
  transport,
  info: { name: 'MyApp', version: '1.0.0' },
});
```

### Security Considerations

```typescript
// ALWAYS validate parent origin
const transport = new IframeChildTransport({
  parentOrigin: 'https://trusted-host.com',  // Strict origin
  onOriginViolation: (origin) => {
    console.error(`Rejected message from untrusted origin: ${origin}`);
    // Log security incident
  }
});

// Message validation
private handleMessage(event: MessageEvent) {
  // Verify origin
  if (event.origin !== this.parentOrigin) {
    this.options.onOriginViolation?.(event.origin);
    return;
  }

  // Verify message structure
  if (!isValidMcpMessage(event.data)) {
    return;
  }

  // Process message
  this.dispatchMessage(event.data.payload);
}
```

---

## TabServerTransport

For maintaining persistent MCP connections across page navigation within a tab.

> **Competitor Feature**: Similar to WebMCP's TabServerTransport

### Problem Solved

Standard transports lose connection when the page navigates. TabServerTransport persists connection state using sessionStorage and BroadcastChannel.

### Interface

```typescript
interface TabServerTransportOptions {
  /**
   * Channel name for BroadcastChannel communication
   */
  channelName: string;

  /**
   * Session storage key prefix
   * @default 'mcp-tab'
   */
  storagePrefix?: string;

  /**
   * Callback when reconnecting after navigation
   */
  onReconnecting?: () => void;

  /**
   * Callback when reconnection complete
   */
  onReconnected?: () => void;
}
```

### Implementation Spec

```typescript
class TabServerTransport implements BrowserTransport, RequestTransport {
  private channel: BroadcastChannel;
  private sessionId: string;
  private storagePrefix: string;
  private handlers: Set<MessageHandler>;
  private pendingRequests: Map<RequestId, PendingRequest>;
  private connected: boolean;

  constructor(options: TabServerTransportOptions);

  // Restore session after page navigation
  async reconnect(): Promise<void>;

  // Save session state before page unload
  saveState(): void;

  // BrowserTransport
  send(message: JSONRPCMessage): void;
  onMessage(handler: MessageHandler): () => void;
  close(): void;
  get isConnected(): boolean;

  // RequestTransport
  request<T>(request: JSONRPCRequest): Promise<JSONRPCResponse>;
}
```

### Usage Example

```typescript
import { TabServerTransport } from '@frontmcp/browser/transport';

const transport = new TabServerTransport({
  channelName: 'my-mcp-server',
  onReconnecting: () => console.log('Reconnecting after navigation...'),
  onReconnected: () => console.log('Reconnected!'),
});

// Try to restore previous session
await transport.reconnect();

// Save state before page unload
window.addEventListener('beforeunload', () => {
  transport.saveState();
});
```

### State Persistence

```typescript
// Session state stored in sessionStorage
interface TabSessionState {
  sessionId: string;
  protocolVersion: string;
  serverCapabilities: ServerCapabilities;
  clientCapabilities: ClientCapabilities;
  subscriptions: string[];  // Active resource subscriptions
  lastMessageId: number;
}

// Restore state on navigation
async reconnect(): Promise<void> {
  const savedState = sessionStorage.getItem(
    `${this.storagePrefix}-session-${this.sessionId}`
  );

  if (savedState) {
    const state: TabSessionState = JSON.parse(savedState);
    await this.restoreSession(state);
    this.options.onReconnected?.();
  }
}
```

---

## ExtensionServerTransport

For communication between web pages and Chrome Extensions running MCP servers.

> **Competitor Feature**: Similar to WebMCP's ExtensionServerTransport

### Interface

```typescript
interface ExtensionServerTransportOptions {
  /**
   * Chrome runtime port for messaging
   * Created via chrome.runtime.connect()
   */
  port: chrome.runtime.Port;

  /**
   * Message type identifier
   * @default 'mcp'
   */
  messageType?: string;

  /**
   * Callback when extension disconnects
   */
  onDisconnect?: () => void;
}
```

### Implementation Spec

```typescript
class ExtensionServerTransport implements BrowserTransport, RequestTransport {
  private port: chrome.runtime.Port;
  private messageType: string;
  private handlers: Set<MessageHandler>;
  private pendingRequests: Map<RequestId, PendingRequest>;
  private connected: boolean;

  constructor(options: ExtensionServerTransportOptions);

  // BrowserTransport
  send(message: JSONRPCMessage): void;
  onMessage(handler: MessageHandler): () => void;
  close(): void;
  get isConnected(): boolean;

  // RequestTransport
  request<T>(request: JSONRPCRequest): Promise<JSONRPCResponse>;
}
```

### Usage Example (Web Page)

```typescript
import { ExtensionServerTransport } from '@frontmcp/browser/transport';

// Connect to extension
const port = chrome.runtime.connect('extension-id', {
  name: 'mcp-connection',
});

const transport = new ExtensionServerTransport({
  port,
  onDisconnect: () => console.log('Extension disconnected'),
});

// Use transport for MCP communication
const tools = await transport.request({
  jsonrpc: '2.0',
  id: '1',
  method: 'tools/list',
  params: {},
});
```

### Usage Example (Extension Background Script)

```typescript
// background.ts (Chrome Extension)
import { createBrowserMcpServer } from '@frontmcp/browser';
import { ExtensionServerTransport } from '@frontmcp/browser/transport';

// Listen for connections from web pages
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'mcp-connection') return;

  const transport = new ExtensionServerTransport({ port });

  const server = createBrowserMcpServer({
    transport,
    info: { name: 'ExtensionMCP', version: '1.0.0' },
  });

  port.onDisconnect.addListener(() => {
    server.close();
  });
});
```

### Extension Manifest Configuration

```json
{
  "manifest_version": 3,
  "name": "FrontMCP Extension",
  "version": "1.0.0",
  "permissions": ["tabs"],
  "background": {
    "service_worker": "background.js"
  },
  "externally_connectable": {
    "matches": ["https://your-app.com/*"]
  }
}
```

### Message Format

```typescript
interface ExtensionMessage {
  type: 'mcp';
  payload: JSONRPCMessage;
}

// Send via port
port.postMessage({
  type: 'mcp',
  payload: {
    jsonrpc: '2.0',
    id: '1',
    method: 'tools/list',
    params: {},
  },
});

// Receive via port
port.onMessage.addListener((message) => {
  if (message.type === 'mcp') {
    // Handle MCP message
  }
});
```

---

## Connection Management

### Reconnection Strategy

For transports that can disconnect (WebWorker termination, iframe navigation):

```typescript
interface ReconnectionOptions {
  /**
   * Maximum reconnection attempts
   * @default 5
   */
  maxAttempts?: number;

  /**
   * Base delay between attempts (ms)
   * @default 1000
   */
  baseDelay?: number;

  /**
   * Maximum delay between attempts (ms)
   * @default 30000
   */
  maxDelay?: number;

  /**
   * Exponential backoff multiplier
   * @default 2
   */
  backoffMultiplier?: number;

  /**
   * Callback on reconnection attempt
   */
  onReconnecting?: (attempt: number) => void;

  /**
   * Callback on successful reconnection
   */
  onReconnected?: () => void;

  /**
   * Callback when max attempts exceeded
   */
  onReconnectFailed?: () => void;
}
```

### Implementation Pattern

```typescript
class ReconnectingTransport implements BrowserTransport {
  private transport: BrowserTransport;
  private options: ReconnectionOptions;
  private attempts = 0;

  async reconnect(): Promise<void> {
    while (this.attempts < this.options.maxAttempts) {
      this.attempts++;
      this.options.onReconnecting?.(this.attempts);

      const delay = Math.min(
        this.options.baseDelay * Math.pow(this.options.backoffMultiplier, this.attempts - 1),
        this.options.maxDelay,
      );

      await sleep(delay);

      try {
        await this.transport.connect();
        this.attempts = 0;
        this.options.onReconnected?.();
        return;
      } catch (error) {
        // Continue to next attempt
      }
    }

    this.options.onReconnectFailed?.();
  }
}
```

### Heartbeat / Keep-alive

Detect stale connections with periodic ping/pong:

```typescript
interface HeartbeatOptions {
  /**
   * Interval between heartbeats (ms)
   * @default 30000
   */
  interval?: number;

  /**
   * Timeout for heartbeat response (ms)
   * @default 5000
   */
  timeout?: number;

  /**
   * Callback when connection appears dead
   */
  onTimeout?: () => void;
}

class HeartbeatMixin {
  private heartbeatTimer?: number;
  private pendingHeartbeat?: { resolve: () => void; timer: number };

  startHeartbeat(transport: RequestTransport, options: HeartbeatOptions): void {
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.ping(transport, options.timeout);
      } catch {
        options.onTimeout?.();
        this.stopHeartbeat();
      }
    }, options.interval);
  }

  private async ping(transport: RequestTransport, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Heartbeat timeout')), timeout);

      // Use MCP ping method or custom notification
      transport
        .request({
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method: 'ping',
          params: {},
        })
        .then(() => {
          clearTimeout(timer);
          resolve();
        })
        .catch(reject);
    });
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
  }
}
```

---

## Request Cancellation

Support for canceling in-flight requests per MCP protocol.

### Cancellation Token

```typescript
interface CancellationToken {
  readonly isCancelled: boolean;
  onCancel(callback: () => void): () => void;
}

class CancellationTokenSource {
  private cancelled = false;
  private callbacks = new Set<() => void>();

  get token(): CancellationToken {
    return {
      isCancelled: this.cancelled,
      onCancel: (cb) => {
        this.callbacks.add(cb);
        return () => this.callbacks.delete(cb);
      },
    };
  }

  cancel(): void {
    this.cancelled = true;
    this.callbacks.forEach((cb) => cb());
    this.callbacks.clear();
  }
}
```

### Cancellable Request

```typescript
interface CancellableRequest<T> {
  promise: Promise<T>;
  cancel: () => void;
}

function cancellableRequest<T>(
  transport: RequestTransport,
  request: JSONRPCRequest,
): CancellableRequest<JSONRPCResponse> {
  const cts = new CancellationTokenSource();

  const promise = new Promise<JSONRPCResponse>((resolve, reject) => {
    cts.token.onCancel(() => {
      // Send cancellation notification
      transport.send({
        jsonrpc: '2.0',
        method: '$/cancelRequest',
        params: { id: request.id },
      });
      reject(new RequestCancelledError(request.id));
    });

    transport.request(request).then(resolve).catch(reject);
  });

  return { promise, cancel: () => cts.cancel() };
}

// Usage
const { promise, cancel } = cancellableRequest(transport, {
  jsonrpc: '2.0',
  id: '1',
  method: 'tools/call',
  params: { name: 'long-running-tool', arguments: {} },
});

// Cancel after 5 seconds
setTimeout(cancel, 5000);
```

---

## Resource Subscriptions

Support for MCP `resources/subscribe` to receive real-time updates.

### Subscription Interface

```typescript
interface ResourceSubscription {
  uri: string;
  unsubscribe: () => void;
}

interface SubscriptionOptions {
  /**
   * Callback when resource changes
   */
  onChange: (uri: string, contents: ResourceContents[]) => void;

  /**
   * Callback on subscription error
   */
  onError?: (error: Error) => void;
}
```

### Implementation

```typescript
class ResourceSubscriptionManager {
  private subscriptions = new Map<string, Set<SubscriptionOptions>>();

  constructor(private transport: RequestTransport) {
    // Listen for resource change notifications
    transport.onMessage((message) => {
      if (message.method === 'notifications/resources/updated') {
        this.handleUpdate(message.params.uri);
      }
    });
  }

  async subscribe(uri: string, options: SubscriptionOptions): Promise<ResourceSubscription> {
    // Send subscribe request
    await this.transport.request({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'resources/subscribe',
      params: { uri },
    });

    // Track subscription
    if (!this.subscriptions.has(uri)) {
      this.subscriptions.set(uri, new Set());
    }
    this.subscriptions.get(uri)!.add(options);

    return {
      uri,
      unsubscribe: () => this.unsubscribe(uri, options),
    };
  }

  private async handleUpdate(uri: string): Promise<void> {
    const subscribers = this.subscriptions.get(uri);
    if (!subscribers?.size) return;

    // Fetch updated content
    const response = await this.transport.request({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'resources/read',
      params: { uri },
    });

    subscribers.forEach((sub) => {
      sub.onChange(uri, response.result?.contents ?? []);
    });
  }

  private async unsubscribe(uri: string, options: SubscriptionOptions): Promise<void> {
    const subscribers = this.subscriptions.get(uri);
    subscribers?.delete(options);

    if (!subscribers?.size) {
      await this.transport.request({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'resources/unsubscribe',
        params: { uri },
      });
      this.subscriptions.delete(uri);
    }
  }
}
```

---

## SharedWorker Support

### Current Status: Not Supported

SharedWorker is **not currently supported** due to:

1. **Limited browser support** - Not available in Safari
2. **Complexity** - Requires connection management across multiple clients
3. **Debugging difficulty** - DevTools support varies by browser

### Alternative: BroadcastChannel

For multi-tab scenarios, use `BroadcastChannelTransport` instead:

```typescript
// Each tab runs its own MCP server with synchronized state via BroadcastChannel
const transport = new BroadcastChannelTransport({
  channelName: 'mcp-sync',
});
```

### Future Consideration

SharedWorker may be added when:

- Browser support improves (Safari)
- Use case demand justifies complexity
- DevTools debugging experience improves

---

## Structured Clone Limitations

### What Can Be Transferred

PostMessage and BroadcastChannel use the [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm):

| Type                | Supported | Notes                                    |
| ------------------- | --------- | ---------------------------------------- |
| Primitives          | Yes       | string, number, boolean, null, undefined |
| Plain Objects       | Yes       | Own enumerable properties                |
| Arrays              | Yes       | Including typed arrays                   |
| Date                | Yes       |                                          |
| RegExp              | Yes       |                                          |
| Map, Set            | Yes       |                                          |
| ArrayBuffer         | Yes       | Can be transferred                       |
| Error               | Partial   | Only name and message                    |
| **Functions**       | **No**    | Cannot be cloned                         |
| **DOM Nodes**       | **No**    | Cannot be cloned                         |
| **Symbols**         | **No**    | Cannot be cloned                         |
| **WeakMap/WeakSet** | **No**    | Cannot be cloned                         |

### Implications for MCP

JSON-RPC messages are plain objects and serialize correctly. However:

```typescript
// WORKS - Plain object
transport.send({
  jsonrpc: '2.0',
  id: '1',
  method: 'test',
  params: { data: [1, 2, 3], nested: { foo: 'bar' } },
});

// FAILS - Contains function
transport.send({
  jsonrpc: '2.0',
  id: '1',
  method: 'test',
  params: { callback: () => {} }, // ERROR: Cannot clone
});

// FAILS - Contains Symbol
transport.send({
  jsonrpc: '2.0',
  id: '1',
  method: 'test',
  params: { [Symbol('key')]: 'value' }, // Symbol keys are lost
});
```

### Transferable Objects

For large binary data, use transferable objects to avoid copying:

```typescript
// Transfer ArrayBuffer (zero-copy)
const buffer = new ArrayBuffer(1024 * 1024); // 1MB

worker.postMessage(
  { type: 'mcp', payload: { data: buffer } },
  [buffer], // Transfer list - buffer is now unusable in main thread
);
```

### Best Practices

1. Keep MCP message payloads JSON-serializable
2. Use ArrayBuffer for large binary data with transfer
3. Convert non-serializable types before sending
4. Validate message structure on receive
