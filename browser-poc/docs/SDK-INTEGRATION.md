# SDK Integration Guide

How browser-poc leverages @frontmcp/sdk/core instead of reimplementing patterns.

## Table of Contents

- [Overview](#overview)
- [Platform-Agnostic SDK Architecture](#platform-agnostic-sdk-architecture)
- [Browser Initialization](#browser-initialization)
- [Architecture Comparison](#architecture-comparison)
- [What to Reuse from SDK](#what-to-reuse-from-sdk)
- [What's Browser-Specific](#whats-browser-specific)
- [Extension Patterns](#extension-patterns)
- [Import Guide](#import-guide)
- [Type System](#type-system)

---

## Overview

Browser-poc is built as an **extension of @frontmcp/sdk/core**, not a parallel implementation. The SDK provides a platform-agnostic `/core` entry point that works in both Node.js and browsers.

**Key benefits:**

1. **Consistency** - Same patterns as server-side MCP
2. **Maintainability** - SDK improvements automatically benefit browser
3. **Type Safety** - Shared types between server and browser
4. **Reduced Code** - Reuse tested infrastructure
5. **Backward Compatible** - Node.js users unaffected

### Design Principle

```
@frontmcp/sdk (full SDK - Node.js users)
       │
       └── index.ts         → Express default, Node.js-specific
              │
@frontmcp/sdk/core (platform-agnostic)
       │
       ├── RegistryAbstract
       ├── ToolEntry / ResourceEntry
       ├── TransportAdapterBase
       ├── HostServerAdapter / NoOpHostAdapter
       ├── Error classes
       ├── initializeConfig() / getConfig()
       └── generateUUID() / sha256() (Web Crypto)
              │
              ▼
@frontmcp/browser (extends SDK/core for browser)
       │
       ├── ComponentRegistry extends RegistryAbstract
       ├── BrowserToolEntry extends ToolEntry
       ├── EventTransportAdapter extends TransportAdapterBase
       ├── ValtioStore (browser-specific)
       └── React hooks (browser-specific)
```

---

## Platform-Agnostic SDK Architecture

The SDK has two entry points:

| Entry Point          | Target    | Features                                                  |
| -------------------- | --------- | --------------------------------------------------------- |
| `@frontmcp/sdk`      | Node.js   | Full SDK with Express, HTTP transports, Redis, auth       |
| `@frontmcp/sdk/core` | Universal | Platform-agnostic core for Node.js 19+, browsers, Workers |

### What `/core` Exports

```typescript
// Platform utilities (Web Crypto API)
export { generateUUID, getRandomBytes, sha256 } from './utils/platform-crypto';

// Runtime configuration
export { initializeConfig, getConfig, RuntimeConfig } from './config/runtime-config';

// Registry base
export { RegistryAbstract, RegistryBuildMapResult } from './registry/registry.base';

// Entry patterns (tools, resources, prompts)
export { ToolEntry, ResourceEntry, PromptEntry } from './common/entries';

// Transport base
export { TransportAdapterBase } from './transport/adapters/transport.base.adapter';

// Host adapter
export { HostServerAdapter, NoOpHostAdapter } from './server/adapters';

// Errors
export { McpError, ResourceNotFoundError, ToolNotFoundError, InvalidParamsError } from './errors';

// Types and constants
export { MCP_ERROR_CODES, JSONRPCMessage, ToolMetadata, ResourceMetadata } from './common';
```

### What `/core` Does NOT Export

- `ExpressHostAdapter` (Node.js-specific)
- `StreamableHTTPServerTransport` (HTTP-specific)
- `SSEServerTransport` (HTTP-specific)
- Auth modules (Redis, JWT, JWKS)
- `FrontMcpInstance` (uses Express by default)

---

## Browser Initialization

**IMPORTANT**: Browser code must call `initializeConfig()` before using SDK patterns.

```typescript
import { initializeConfig, generateUUID } from '@frontmcp/sdk/core';

// Required in browser - no process.env fallback
initializeConfig({
  debug: location.hostname === 'localhost',
  isDevelopment: location.hostname === 'localhost',
  machineId: generateUUID(),
});

// Now SDK patterns can be used
import { ToolEntry, RegistryAbstract } from '@frontmcp/sdk/core';
```

### RuntimeConfig Interface

```typescript
interface RuntimeConfig {
  debug: boolean; // Enable debug logging
  isDevelopment: boolean; // Development mode (affects error verbosity)
  machineId: string; // Unique identifier for this instance
}
```

### Node.js Fallback

In Node.js, `getConfig()` automatically falls back to `process.env` if `initializeConfig()` wasn't called:

```typescript
// Node.js: works without initializeConfig()
import { getConfig } from '@frontmcp/sdk/core';
const config = getConfig(); // Uses process.env.DEBUG, process.env.NODE_ENV, etc.

// Browser: throws if initializeConfig() not called
```

---

## Architecture Comparison

### Before: Reimplementing from Scratch (Wrong)

```
browser-poc/
├── src/server/
│   ├── browser-server.instance.ts    ← Reimplements FrontMcpInstance
│   ├── notification.service.ts       ← Reimplements NotificationService
│   └── handlers/
│       ├── tools-list.handler.ts     ← Reimplements flow
│       ├── tools-call.handler.ts     ← Reimplements flow
│       └── resources-read.handler.ts ← Reimplements flow
├── src/registry/
│   ├── component.registry.ts         ← Reimplements registry
│   └── renderer.registry.ts          ← Reimplements registry
└── src/transport/
    ├── event-transport.ts            ← Standalone implementation
    └── postmessage-transport.ts      ← Standalone implementation
```

### After: Extending SDK (Correct)

```
browser-poc/
├── src/server/
│   ├── browser-server.instance.ts    ← Uses SDK patterns
│   └── browser-notification.adapter.ts ← Adapts SDK NotificationService
├── src/transport/
│   ├── event-transport.adapter.ts    ← Extends LocalTransportAdapter
│   └── postmessage-transport.adapter.ts ← Extends LocalTransportAdapter
├── src/registry/
│   ├── component.registry.ts         ← Extends RegistryAbstract
│   └── renderer.registry.ts          ← Extends RegistryAbstract
├── src/entries/
│   ├── browser-tool.entry.ts         ← Extends ToolEntry
│   └── browser-resource.entry.ts     ← Extends ResourceEntry
├── src/store/                        ← Browser-specific (Valtio)
└── src/react/                        ← Browser-specific (React hooks)
```

---

## What to Reuse from SDK

> **Import from**: `@frontmcp/sdk/core` (NOT `@frontmcp/sdk`)

### Core Infrastructure

| SDK Module             | Import Path          | Browser Usage                                 |
| ---------------------- | -------------------- | --------------------------------------------- |
| `RegistryAbstract`     | `@frontmcp/sdk/core` | Base for ComponentRegistry, RendererRegistry  |
| `ToolEntry`            | `@frontmcp/sdk/core` | Base for browser tools with Zod validation    |
| `ResourceEntry`        | `@frontmcp/sdk/core` | Base for browser resources                    |
| `TransportAdapterBase` | `@frontmcp/sdk/core` | Base for EventTransport, PostMessageTransport |
| `NoOpHostAdapter`      | `@frontmcp/sdk/core` | Browser host (no HTTP server)                 |

### Platform Utilities

| Utility            | Import Path          | Browser Usage                            |
| ------------------ | -------------------- | ---------------------------------------- |
| `initializeConfig` | `@frontmcp/sdk/core` | **Required** - Initialize runtime config |
| `getConfig`        | `@frontmcp/sdk/core` | Read runtime config                      |
| `generateUUID`     | `@frontmcp/sdk/core` | Generate UUIDs (Web Crypto)              |
| `sha256`           | `@frontmcp/sdk/core` | Async SHA-256 (Web Crypto)               |

### Error Classes

| Error Class             | Import Path          | Usage                   |
| ----------------------- | -------------------- | ----------------------- |
| `McpError`              | `@frontmcp/sdk/core` | Base for all MCP errors |
| `ResourceNotFoundError` | `@frontmcp/sdk/core` | Resource 404 responses  |
| `ToolNotFoundError`     | `@frontmcp/sdk/core` | Tool not found          |
| `InvalidParamsError`    | `@frontmcp/sdk/core` | Validation failures     |

### Types & Utilities

| Type               | Import Path          | Usage                |
| ------------------ | -------------------- | -------------------- |
| `JSONRPCMessage`   | `@frontmcp/sdk/core` | Transport messages   |
| `MCP_ERROR_CODES`  | `@frontmcp/sdk/core` | Error codes          |
| `ToolMetadata`     | `@frontmcp/sdk/core` | Tool definitions     |
| `ResourceMetadata` | `@frontmcp/sdk/core` | Resource definitions |

### Flow Patterns

| Pattern                     | Import Path          | Usage                   |
| --------------------------- | -------------------- | ----------------------- |
| Pre/Execute/Finalize stages | `@frontmcp/sdk/core` | Simplified for browser  |
| Zod schema validation       | `@frontmcp/sdk/core` | Input/output validation |
| Context creation            | `@frontmcp/sdk/core` | Tool execution context  |

---

## What's Browser-Specific

These modules have no SDK equivalent and are implemented fresh in browser-poc:

### State Management

| Module                    | Description                     | Why Browser-Specific     |
| ------------------------- | ------------------------------- | ------------------------ |
| `ValtioStore`             | Reactive state via Valtio proxy | Browser reactivity model |
| `IndexedDBPersistence`    | IndexedDB adapter               | Browser storage API      |
| `LocalStoragePersistence` | localStorage adapter            | Browser storage API      |
| `MutationTracking`        | Valtio proxy subscriptions      | Valtio-specific          |

### UI Integration

| Module               | Description                | Why Browser-Specific |
| -------------------- | -------------------------- | -------------------- |
| `ComponentRegistry`  | UI component discovery     | No server equivalent |
| `RendererRegistry`   | DOM rendering              | Browser DOM          |
| `UIResourceRenderer` | Sandboxed iframe rendering | Browser security     |

### React Integration

| Module                    | Description            | Why Browser-Specific |
| ------------------------- | ---------------------- | -------------------- |
| `FrontMcpBrowserProvider` | React context provider | React-specific       |
| `useStore`                | Valtio snapshot hook   | React + Valtio       |
| `useTool`                 | Tool execution hook    | React patterns       |
| `useResource`             | Resource fetching hook | React patterns       |
| `useMcp`                  | Full context access    | React patterns       |

### Browser Transports

| Module                        | Description            | Why Browser-Specific |
| ----------------------------- | ---------------------- | -------------------- |
| `EventTransportAdapter`       | EventEmitter transport | Browser event model  |
| `PostMessageTransportAdapter` | postMessage transport  | WebWorker/iframe     |
| `BroadcastChannelTransport`   | Cross-tab transport    | Browser API          |

---

## Extension Patterns

### Extending RegistryAbstract

```typescript
// browser-poc/src/registry/component.registry.ts
import { RegistryAbstract, RegistryBuildMapResult } from '@frontmcp/sdk/core';
import { z } from 'zod';

// Define the record type for indexed components
interface ComponentRecord {
  name: string;
  definition: ComponentDefinition;
  indexed: {
    byCategory: string;
    byTags: Set<string>;
  };
}

// Define the input metadata type
type ComponentMetadata = ComponentDefinition[];

export class ComponentRegistry extends RegistryAbstract<ComponentMetadata, ComponentRecord> {
  // Indexes for O(1) lookup
  private byName = new Map<string, ComponentRecord>();
  private byCategory = new Map<string, ComponentRecord[]>();
  private byTag = new Map<string, ComponentRecord[]>();

  protected buildMap(list: ComponentMetadata): RegistryBuildMapResult<ComponentRecord> {
    const records: ComponentRecord[] = [];

    for (const definition of list) {
      const record: ComponentRecord = {
        name: definition.name,
        definition,
        indexed: {
          byCategory: definition.category ?? 'uncategorized',
          byTags: new Set(definition.tags ?? []),
        },
      };

      records.push(record);

      // Build indexes
      this.byName.set(definition.name, record);

      const category = record.indexed.byCategory;
      if (!this.byCategory.has(category)) {
        this.byCategory.set(category, []);
      }
      this.byCategory.get(category)!.push(record);

      for (const tag of record.indexed.byTags) {
        if (!this.byTag.has(tag)) {
          this.byTag.set(tag, []);
        }
        this.byTag.get(tag)!.push(record);
      }
    }

    return { records, errors: [] };
  }

  protected buildGraph(): void {
    // Components have no inter-dependencies
  }

  protected async initialize(): Promise<void> {
    // No async initialization needed
  }

  // Public API
  get(name: string): ComponentDefinition | undefined {
    return this.byName.get(name)?.definition;
  }

  list(): ComponentDefinition[] {
    return Array.from(this.byName.values()).map((r) => r.definition);
  }

  listByCategory(category: string): ComponentDefinition[] {
    return (this.byCategory.get(category) ?? []).map((r) => r.definition);
  }

  search(tags: string[]): ComponentDefinition[] {
    const results = new Set<ComponentRecord>();
    for (const tag of tags) {
      for (const record of this.byTag.get(tag) ?? []) {
        results.add(record);
      }
    }
    return Array.from(results).map((r) => r.definition);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }
}
```

### Extending ToolEntry

```typescript
// browser-poc/src/entries/browser-tool.entry.ts
import { ToolEntry, ToolContext, ToolMetadata } from '@frontmcp/sdk/core';
import { z } from 'zod';

/**
 * Base class for browser-specific tools.
 * Provides access to browser context (store, components, etc.)
 */
export abstract class BrowserToolEntry<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> extends ToolEntry<
  TInput,
  TOutput
> {
  /**
   * Access the Valtio store from tool context
   */
  protected getStore<T extends object>(): McpStore<T> {
    return this.ctx.scope.get(STORE_TOKEN) as McpStore<T>;
  }

  /**
   * Access component registry for UI discovery
   */
  protected getComponentRegistry(): ComponentRegistry {
    return this.ctx.scope.get(COMPONENT_REGISTRY_TOKEN);
  }

  /**
   * Access renderer registry for DOM operations
   */
  protected getRendererRegistry(): RendererRegistry {
    return this.ctx.scope.get(RENDERER_REGISTRY_TOKEN);
  }

  /**
   * Create a UI resource for tool results
   */
  protected createUIResource(options: CreateUIResourceOptions): UIResource {
    return createUIResource(options);
  }
}

// Example usage
export class RenderComponentTool extends BrowserToolEntry<typeof RenderComponentInput, typeof RenderComponentOutput> {
  static metadata: ToolMetadata = {
    name: 'render',
    description: 'Render a registered component',
  };

  inputSchema = z.object({
    component: z.string(),
    props: z.record(z.unknown()),
    target: z.string().optional(),
  });

  outputSchema = z.object({
    success: z.boolean(),
    elementId: z.string().optional(),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const registry = this.getComponentRegistry();
    const definition = registry.get(input.component);

    if (!definition) {
      throw new ToolNotFoundError(input.component);
    }

    // Validate props against component schema
    const propsResult = definition.propsSchema.safeParse(input.props);
    if (!propsResult.success) {
      throw new InvalidParamsError('Invalid props', propsResult.error);
    }

    // Get renderer and render
    const renderers = this.getRendererRegistry();
    const renderer = renderers.get('default');

    const result = await renderer.render({
      component: input.component,
      props: propsResult.data,
      target: input.target,
    });

    return { success: true, elementId: result.elementId };
  }
}
```

### Extending ResourceEntry

```typescript
// browser-poc/src/entries/browser-resource.entry.ts
import { ResourceEntry, ResourceContext, ResourceMetadata } from '@frontmcp/sdk/core';
import { z } from 'zod';

/**
 * Base class for browser-specific resources.
 * Provides access to browser context.
 */
export abstract class BrowserResourceEntry<TParams extends z.ZodTypeAny, TOutput> extends ResourceEntry<
  TParams,
  TOutput
> {
  /**
   * Access the Valtio store
   */
  protected getStore<T extends object>(): McpStore<T> {
    return this.ctx.scope.get(STORE_TOKEN) as McpStore<T>;
  }
}

// Store resource example
export class StoreResource extends BrowserResourceEntry<typeof StoreResourceParams, ReadResourceResult> {
  static metadata: ResourceMetadata = {
    uri: 'store://{path}',
    name: 'Store',
    description: 'Access Valtio store state',
    mimeType: 'application/json',
  };

  paramsSchema = z.object({
    path: z.string().optional(),
  });

  async read(params: z.infer<typeof this.paramsSchema>): Promise<ReadResourceResult> {
    const store = this.getStore();
    const snapshot = store.getSnapshot();

    let value: unknown = snapshot;
    if (params.path) {
      const keys = params.path.split('/').filter(Boolean);
      for (const key of keys) {
        value = (value as Record<string, unknown>)?.[key];
      }
    }

    return {
      contents: [
        {
          uri: `store://${params.path ?? ''}`,
          mimeType: 'application/json',
          text: JSON.stringify(value, null, 2),
        },
      ],
    };
  }
}
```

### Extending TransportAdapterBase

```typescript
// browser-poc/src/transport/event-transport.adapter.ts
import { TransportAdapterBase, JSONRPCMessage, Scope } from '@frontmcp/sdk/core';

interface MinimalEventEmitter {
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
}

interface EventTransportOptions {
  sendEvent?: string;
  receiveEvent?: string;
}

/**
 * Browser EventEmitter-based transport.
 * Extends SDK's TransportAdapterBase for platform-agnostic MCP handling.
 */
export class EventTransportAdapter extends TransportAdapterBase {
  private sendEvent: string;
  private receiveEvent: string;
  private handlers = new Set<(data: unknown) => void>();
  private unsubscribe?: () => void;

  constructor(scope: Scope, private emitter: MinimalEventEmitter, options: EventTransportOptions = {}) {
    super(scope);
    this.sendEvent = options.sendEvent ?? 'mcp:response';
    this.receiveEvent = options.receiveEvent ?? 'mcp:request';
  }

  async connect(): Promise<void> {
    // Subscribe to incoming messages
    const handler = (data: unknown) => {
      this.handleMessage(data as JSONRPCMessage);
    };

    this.emitter.on(this.receiveEvent, handler);
    this.handlers.add(handler);

    // Connect MCP handlers from SDK
    this.connectMcpHandlers();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.emitter.emit(this.sendEvent, message);
  }

  async destroy(reason?: string): Promise<void> {
    // Remove all handlers
    for (const handler of this.handlers) {
      this.emitter.off(this.receiveEvent, handler);
    }
    this.handlers.clear();

    if (reason) {
      console.warn(`[EventTransport] Destroyed: ${reason}`);
    }
  }
}
```

---

## Import Guide

### Package Dependency

```json
{
  "dependencies": {
    "@frontmcp/sdk": "workspace:*",
    "valtio": "^2.1.2",
    "zod": "^3.23.8",
    "idb": "^8.0.0"
  }
}
```

> **Note**: Dependency is still `@frontmcp/sdk`, but imports use the `/core` subpath.

### TypeScript Paths (if needed)

```json
{
  "compilerOptions": {
    "paths": {
      "@frontmcp/sdk/core": ["../../libs/sdk/src/core"]
    }
  }
}
```

### Import Examples

```typescript
// IMPORTANT: Always import from @frontmcp/sdk/core in browser code

// Platform initialization (REQUIRED for browser)
import { initializeConfig, getConfig, generateUUID, sha256 } from '@frontmcp/sdk/core';

// Registry base
import { RegistryAbstract, RegistryBuildMapResult } from '@frontmcp/sdk/core';

// Entry patterns
import { ToolEntry, ToolContext, ResourceEntry, ResourceContext } from '@frontmcp/sdk/core';

// Transport base
import { TransportAdapterBase } from '@frontmcp/sdk/core';

// Host adapter (for browser)
import { NoOpHostAdapter } from '@frontmcp/sdk/core';

// Errors
import { McpError, ResourceNotFoundError, ToolNotFoundError, InvalidParamsError } from '@frontmcp/sdk/core';

// Types
import type {
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  ToolMetadata,
  ResourceMetadata,
} from '@frontmcp/sdk/core';

// Constants
import { MCP_ERROR_CODES } from '@frontmcp/sdk/core';
```

### Full Browser Setup Example

```typescript
// browser-poc/src/index.ts
import {
  initializeConfig,
  generateUUID,
  RegistryAbstract,
  ToolEntry,
  TransportAdapterBase,
  NoOpHostAdapter,
} from '@frontmcp/sdk/core';

// Step 1: Initialize config (REQUIRED)
initializeConfig({
  debug: location.hostname === 'localhost',
  isDevelopment: location.hostname === 'localhost',
  machineId: generateUUID(),
});

// Step 2: Now you can use SDK patterns
class MyComponentRegistry extends RegistryAbstract { ... }
class MyBrowserTool extends ToolEntry { ... }
class MyEventTransport extends TransportAdapterBase { ... }
```

---

## Type System

### Shared Types

Browser-poc uses SDK types directly for MCP compliance:

```typescript
// Tool metadata matches SDK exactly
interface ToolMetadata {
  name: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
}

// Resource metadata matches SDK exactly
interface ResourceMetadata {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}
```

### Browser-Specific Types

```typescript
// Valtio store (browser-specific)
interface McpStore<T extends object> {
  state: T;
  getSnapshot(): Readonly<T>;
  subscribe(callback: () => void): () => void;
  onMutation(callback: (ops: MutationOperation[]) => void): () => void;
}

// Component definition (browser-specific)
interface ComponentDefinition<Props = unknown> {
  name: string;
  description: string;
  propsSchema: z.ZodSchema<Props>;
  defaultProps?: Partial<Props>;
  category?: string;
  tags?: string[];
}

// UI Resource (browser-specific)
interface UIResource {
  uri: string;
  mimeType: 'text/html;profile=mcp-app';
  content: string;
  dimensions?: { width: number; height: number };
}
```

---

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture with SDK integration
- [API.md](./API.md) - Full API reference
- [implementation/FILE-STRUCTURE.md](./implementation/FILE-STRUCTURE.md) - File structure with SDK imports
- [implementation/ROADMAP.md](./implementation/ROADMAP.md) - Implementation phases
