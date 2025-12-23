# File Structure

Complete file structure for FrontMCP Browser implementation.

> **SDK Integration**: Browser-poc imports from `@frontmcp/sdk/core` (platform-agnostic). See [SDK-INTEGRATION.md](../SDK-INTEGRATION.md) for import guide and extension patterns.

## Overview

```
browser-poc/
├── README.md                           # Main documentation
├── package.json                        # Package configuration
├── tsconfig.json                       # TypeScript configuration
├── docs/                               # Documentation
│   ├── ARCHITECTURE.md
│   ├── SDK-INTEGRATION.md              # SDK extension guide
│   ├── TRANSPORT.md
│   ├── STORE.md
│   ├── REGISTRY.md
│   ├── REACT.md
│   ├── API.md
│   └── implementation/
│       ├── ROADMAP.md
│       └── FILE-STRUCTURE.md
├── src/                                # Source code
│   ├── index.ts                        # Main entry point
│   ├── server/                         # MCP Server (uses SDK patterns)
│   ├── transport/                      # Transport (extends SDK adapters)
│   ├── entries/                        # Tool/Resource entries (extends SDK)
│   ├── store/                          # Valtio store (browser-specific)
│   ├── registry/                       # Registries (extends SDK)
│   └── react/                          # React integration (browser-specific)
└── examples/                           # Working examples
    ├── vanilla/
    ├── react/
    └── worker/
```

---

## Source Files

### Main Entry Point

```
src/
├── index.ts                            # Main exports
└── types.ts                            # Shared types
```

#### src/index.ts

```typescript
// Core
export { createBrowserMcpServer } from './server';
export type { BrowserMcpServer, BrowserMcpServerOptions } from './server';

// Transport
export { EventTransport, PostMessageTransport } from './transport';
export type { BrowserTransport, RequestTransport } from './transport';

// Store
export { createMcpStore, createPersistedStore } from './store';
export type { McpStore } from './store';

// Registry
export { createComponentRegistry, createRendererRegistry } from './registry';
export type { ComponentRegistry, RendererRegistry, ComponentDefinition } from './registry';
```

---

### Server Module

```
src/server/
├── index.ts                            # Barrel exports
├── browser-server.instance.ts          # BrowserMcpServer class
├── factory.ts                          # createBrowserMcpServer factory
├── browser-notification.adapter.ts     # Adapts SDK NotificationService
└── types.ts                            # Server types
```

> **Note**: Handlers are not reimplemented - we use SDK's flow patterns with browser adapters.

#### Key Files

**browser-server.instance.ts**

```typescript
import { ToolRegistry, ResourceRegistry, NotificationService } from '@frontmcp/sdk';
import { McpError, MCP_ERROR_CODES } from '@frontmcp/sdk/errors';

export class BrowserMcpServer {
  // Uses SDK registry patterns
  private toolRegistry: ToolRegistry;
  private resourceRegistry: ResourceRegistry;

  // Browser-specific
  private transport: BrowserTransport;
  private store: McpStore<unknown>;
  private componentRegistry: ComponentRegistry;
  private rendererRegistry: RendererRegistry;

  // Adapts SDK notification patterns
  private notificationAdapter: BrowserNotificationAdapter;

  constructor(options: BrowserMcpServerOptions);

  async initialize(): Promise<void>;
  getTransport(): BrowserTransport;
  getStore(): McpStore<unknown>;
  getComponentRegistry(): ComponentRegistry;
  getRendererRegistry(): RendererRegistry;
  close(): void;
}
```

**factory.ts**

```typescript
export interface BrowserMcpServerOptions {
  info: { name: string; version: string };
  transport?: BrowserTransport;
  store?: Record<string, unknown>;
  persistence?: PersistenceOptions;
}

export async function createBrowserMcpServer(options: BrowserMcpServerOptions): Promise<BrowserMcpServer>;
```

---

### Transport Module

```
src/transport/
├── index.ts                            # Barrel exports
├── event-transport.adapter.ts          # Extends SDK's LocalTransportAdapter
├── postmessage-transport.adapter.ts    # Extends SDK's LocalTransportAdapter
└── utils.ts                            # Helper utilities
```

> **SDK Pattern**: Both transports extend `LocalTransportAdapter` from @frontmcp/sdk.

#### Key Files

**event-transport.adapter.ts**

```typescript
import { LocalTransportAdapter, JSONRPCMessage, MessageHandler } from '@frontmcp/sdk';

export class EventTransportAdapter extends LocalTransportAdapter<MinimalEventEmitter> {
  constructor(emitter: MinimalEventEmitter, options?: EventTransportOptions);

  // Implement browser-specific send
  protected async send(message: JSONRPCMessage): Promise<void> {
    this.emitter.emit(this.sendEvent, message);
  }

  // Implement browser-specific subscribe
  protected subscribe(handler: MessageHandler): () => void {
    this.emitter.on(this.receiveEvent, handler);
    return () => this.emitter.off(this.receiveEvent, handler);
  }

  // Inherited from SDK: close(), isConnected, request()
}
```

**postmessage-transport.adapter.ts**

```typescript
import { LocalTransportAdapter, JSONRPCMessage, MessageHandler } from '@frontmcp/sdk';

export class PostMessageTransportAdapter extends LocalTransportAdapter<Worker | Window> {
  constructor(target: Worker | Window | MessagePort, options?: PostMessageTransportOptions);

  // Implement browser-specific send
  protected async send(message: JSONRPCMessage): Promise<void> {
    this.target.postMessage({ type: this.messageType, payload: message }, this.origin);
  }

  // Implement browser-specific subscribe
  protected subscribe(handler: MessageHandler): () => void {
    const listener = (event: MessageEvent) => {
      if (this.validateOrigin(event.origin)) {
        handler(event.data.payload);
      }
    };
    self.addEventListener('message', listener);
    return () => self.removeEventListener('message', listener);
  }
}
```

---

### Store Module

```
src/store/
├── index.ts                            # Barrel exports
├── valtio-store.ts                     # McpStore implementation
├── store.types.ts                      # Store types
├── mcp-integration.ts                  # MCP resource/tool for store
└── persistence/
    ├── index.ts                        # Persistence exports
    ├── indexed-db.ts                   # IndexedDB adapter
    └── local-storage.ts                # localStorage adapter
```

#### Key Files

**valtio-store.ts**

```typescript
export interface McpStore<T extends object> {
  state: T;
  getSnapshot(): T;
  subscribe(callback: () => void): () => void;
  subscribeKey<K extends keyof T>(key: K, callback: (value: T[K]) => void): () => void;
  onMutation(callback: (ops: MutationOperation[]) => void): () => void;
}

export function createMcpStore<T extends object>(initial: T): McpStore<T>;
```

**persistence/indexed-db.ts**

```typescript
export interface PersistenceOptions {
  name: string;
  storeName?: string;
  include?: string[];
  exclude?: string[];
  debounce?: number;
}

export async function createPersistedStore<T extends object>(
  initial: T,
  options: PersistenceOptions,
): Promise<McpStore<T>>;
```

---

### Entries Module (NEW)

```
src/entries/
├── index.ts                            # Barrel exports
├── browser-tool.entry.ts               # Extends SDK's ToolEntry
├── browser-resource.entry.ts           # Extends SDK's ResourceEntry
└── built-in/
    ├── render.tool.ts                  # render tool
    ├── store-set.tool.ts               # store-set tool
    └── store.resource.ts               # store:// resource
```

> **SDK Pattern**: All entries extend SDK base classes for Zod validation.

#### Key Files

**browser-tool.entry.ts**

```typescript
import { ToolEntry, ToolContext, ToolMetadata } from '@frontmcp/sdk';
import { z } from 'zod';

export abstract class BrowserToolEntry<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> extends ToolEntry<
  TInput,
  TOutput
> {
  // Browser-specific context access
  protected getStore<T extends object>(): McpStore<T>;
  protected getComponentRegistry(): ComponentRegistry;
  protected getRendererRegistry(): RendererRegistry;
  protected createUIResource(options: CreateUIResourceOptions): UIResource;
}
```

**browser-resource.entry.ts**

```typescript
import { ResourceEntry, ResourceContext, ResourceMetadata } from '@frontmcp/sdk';
import { z } from 'zod';

export abstract class BrowserResourceEntry<TParams extends z.ZodTypeAny, TOutput> extends ResourceEntry<
  TParams,
  TOutput
> {
  // Browser-specific context access
  protected getStore<T extends object>(): McpStore<T>;
}
```

---

### Registry Module

```
src/registry/
├── index.ts                            # Barrel exports
├── component.registry.ts               # Extends SDK's RegistryAbstract
├── renderer.registry.ts                # Extends SDK's RegistryAbstract
└── types.ts                            # Registry types
```

> **SDK Pattern**: Both registries extend `RegistryAbstract` from @frontmcp/sdk.

#### Key Files

**component.registry.ts**

```typescript
import { RegistryAbstract, RegistryBuildMapResult } from '@frontmcp/sdk';

export class ComponentRegistry extends RegistryAbstract<ComponentDefinition[], ComponentRecord> {
  // Indexes for O(1) lookup
  private byName = new Map<string, ComponentRecord>();
  private byCategory = new Map<string, ComponentRecord[]>();
  private byTag = new Map<string, ComponentRecord[]>();

  protected buildMap(list: ComponentDefinition[]): RegistryBuildMapResult<ComponentRecord>;
  protected buildGraph(): void;
  protected async initialize(): Promise<void>;

  // Public API
  get(name: string): ComponentDefinition | undefined;
  list(): ComponentDefinition[];
  listByCategory(category: string): ComponentDefinition[];
  search(tags: string[]): ComponentDefinition[];
  has(name: string): boolean;
}
```

**types.ts**

```typescript
export interface ComponentDefinition<Props = unknown> {
  name: string;
  description: string;
  propsSchema: ZodSchema<Props>;
  defaultProps?: Partial<Props>;
  category?: string;
  tags?: string[];
  examples?: ComponentExample[];
}

export interface RendererDefinition<Props = unknown, Result = unknown> {
  name: string;
  description: string;
  inputSchema: ZodSchema;
  render: (input: RenderInput<Props>) => Promise<Result>;
}
```

---

### React Module

```
src/react/
├── index.ts                            # Barrel exports (entry point for /react)
├── provider.tsx                        # FrontMcpBrowserProvider
├── context.ts                          # React context
└── hooks/
    ├── index.ts                        # Hooks exports
    ├── use-store.ts                    # useStore hook
    ├── use-tool.ts                     # useTool hook
    ├── use-resource.ts                 # useResource hook
    ├── use-mcp.ts                      # useMcp hook
    └── use-component.ts                # useComponent hook
```

#### Key Files

**index.ts (React entry point)**

```typescript
// Provider
export { FrontMcpBrowserProvider } from './provider';
export type { FrontMcpBrowserProviderProps } from './provider';

// Hooks
export { useStore } from './hooks/use-store';
export { useTool } from './hooks/use-tool';
export { useResource } from './hooks/use-resource';
export { useMcp } from './hooks/use-mcp';
export { useComponent } from './hooks/use-component';

// Context (for advanced use)
export { useFrontMcp } from './context';
export type { FrontMcpContextValue } from './context';
```

---

## Examples

```
examples/
├── vanilla/
│   ├── index.html
│   ├── main.ts
│   └── README.md
├── react/
│   ├── index.html
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── components/
│   ├── package.json
│   └── README.md
└── worker/
    ├── index.html
    ├── main.ts
    ├── worker.ts
    └── README.md
```

---

## Package Configuration

### package.json

```json
{
  "name": "@frontmcp/browser",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./react": {
      "types": "./dist/react/index.d.ts",
      "import": "./dist/react/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:coverage": "vitest --coverage"
  },
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true },
    "react-dom": { "optional": true }
  },
  "dependencies": {
    "@frontmcp/sdk": "workspace:*",
    "valtio": "^2.1.2",
    "zod": "^3.23.8",
    "idb": "^8.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

> **Note**: `@frontmcp/sdk` is a workspace dependency, not `@modelcontextprotocol/sdk`. The SDK wraps the MCP SDK internally.

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "examples"]
}
```

---

## Import Paths

### SDK Imports (from @frontmcp/sdk/core)

> **IMPORTANT**: Browser code imports from `@frontmcp/sdk/core` (NOT `@frontmcp/sdk`)

```typescript
// Platform initialization (REQUIRED in browser)
import { initializeConfig, getConfig, generateUUID, sha256 } from '@frontmcp/sdk/core';

// Registry patterns
import { RegistryAbstract, RegistryBuildMapResult } from '@frontmcp/sdk/core';

// Entry patterns
import { ToolEntry, ResourceEntry, ToolContext, ResourceContext } from '@frontmcp/sdk/core';

// Transport base (platform-agnostic)
import { TransportAdapterBase } from '@frontmcp/sdk/core';

// Host adapter (no-op for browser)
import { NoOpHostAdapter } from '@frontmcp/sdk/core';

// Error classes
import { McpError, ResourceNotFoundError, ToolNotFoundError, InvalidParamsError } from '@frontmcp/sdk/core';

// Types
import type { JSONRPCMessage, ToolMetadata, ResourceMetadata } from '@frontmcp/sdk/core';

// Constants
import { MCP_ERROR_CODES } from '@frontmcp/sdk/core';
```

### Browser Initialization

```typescript
// Must be called before using any SDK patterns
import { initializeConfig, generateUUID } from '@frontmcp/sdk/core';

initializeConfig({
  debug: location.hostname === 'localhost',
  isDevelopment: location.hostname === 'localhost',
  machineId: generateUUID(),
});
```

### Internal Imports

```typescript
// From src/server/browser-server.instance.ts
import { EventTransportAdapter } from '../transport';
import { McpStore } from '../store';
import { ComponentRegistry, RendererRegistry } from '../registry';
import { BrowserToolEntry, BrowserResourceEntry } from '../entries';

// From src/react/hooks/use-store.ts
import { useFrontMcp } from '../context';
import type { McpStore } from '../../store';
```

### External Usage

```typescript
// Main exports
import {
  createBrowserMcpServer,
  EventTransportAdapter,
  createMcpStore,
  createComponentRegistry,
  BrowserToolEntry,
  BrowserResourceEntry,
} from '@frontmcp/browser';

// React exports
import { FrontMcpBrowserProvider, useStore, useTool, useResource } from '@frontmcp/browser/react';
```

---

## Build Output

```
dist/
├── index.js                            # Main entry
├── index.d.ts                          # Main types
├── server/
│   ├── index.js
│   ├── index.d.ts
│   └── ...
├── transport/
│   ├── index.js
│   ├── index.d.ts
│   └── ...
├── store/
│   ├── index.js
│   ├── index.d.ts
│   └── ...
├── registry/
│   ├── index.js
│   ├── index.d.ts
│   └── ...
└── react/
    ├── index.js                        # React entry
    ├── index.d.ts
    └── hooks/
        └── ...
```
