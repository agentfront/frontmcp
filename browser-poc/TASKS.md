# FrontMCP Browser Implementation Tasks

> **Generated from**: browser-poc documentation analysis with artifact validation
> **Target Package**: `libs/browser` (`@frontmcp/browser`)
> **Total Phases**: 17 (Phase 0 = SDK Prerequisites)

---

## Artifact Validation Notes

The following files were validated against the actual codebase:

| Expected Path                                               | Status      | Action Required                     |
| ----------------------------------------------------------- | ----------- | ----------------------------------- |
| `libs/sdk/src/utils/platform-crypto.ts`                     | **CREATED** | ✅ Complete                         |
| `libs/sdk/src/config/runtime-config.ts`                     | **CREATED** | ✅ Complete                         |
| `libs/sdk/src/core/index.ts`                                | **CREATED** | ✅ Complete + package.json export   |
| `libs/sdk/src/transport/adapters/transport.base.adapter.ts` | **CREATED** | ✅ Complete                         |
| `libs/sdk/src/server/adapters/noop.host.adapter.ts`         | **CREATED** | ✅ Complete                         |
| `libs/sdk/src/regsitry/registry.base.ts`                    | EXISTS      | Note: directory has typo "regsitry" |
| `libs/sdk/src/common/entries/tool.entry.ts`                 | EXISTS      | Already exports ToolEntry           |
| `libs/sdk/src/common/entries/resource.entry.ts`             | EXISTS      | Already exports ResourceEntry       |

---

## Phase 0: SDK Prerequisites [COMPLETE]

> **STATUS**: ✅ All SDK prerequisite changes are complete.

### [x] 0.1 Create platform crypto utilities

- **lib**: `@frontmcp/sdk`
- **summary**: Create Web Crypto API wrapper for browser compatibility
- **description**: Create `libs/sdk/src/utils/platform-crypto.ts` with platform-agnostic crypto functions that work in both Node.js 19+ and browsers. Implement `generateUUID()` using `crypto.randomUUID()`, `getRandomBytes()` using `crypto.getRandomValues()`, `getRandomHex()` for hex string generation, `sha256()` async function using `crypto.subtle.digest()`, and `sha256Sync()` with Node.js fallback. The Web Crypto API is available in Node.js 19+ and all modern browsers. Include proper error handling and fallbacks for older environments.
- **files**:
  - CREATE: `libs/sdk/src/utils/platform-crypto.ts`
  - CREATE: `libs/sdk/src/utils/platform-crypto.spec.ts`

### [x] 0.2 Create runtime configuration

- **lib**: `@frontmcp/sdk`
- **summary**: Replace process.env with injectable config system
- **description**: Create `libs/sdk/src/config/runtime-config.ts` with `RuntimeConfig` interface containing `debug`, `isDevelopment`, `machineId`, `sessionSecret?`, and `jwtSecret?` fields. Implement `initializeConfig(config: Partial<RuntimeConfig>)` for browser initialization and `getConfig()` that returns the global config or falls back to `process.env` in Node.js for backward compatibility. Browser code must call `initializeConfig()` before using SDK patterns.
- **files**:
  - CREATE: `libs/sdk/src/config/runtime-config.ts`
  - CREATE: `libs/sdk/src/config/index.ts`
  - CREATE: `libs/sdk/src/config/runtime-config.spec.ts`

### [x] 0.3 Create abstract transport base

- **lib**: `@frontmcp/sdk`
- **summary**: Create base class for all transport adapters
- **description**: Create `libs/sdk/src/transport/adapters/transport.base.adapter.ts` with `TransportAdapterBase` abstract class. Define abstract methods: `connect()`, `send(message: JSONRPCMessage)`, `destroy(reason?: string)`. Provide concrete method `connectMcpHandlers()` that wires up MCP request routing. HTTP transports (Express, SSE) and browser transports (EventEmitter, postMessage) will both extend this base. Ensure backward compatibility with existing transport implementations.
- **files**:
  - CREATE: `libs/sdk/src/transport/adapters/transport.base.adapter.ts`
  - MODIFY: `libs/sdk/src/transport/adapters/index.ts` (add export)

### [x] 0.4 Create NoOp host adapter

- **lib**: `@frontmcp/sdk`
- **summary**: Create no-op server adapter for browser environments
- **description**: Create `libs/sdk/src/server/adapters/noop.host.adapter.ts` with `NoOpHostAdapter` class that extends `HostServerAdapter`. All methods should be no-ops since browsers don't need an HTTP server. This allows the browser MCP server to use the same initialization patterns as Node.js but skip server startup.
- **files**:
  - CREATE: `libs/sdk/src/server/adapters/noop.host.adapter.ts`
  - MODIFY: `libs/sdk/src/server/adapters/index.ts` (add export)

### [x] 0.5 Create /core entry point

- **lib**: `@frontmcp/sdk`
- **summary**: Create platform-agnostic entry point for browser imports
- **description**: Create `libs/sdk/src/core/index.ts` that exports only platform-agnostic code. Export: `initializeConfig`, `getConfig`, `generateUUID`, `sha256`, `getRandomBytes` from utils; `RegistryAbstract`, `RegistryBuildMapResult` from registry; `ToolEntry`, `ResourceEntry`, `PromptEntry`, `ToolContext`, `ResourceContext` from entries; `TransportAdapterBase` from transport; `NoOpHostAdapter` from server adapters; all error classes (`McpError`, `ResourceNotFoundError`, `ToolNotFoundError`, `InvalidParamsError`); types (`JSONRPCMessage`, `ToolMetadata`, `ResourceMetadata`); and `MCP_ERROR_CODES`. Do NOT export Express adapter, SSE transport, auth modules, or Redis.
- **files**:
  - CREATE: `libs/sdk/src/core/index.ts`
  - CREATE: `libs/sdk/src/core/README.md` (document what's included)

### [x] 0.6 Update SDK package.json

- **lib**: `@frontmcp/sdk`
- **summary**: Add ./core export path to package.json
- **description**: Update `libs/sdk/package.json` to add a new export path for `./core` pointing to `./dist/src/core/index.js` (and corresponding types). Ensure the main entry point remains unchanged for backward compatibility with existing Node.js users. Test that both `@frontmcp/sdk` and `@frontmcp/sdk/core` imports work correctly.
- **files**:
  - MODIFY: `libs/sdk/package.json`

### [x] 0.7 Update SDK files to use platform utilities

- **lib**: `@frontmcp/sdk`
- **summary**: Replace Node.js crypto imports with platform-agnostic utilities
- **description**: Update all SDK files that import from `'crypto'` or `'node:crypto'` to use the new platform utilities. Replace `import { randomUUID } from 'crypto'` with `import { generateUUID } from '../utils/platform-crypto'`. Replace `randomBytes()` with `getRandomBytes()` or `getRandomHex()`. Replace `process.env` with `getConfig()` where appropriate, with fallback behavior. Files to update: `libs/sdk/src/flows/flow.instance.ts`, `libs/sdk/src/flows/flow.registry.ts`, `libs/sdk/src/errors/mcp.error.ts`, `libs/sdk/src/transport/transport.error.ts`, `libs/sdk/src/context/request-context.ts`, `libs/sdk/src/context/frontmcp-context.ts`, `libs/sdk/src/context/trace-context.ts`, and others using crypto. Ensure all existing tests pass.
- **files**:
  - MODIFY: `libs/sdk/src/flows/flow.instance.ts`
  - MODIFY: `libs/sdk/src/flows/flow.registry.ts`
  - MODIFY: `libs/sdk/src/errors/mcp.error.ts`
  - MODIFY: `libs/sdk/src/transport/transport.error.ts`
  - MODIFY: `libs/sdk/src/context/request-context.ts`
  - MODIFY: `libs/sdk/src/context/frontmcp-context.ts`
  - MODIFY: `libs/sdk/src/context/trace-context.ts`
  - MODIFY: `libs/sdk/src/transport/transport.registry.ts`
  - MODIFY: `libs/sdk/src/tool/flows/call-tool.flow.ts`

---

## Phase 1: Foundation [COMPLETE]

> **STATUS**: ✅ All foundation tasks are complete.

### [x] 1.1 Create browser package structure

- **lib**: `@frontmcp/browser`
- **summary**: Initialize Nx library with browser package.json
- **description**: Use Nx to generate a new library at `libs/browser`. Configure `package.json` with name `@frontmcp/browser`, dependencies on `@frontmcp/sdk: workspace:*`, `valtio: ^2.1.2`, `zod: ^3.23.8`, `idb: ^8.0.0`. Set peer dependencies for React 18+ as optional. Configure exports for main entry `.` and React subpath `./react`.
- **files**:
  - CREATE: `libs/browser/package.json`
  - CREATE: `libs/browser/project.json`
  - CREATE: `libs/browser/README.md`

### [x] 1.2 Create tsconfig.json for browser target

- **lib**: `@frontmcp/browser`
- **summary**: Configure TypeScript for browser environment
- **description**: Create `libs/browser/tsconfig.json` targeting ES2022 with ESNext modules. Include libs: ES2022, DOM, DOM.Iterable, WebWorker. Enable strict mode, declaration files, source maps. Configure paths for SDK imports. Set jsx to react-jsx for React integration.
- **files**:
  - CREATE: `libs/browser/tsconfig.json`
  - CREATE: `libs/browser/tsconfig.lib.json`
  - CREATE: `libs/browser/tsconfig.spec.json`

### [x] 1.3 Verify SDK/core imports work

- **lib**: `@frontmcp/browser`
- **summary**: Test that all SDK/core imports resolve correctly
- **description**: Create a test file that imports all expected exports from `@frontmcp/sdk/core`: `initializeConfig`, `getConfig`, `generateUUID`, `RegistryAbstract`, `RegistryBuildMapResult`, `ToolEntry`, `ResourceEntry`, `ToolContext`, `ResourceContext`, `TransportAdapterBase`, `NoOpHostAdapter`, `McpError`, `ResourceNotFoundError`, `MCP_ERROR_CODES`. Verify TypeScript compiles without errors and types are correct.
- **files**:
  - CREATE: `libs/browser/src/sdk-imports.spec.ts`

### [x] 1.4 Create browser-specific base classes

- **lib**: `@frontmcp/browser`
- **summary**: Create BrowserToolEntry and BrowserResourceEntry extending SDK
- **description**: Create `libs/browser/src/entries/browser-tool.entry.ts` with `BrowserToolEntry` class extending SDK's `ToolEntry`. Add browser-specific methods: `getStore<T>()`, `getComponentRegistry()`, `getRendererRegistry()`, `createUIResource()`. Similarly create `BrowserResourceEntry` extending `ResourceEntry` with `getStore<T>()` method.
- **files**:
  - CREATE: `libs/browser/src/entries/browser-tool.entry.ts`
  - CREATE: `libs/browser/src/entries/browser-resource.entry.ts`
  - CREATE: `libs/browser/src/entries/index.ts`

### [x] 1.5 Create transport interface types

- **lib**: `@frontmcp/browser`
- **summary**: Define browser transport interfaces
- **description**: Create `libs/browser/src/transport/transport.interface.ts` with types: `BrowserTransport` interface, `RequestTransport` interface, `MessageHandler` type, `MinimalEventEmitter` interface. These extend SDK's `TransportAdapterBase` pattern for browser-specific implementations.
- **files**:
  - CREATE: `libs/browser/src/transport/transport.interface.ts`

### [x] 1.6 Create store interface types

- **lib**: `@frontmcp/browser`
- **summary**: Define Valtio store types
- **description**: Create `libs/browser/src/store/store.types.ts` with types: `McpStore<T>` interface with `state`, `getSnapshot()`, `subscribe()`, `subscribeKey()`, `onMutation()` methods. Define `MutationOperation` type for tracking state changes. These are browser-specific with no SDK equivalent.
- **files**:
  - CREATE: `libs/browser/src/store/store.types.ts`

### [x] 1.7 Create registry interface types

- **lib**: `@frontmcp/browser`
- **summary**: Define component and renderer registry types
- **description**: Create `libs/browser/src/registry/types.ts` with types: `ComponentDefinition<Props>` with name, description, propsSchema (Zod), defaultProps, category, tags, examples. Define `RendererDefinition<Props, Result>` with name, description, inputSchema, render function. These will extend SDK's `RegistryAbstract`.
- **files**:
  - CREATE: `libs/browser/src/registry/types.ts`

---

## Phase 2: Transport Layer [COMPLETE]

> **STATUS**: ✅ All transport layer tasks are complete.

### [x] 2.1 Implement EventTransportAdapter

- **lib**: `@frontmcp/browser`
- **summary**: Create EventEmitter-based transport extending SDK base
- **description**: Create `libs/browser/src/transport/event-transport.adapter.ts` with `EventTransportAdapter` class extending `TransportAdapterBase`. Constructor takes `MinimalEventEmitter` and options for `sendEvent` (default: 'mcp:response') and `receiveEvent` (default: 'mcp:request'). Implement `connect()` to subscribe to receiveEvent and call `connectMcpHandlers()`. Implement `send()` to emit on sendEvent. Implement `destroy()` to remove all listeners.
- **files**:
  - CREATE: `libs/browser/src/transport/event-transport.adapter.ts`

### [x] 2.2 Implement PostMessageTransportAdapter

- **lib**: `@frontmcp/browser`
- **summary**: Create postMessage-based transport for WebWorkers
- **description**: Create `libs/browser/src/transport/postmessage-transport.adapter.ts` with `PostMessageTransportAdapter` class extending `TransportAdapterBase`. Constructor takes `Worker | Window | MessagePort` target and options for `allowedOrigins`, `messageType`. Implement origin validation in message handler. Use structured clone for message passing. Handle cross-origin security.
- **files**:
  - CREATE: `libs/browser/src/transport/postmessage-transport.adapter.ts`

### [x] 2.3 Implement transport utilities

- **lib**: `@frontmcp/browser`
- **summary**: Create helper utilities for transports
- **description**: Create `libs/browser/src/transport/utils.ts` with helper functions: `createSimpleEmitter()` factory for creating minimal EventEmitter, type guards `isJSONRPCRequest()`, `isJSONRPCResponse()`, `isJSONRPCNotification()`. Note: `generateUUID` comes from SDK/core, not reimplemented here.
- **files**:
  - CREATE: `libs/browser/src/transport/utils.ts`

### [x] 2.4 Create browser-specific error classes

- **lib**: `@frontmcp/browser`
- **summary**: Add browser-specific errors extending SDK errors
- **description**: Create `libs/browser/src/errors/index.ts` that re-exports SDK error classes (`McpError`, `ResourceNotFoundError`, etc.) and adds browser-specific errors: `OriginValidationError` for postMessage security failures, `TransportClosedError` for connection issues.
- **files**:
  - CREATE: `libs/browser/src/errors/index.ts`
  - CREATE: `libs/browser/src/errors/origin-validation.error.ts`

### [x] 2.5 Create transport barrel export

- **lib**: `@frontmcp/browser`
- **summary**: Create index.ts for transport module
- **description**: Create `libs/browser/src/transport/index.ts` that exports `EventTransportAdapter`, `PostMessageTransportAdapter`, transport types, and re-exports SDK types: `JSONRPCMessage`, `MessageHandler`.
- **files**:
  - CREATE: `libs/browser/src/transport/index.ts`

---

## Phase 3: Valtio Store [COMPLETE]

> **STATUS**: ✅ All store tasks are complete.

### [x] 3.1 Implement createMcpStore

- **lib**: `@frontmcp/browser`
- **summary**: Create Valtio-based reactive store
- **description**: Create `libs/browser/src/store/valtio-store.ts` with `createMcpStore<T>(initial: T)` factory. Use Valtio's `proxy()` for state, implement `getSnapshot()` using Valtio's `snapshot()`, `subscribe()` using `subscribe()`, `subscribeKey()` for key-level subscriptions, and `onMutation()` for tracking mutation operations with operation type (set/delete) and path.
- **files**:
  - CREATE: `libs/browser/src/store/valtio-store.ts`

### [x] 3.2 Implement IndexedDB persistence

- **lib**: `@frontmcp/browser`
- **summary**: Create IndexedDB adapter for store persistence
- **description**: Create `libs/browser/src/store/persistence/indexed-db.ts` with `createIndexedDBPersistence(options: PersistenceOptions)`. Options include `name`, `storeName`, `include`/`exclude` paths, `debounce` time. Implement `load()` to restore state on startup, `save()` to persist state changes, use debouncing to batch writes. Use `idb` library for IndexedDB abstraction.
- **files**:
  - CREATE: `libs/browser/src/store/persistence/indexed-db.ts`

### [x] 3.3 Implement localStorage persistence

- **lib**: `@frontmcp/browser`
- **summary**: Create localStorage adapter for simple persistence
- **description**: Create `libs/browser/src/store/persistence/local-storage.ts` with `createLocalStoragePersistence(options)`. Simpler sync storage for smaller state. Implement same interface as IndexedDB adapter for interchangeability.
- **files**:
  - CREATE: `libs/browser/src/store/persistence/local-storage.ts`
  - CREATE: `libs/browser/src/store/persistence/index.ts`

### [x] 3.4 Implement MCP resource for store

- **lib**: `@frontmcp/browser`
- **summary**: Create MCP resource and tool for store access
- **description**: Create `libs/browser/src/store/mcp-integration.ts`. Implement `StoreResource` extending `BrowserResourceEntry` with URI pattern `store://{path}` that reads state at path. Implement `StoreSetTool` extending `BrowserToolEntry` for `store-set` tool that mutates state. Both should emit MCP notifications on changes.
- **files**:
  - CREATE: `libs/browser/src/store/mcp-integration.ts`

### [x] 3.5 Create store barrel export

- **lib**: `@frontmcp/browser`
- **summary**: Create index.ts for store module
- **description**: Create `libs/browser/src/store/index.ts` that exports `createMcpStore`, `createPersistedStore`, `McpStore` type, persistence adapters.
- **files**:
  - CREATE: `libs/browser/src/store/index.ts`

---

## Phase 4: Component & Renderer Registry [COMPLETE]

> **STATUS**: ✅ All registry tasks are complete.

### [x] 4.1 Implement ComponentRegistry

- **lib**: `@frontmcp/browser`
- **summary**: Create component registry extending SDK RegistryAbstract
- **description**: Create `libs/browser/src/registry/component.registry.ts` with `ComponentRegistry` class extending `RegistryAbstract<ComponentDefinition[], ComponentRecord>`. Implement `buildMap()` to create records with indexes, `buildGraph()` (components have no dependencies), `initialize()`. Create indexes: `byName` Map, `byCategory` Map, `byTag` Map. Implement public API: `get(name)`, `list()`, `listByCategory(category)`, `search(tags)`, `has(name)`.
- **files**:
  - CREATE: `libs/browser/src/registry/component.registry.ts`

### [x] 4.2 Implement RendererRegistry

- **lib**: `@frontmcp/browser`
- **summary**: Create renderer registry extending SDK RegistryAbstract
- **description**: Create `libs/browser/src/registry/renderer.registry.ts` with `RendererRegistry` class extending `RegistryAbstract<RendererDefinition[], RendererRecord>`. Implement `buildMap()`, `buildGraph()`, `initialize()`. Create indexes: `byName` Map, `byMimeType` Map. Implement public API similar to ComponentRegistry.
- **files**:
  - CREATE: `libs/browser/src/registry/renderer.registry.ts`

### [x] 4.3 Create built-in browser resource entries

- **lib**: `@frontmcp/browser`
- **summary**: Create component list and component detail resources
- **description**: Create `libs/browser/src/entries/built-in/component-list.resource.ts` with resource URI `components://list` that returns all registered components as JSON. Create `component://{name}` resource that returns single component definition with its props schema.
- **files**:
  - CREATE: `libs/browser/src/entries/built-in/component-list.resource.ts`
  - CREATE: `libs/browser/src/entries/built-in/component.resource.ts`

### [x] 4.4 Create built-in browser tool entries

- **lib**: `@frontmcp/browser`
- **summary**: Create render tool for component rendering
- **description**: Create `libs/browser/src/entries/built-in/render.tool.ts` with `RenderTool` extending `BrowserToolEntry`. Accepts component name, props, and optional target. Validates props against component schema. Calls renderer to produce output. Returns success status and element ID.
- **files**:
  - CREATE: `libs/browser/src/entries/built-in/render.tool.ts`
  - CREATE: `libs/browser/src/entries/built-in/index.ts`

### [x] 4.5 Create registry barrel export

- **lib**: `@frontmcp/browser`
- **summary**: Create index.ts for registry module
- **description**: Create `libs/browser/src/registry/index.ts` that exports `ComponentRegistry`, `RendererRegistry`, `createComponentRegistry`, `createRendererRegistry` factories, and re-exports SDK types: `RegistryBuildMapResult`.
- **files**:
  - CREATE: `libs/browser/src/registry/index.ts`

---

## Phase 5: Browser MCP Server [COMPLETE]

> **STATUS**: ✅ All server tasks are complete.

### [x] 5.1 Implement BrowserMcpServer class

- **lib**: `@frontmcp/browser`
- **summary**: Create main browser MCP server class
- **description**: Create `libs/browser/src/server/browser-server.instance.ts` with `BrowserMcpServer` class. Use SDK's `ToolRegistry`, `ResourceRegistry` patterns. Include browser's `ComponentRegistry`, `RendererRegistry`. Manage transport connection, store, and registries. Implement `initialize()`, `getTransport()`, `getStore()`, `getComponentRegistry()`, `getRendererRegistry()`, `close()`.
- **files**:
  - CREATE: `libs/browser/src/server/browser-server.instance.ts`

### [x] 5.2 Implement BrowserNotificationAdapter

- **lib**: `@frontmcp/browser`
- **summary**: Adapt SDK NotificationService for browser transport
- **description**: Create `libs/browser/src/server/browser-notification.adapter.ts` with `BrowserNotificationAdapter` class. Adapts SDK's `NotificationService` patterns to send via `EventTransportAdapter` or `PostMessageTransportAdapter`. Handle resource change notifications, tool list changes, etc.
- **files**:
  - CREATE: `libs/browser/src/server/browser-notification.adapter.ts`

### [x] 5.3 Implement createBrowserMcpServer factory

- **lib**: `@frontmcp/browser`
- **summary**: Create factory function for server initialization
- **description**: Create `libs/browser/src/server/factory.ts` with `createBrowserMcpServer(options: BrowserMcpServerOptions)` async factory. Options include `info` (name, version), `transport`, `store`, `persistence`. Initialize runtime config using `initializeConfig()` from SDK. Register built-in tools/resources. Return configured `BrowserMcpServer` instance.
- **files**:
  - CREATE: `libs/browser/src/server/factory.ts`
  - CREATE: `libs/browser/src/server/types.ts`

### [x] 5.4 Create server barrel export

- **lib**: `@frontmcp/browser`
- **summary**: Create index.ts for server module
- **description**: Create `libs/browser/src/server/index.ts` that exports `BrowserMcpServer`, `createBrowserMcpServer`, server types, and re-exports SDK types: `ToolMetadata`, `ResourceMetadata`.
- **files**:
  - CREATE: `libs/browser/src/server/index.ts`

---

## Phase 6: React Integration [COMPLETE]

> **STATUS**: ✅ All React integration tasks are complete. Enhanced with useNotifyAgent, usePageContext, useRegisterComponent, useElicit hooks.

### [x] 6.1 Implement FrontMcpBrowserProvider

- **lib**: `@frontmcp/browser`
- **summary**: Create React context provider
- **description**: Create `libs/browser/src/react/provider.tsx` with `FrontMcpBrowserProvider` component. Props include `server: BrowserMcpServer`, `children`. Create context with server, store, transport. Use `useMemo` for memoization. Handle cleanup on unmount.
- **files**:
  - CREATE: `libs/browser/src/react/provider.tsx`
  - CREATE: `libs/browser/src/react/context.ts`

### [x] 6.2 Implement useStore hook

- **lib**: `@frontmcp/browser`
- **summary**: Create hook for Valtio store access
- **description**: Create `libs/browser/src/react/hooks/use-store.ts` with `useStore<T>(selector?)` hook. Use Valtio's `useSnapshot()` for reactive updates. Optional selector for specific state paths. Handle context access and error if used outside provider.
- **files**:
  - CREATE: `libs/browser/src/react/hooks/use-store.ts`

### [x] 6.3 Implement useTool hook

- **lib**: `@frontmcp/browser`
- **summary**: Create hook for tool execution
- **description**: Create `libs/browser/src/react/hooks/use-tool.ts` with `useTool<TInput, TOutput>(toolName)` hook. Return `{ execute, isLoading, error, data }`. Handle loading state, error handling, memoization. Execute via transport.request().
- **files**:
  - CREATE: `libs/browser/src/react/hooks/use-tool.ts`

### [x] 6.4 Implement useResource hook

- **lib**: `@frontmcp/browser`
- **summary**: Create hook for resource fetching
- **description**: Create `libs/browser/src/react/hooks/use-resource.ts` with `useResource<T>(uri, options?)` hook. Return `{ data, isLoading, error, refetch }`. Options include `refetchInterval`, `enabled`. Auto-fetch on mount, handle subscriptions.
- **files**:
  - CREATE: `libs/browser/src/react/hooks/use-resource.ts`

### [x] 6.5 Implement useMcp hook

- **lib**: `@frontmcp/browser`
- **summary**: Create hook for full context access
- **description**: Create `libs/browser/src/react/hooks/use-mcp.ts` with `useMcp()` hook. Return full context: `{ server, store, transport, componentRegistry, rendererRegistry }`. For advanced use cases needing direct access.
- **files**:
  - CREATE: `libs/browser/src/react/hooks/use-mcp.ts`

### [x] 6.6 Implement useComponent hook

- **lib**: `@frontmcp/browser`
- **summary**: Create hook for component rendering
- **description**: Create `libs/browser/src/react/hooks/use-component.ts` with `useComponent(componentName, props?)` hook. Validate props against component schema. Return rendered component or error. Handle component not found gracefully.
- **files**:
  - CREATE: `libs/browser/src/react/hooks/use-component.ts`

### [x] 6.7 Create React barrel export

- **lib**: `@frontmcp/browser`
- **summary**: Create index.ts for react subpath
- **description**: Create `libs/browser/src/react/index.ts` that exports `FrontMcpBrowserProvider`, all hooks (`useStore`, `useTool`, `useResource`, `useMcp`, `useComponent`), context types. This is the `./react` subpath entry.
- **files**:
  - CREATE: `libs/browser/src/react/index.ts`
  - CREATE: `libs/browser/src/react/hooks/index.ts`

---

## Phase 7: Examples [COMPLETE]

> **STATUS**: ✅ All example tasks are complete.

### [x] 7.1 Create vanilla JavaScript example

- **lib**: `@frontmcp/browser`
- **summary**: Create basic example without React
- **description**: Create `libs/browser/examples/vanilla/` with `index.html`, `main.ts`, `README.md`. Demo basic store + tools usage. Show EventTransport setup, store mutations, MCP tool calls. No framework dependencies.
- **files**:
  - CREATE: `libs/browser/examples/vanilla/index.html`
  - CREATE: `libs/browser/examples/vanilla/main.ts`
  - CREATE: `libs/browser/examples/vanilla/README.md`

### [x] 7.2 Create React example

- **lib**: `@frontmcp/browser`
- **summary**: Create full React app example
- **description**: Create `libs/browser/examples/react/` with full React app structure. Demo `FrontMcpBrowserProvider`, all hooks, component registration. Include `package.json` for standalone running.
- **files**:
  - CREATE: `libs/browser/examples/react/src/App.tsx`
  - CREATE: `libs/browser/examples/react/src/main.tsx`
  - CREATE: `libs/browser/examples/react/index.html`
  - CREATE: `libs/browser/examples/react/package.json`
  - CREATE: `libs/browser/examples/react/README.md`

### [x] 7.3 Create WebWorker example

- **lib**: `@frontmcp/browser`
- **summary**: Create MCP server in WebWorker example
- **description**: Create `libs/browser/examples/worker/` demonstrating MCP server running in WebWorker. Show `PostMessageTransport` usage, worker.ts with server, main.ts with client.
- **files**:
  - CREATE: `libs/browser/examples/worker/index.html`
  - CREATE: `libs/browser/examples/worker/main.ts`
  - CREATE: `libs/browser/examples/worker/worker.ts`
  - CREATE: `libs/browser/examples/worker/README.md`

### [x] 7.4 Create component registration example

- **lib**: `@frontmcp/browser`
- **summary**: Create custom components + renderer example
- **description**: Create `libs/browser/examples/components/` demonstrating component registration, custom renderers, props validation.
- **files**:
  - CREATE: `libs/browser/examples/components/index.html`
  - CREATE: `libs/browser/examples/components/main.ts`
  - CREATE: `libs/browser/examples/components/components.ts`
  - CREATE: `libs/browser/examples/components/README.md`

---

## Phase 8: Testing [COMPLETE]

> **STATUS**: ✅ All testing tasks are complete. 243 tests passing.

### [x] 8.1 Transport tests

- **lib**: `@frontmcp/browser`
- **summary**: Create transport layer test suite
- **description**: Create tests for `EventTransportAdapter` and `PostMessageTransportAdapter`. Test message sending/receiving, connection lifecycle, error handling, origin validation for postMessage.
- **files**:
  - CREATE: `libs/browser/src/transport/event-transport.adapter.spec.ts`
  - CREATE: `libs/browser/src/transport/postmessage-transport.adapter.spec.ts`

### [x] 8.2 Store tests

- **lib**: `@frontmcp/browser`
- **summary**: Create store test suite
- **description**: Create tests for Valtio store, persistence adapters, MCP integration. Test subscriptions, mutations, IndexedDB persistence.
- **files**:
  - CREATE: `libs/browser/src/store/valtio-store.spec.ts`
  - CREATE: `libs/browser/src/store/persistence/indexed-db.spec.ts`
  - CREATE: `libs/browser/src/store/mcp-integration.spec.ts`

### [x] 8.3 Registry tests

- **lib**: `@frontmcp/browser`
- **summary**: Create registry test suite
- **description**: Create tests for ComponentRegistry and RendererRegistry. Test registration, lookup, indexing, MCP resource/tool integration.
- **files**:
  - CREATE: `libs/browser/src/registry/component.registry.spec.ts`
  - CREATE: `libs/browser/src/registry/renderer.registry.spec.ts`

### [x] 8.4 Server tests

- **lib**: `@frontmcp/browser`
- **summary**: Create server test suite
- **description**: Create tests for BrowserMcpServer, notification adapter, factory. Test initialization, request handling, lifecycle.
- **files**:
  - CREATE: `libs/browser/src/server/browser-server.instance.spec.ts`
  - CREATE: `libs/browser/src/server/factory.spec.ts`

### [x] 8.5 React tests

- **lib**: `@frontmcp/browser`
- **summary**: Create React integration test suite
- **description**: Create tests for all hooks using `@testing-library/react-hooks`. Test provider, hook behavior, error boundaries.
- **files**:
  - CREATE: `libs/browser/src/react/provider.spec.tsx`
  - CREATE: `libs/browser/src/react/hooks/use-store.spec.ts`
  - CREATE: `libs/browser/src/react/hooks/use-tool.spec.ts`

---

## Phase 9: Navigator Model Context [COMPLETE]

> **STATUS**: ✅ All navigator.modelContext tasks are complete. Polyfill supports registerTool, registerResource, registerPrompt, notifications, and session management.

### [x] 9.1 Implement navigator.modelContext polyfill

- **lib**: `@frontmcp/browser`
- **summary**: Create W3C-aligned polyfill
- **description**: Create `libs/browser/src/polyfill/navigator-model-context.ts` that adds `navigator.modelContext` API. Auto-registration on import, lazy server initialization. Implement `connect()` method returning MCP connection object.
- **files**:
  - CREATE: `libs/browser/src/polyfill/navigator-model-context.ts`
  - CREATE: `libs/browser/src/polyfill/index.ts`

### [x] 9.2 Implement registerTool API

- **lib**: `@frontmcp/browser`
- **summary**: Create dynamic tool registration
- **description**: Implement `mcp.registerTool(name, { description, inputSchema, handler })` on the polyfill connection. Dynamic tool registration after connection, schema validation, TypeScript types.
- **files**:
  - MODIFY: `libs/browser/src/polyfill/navigator-model-context.ts`

### [x] 9.3 Implement registerResource API

- **lib**: `@frontmcp/browser`
- **summary**: Create dynamic resource registration
- **description**: Implement `mcp.registerResource(name, { description, handler })` on the polyfill connection. Dynamic resource registration, URI pattern validation, subscription support.
- **files**:
  - MODIFY: `libs/browser/src/polyfill/navigator-model-context.ts`

### [x] 9.4 Implement registerPrompt API

- **lib**: `@frontmcp/browser`
- **summary**: Create dynamic prompt registration
- **description**: Implement `mcp.registerPrompt(name, { description, argsSchema, handler })` on the polyfill connection. Dynamic prompt registration, argument schema validation.
- **files**:
  - MODIFY: `libs/browser/src/polyfill/navigator-model-context.ts`

### [x] 9.5 Document W3C alignment

- **lib**: `@frontmcp/browser`
- **summary**: Create navigator.modelContext documentation
- **description**: Documentation already exists at `browser-poc/docs/NAVIGATOR-MODEL-CONTEXT.md`. Review and update if needed for implementation accuracy.
- **files**:
  - MODIFY: `browser-poc/docs/NAVIGATOR-MODEL-CONTEXT.md` (if needed)

### [x] 9.6 Claude Desktop compatibility layer

- **lib**: `@frontmcp/browser`
- **summary**: Test polyfill with Claude Desktop MCP client
- **description**: Ensure polyfill works with Claude Desktop's MCP client expectations. Test tool discovery and execution, verify resource subscriptions work correctly.
- **files**:
  - CREATE: `libs/browser/src/polyfill/claude-desktop.spec.ts`

---

## Phase 10: App Bridge / Host SDK [COMPLETE]

> **STATUS**: ✅ All App Bridge tasks are complete. createAppHost and createAppChild factories implemented with postMessage transport.

### [x] 10.1 Create @frontmcp/browser/host package

- **lib**: `@frontmcp/browser`
- **summary**: Create host SDK entry point
- **description**: Create `libs/browser/src/host/index.ts` as package entry point for host applications. TypeScript declarations for embedding FrontMCP apps.
- **files**:
  - CREATE: `libs/browser/src/host/index.ts`

### [x] 10.2 Implement createAppHost factory

- **lib**: `@frontmcp/browser`
- **summary**: Create app host factory
- **description**: Create `libs/browser/src/host/app-host.ts` with `createAppHost(options)` factory. Options include `container`, `sandbox` attributes, `allowedOrigins`, `csp`, `onToolCall`, `onResourceRequest`, `onAppMessage`, `onAppError`.
- **files**:
  - CREATE: `libs/browser/src/host/app-host.ts`

### [x] 10.3 Implement createAppChild factory

- **lib**: `@frontmcp/browser`
- **summary**: Create child-side app SDK
- **description**: Create `libs/browser/src/host/app-child.ts` with `createAppChild(options)` factory for embedded applications. Parent communication via postMessage.
- **files**:
  - CREATE: `libs/browser/src/host/app-child.ts`

### [x] 10.4 Create host/child type definitions

- **lib**: `@frontmcp/browser`
- **summary**: Create type definitions for App Bridge
- **description**: Create `libs/browser/src/host/types.ts` with AppHost, AppChild, LoadedApp interfaces and error classes.
- **files**:
  - CREATE: `libs/browser/src/host/types.ts`

### [x] 10.5 Create host tests

- **lib**: `@frontmcp/browser`
- **summary**: Create test suite for App Bridge
- **description**: Create tests for createAppHost and createAppChild factories.
- **files**:
  - CREATE: `libs/browser/src/host/app-host.spec.ts`
  - CREATE: `libs/browser/src/host/app-child.spec.ts`

### [x] 10.6 Add package.json export

- **lib**: `@frontmcp/browser`
- **summary**: Add ./host export to package.json
- **description**: Update package.json to export `./host` subpath.
- **files**:
  - MODIFY: `libs/browser/package.json`

---

## Phase 11: UI Resource Delivery [COMPLETE]

> **STATUS**: ✅ All UI Resource tasks are complete. createUIResource, renderToString, escapeHtml, safeHtml utilities implemented.

### [x] 11.1 Implement createUIResource helper

- **lib**: `@frontmcp/browser`
- **summary**: Create helper for UI resource generation
- **description**: Create `libs/browser/src/ui-resource/ui-resource.ts` with `createUIResource(html, options)` function. Options include `mimeType`, `styles`, `scripts`. Returns resource with `uri`, `mimeType`, `html`, `_meta`.
- **files**:
  - CREATE: `libs/browser/src/ui-resource/ui-resource.ts`
  - CREATE: `libs/browser/src/ui-resource/types.ts`
  - CREATE: `libs/browser/src/ui-resource/index.ts`

### [x] 11.2 Add text/html profile support

- **lib**: `@frontmcp/browser`
- **summary**: Implement MCP app MIME type handling
- **description**: Support `text/html`, `text/html;profile=ui` MIME types for renderable HTML. Defined in `UIResourceMimeType` type.
- **files**:
  - MODIFY: `libs/browser/src/ui-resource/types.ts`

### [x] 11.3 Implement \_meta.resourceUri linking

- **lib**: `@frontmcp/browser`
- **summary**: Create tool-to-UI association pattern
- **description**: Implemented `createToolResultWithUI` helper and `_meta: { resourceUri, mimeType }` pattern for linking tool results to UI resources.
- **files**:
  - MODIFY: `libs/browser/src/ui-resource/ui-resource.ts`

### [x] 11.4 Create renderToString utilities

- **lib**: `@frontmcp/browser`
- **summary**: Create HTML rendering utilities
- **description**: Implemented `renderToString`, `wrapInDocument`, `minifyHtml`, `escapeHtml`, `safeHtml`, `rawHtml` utilities. Also `isUIResourceUri`, `extractResourceId`, `createResourceUri` URI helpers.
- **files**:
  - MODIFY: `libs/browser/src/ui-resource/ui-resource.ts`

### [x] 11.5 Create UI resource tests

- **lib**: `@frontmcp/browser`
- **summary**: Create test suite for UI resources
- **description**: Create comprehensive tests for all UI resource utilities.
- **files**:
  - CREATE: `libs/browser/src/ui-resource/ui-resource.spec.ts`

---

## Phase 12: Chrome Extension Transport [COMPLETE]

> **STATUS**: ✅ All Chrome Extension transport tasks are complete.

### [x] 12.1 Implement ExtensionServerTransport

- **lib**: `@frontmcp/browser`
- **summary**: Create Chrome Extension transport
- **description**: Created `libs/browser/src/transport/extension-transport.adapter.ts` using `chrome.runtime.Port` communication. Supports background, content-script, and external modes. Handles multiple client connections, message routing, and client lifecycle management.
- **files**:
  - CREATED: `libs/browser/src/transport/extension-transport.adapter.ts`

### [x] 12.2 Create extension bridge messaging

- **lib**: `@frontmcp/browser`
- **summary**: Create extension message router
- **description**: Created `libs/browser/src/transport/extension-bridge.ts` for message routing between page and extension using CustomEvents. Supports page, content-script, and background modes with request/response correlation.
- **files**:
  - CREATED: `libs/browser/src/transport/extension-bridge.ts`

### [x] 12.3 Implement TabServerTransport

- **lib**: `@frontmcp/browser`
- **summary**: Create cross-navigation persistent transport
- **description**: Created `libs/browser/src/transport/tab-transport.adapter.ts` for maintaining connections across page navigations. Features session recovery, auto-reconnection, session state persistence via chrome.storage.session, and tab lifecycle management.
- **files**:
  - CREATED: `libs/browser/src/transport/tab-transport.adapter.ts`

### [x] 12.4 Update transport exports

- **lib**: `@frontmcp/browser`
- **summary**: Export new transport adapters
- **description**: Updated `libs/browser/src/transport/index.ts` to export `ExtensionServerTransport`, `TabServerTransport`, `ExtensionBridge`, and all related types.
- **files**:
  - MODIFIED: `libs/browser/src/transport/index.ts`

---

## Phase 13: Component Instances & Events [COMPLETE]

> **STATUS**: ✅ All component instances and events tasks are complete.

### [x] 13.1 Implement ComponentInstanceRegistry

- **lib**: `@frontmcp/browser`
- **summary**: Create instance tracking registry
- **description**: Created `libs/browser/src/registry/instance.registry.ts` with full instance lifecycle management, state per instance, parent-child relationships, cleanup on destroy, and event emission.
- **files**:
  - CREATED: `libs/browser/src/registry/instance.registry.ts`

### [x] 13.2 Add event bus for component events

- **lib**: `@frontmcp/browser`
- **summary**: Create component event system
- **description**: Created `libs/browser/src/events/event-bus.ts` with typed event system including EventType enum, wildcard subscriptions, priority-based handlers, async/sync modes, and global event bus singleton.
- **files**:
  - CREATED: `libs/browser/src/events/event-bus.ts`
  - CREATED: `libs/browser/src/events/index.ts`

### [x] 13.3 Implement form state management

- **lib**: `@frontmcp/browser`
- **summary**: Create form state tracking
- **description**: Created `libs/browser/src/forms/form-state.ts` with form validation (Zod schema support), field state tracking (touched/dirty), submission handling, and event bus integration.
- **files**:
  - CREATED: `libs/browser/src/forms/form-state.ts`
  - CREATED: `libs/browser/src/forms/index.ts`

### [x] 13.4 Instance MCP resources (integrated)

- **lib**: `@frontmcp/browser`
- **summary**: Instance resources via registry
- **description**: Instance access is provided through `ComponentInstanceRegistry.toJSON()`, `get()`, `query()`, and `getByComponent()` methods. Can be exposed as MCP resources via server configuration.
- **files**:
  - INTEGRATED: Instance methods in `libs/browser/src/registry/instance.registry.ts`

### [x] 13.5 Instance MCP tools (integrated)

- **lib**: `@frontmcp/browser`
- **summary**: Instance tools via registry
- **description**: Instance manipulation is provided through `ComponentInstanceRegistry` methods: `setState()`, `setProps()`, `destroy()`, `mount()`, `unmount()`. Events emitted via integrated EventBus.
- **files**:
  - INTEGRATED: Instance methods in `libs/browser/src/registry/instance.registry.ts`

---

## Phase 14: Human-in-the-Loop [COMPLETE]

> **STATUS**: ✅ HiTL implementation complete with SDK foundation and browser integration.
>
> **Implementation Notes**:
>
> - SDK HiTL module created at `libs/sdk/src/hitl/` with types, HitlManager, withConfirmation wrapper, and audit logging
> - Browser HiTL module at `libs/browser/src/hitl/` extends SDK with BrowserHitlManager for persistence and React integration
> - React components (HitlProvider, useHitl, DefaultConfirmationDialog) created in `libs/browser/src/react/context/HitlContext.tsx`
> - All types re-exported from SDK to avoid duplication
> - Supports risk levels (low, medium, high, critical), remembered decisions, bypass rules, and audit logging

### [x] 14.1 SDK HiTL Foundation

- **lib**: `@frontmcp/sdk`
- **summary**: Create base HiTL module in SDK
- **description**: Created `libs/sdk/src/hitl/` with types, HitlManager class, withConfirmation wrapper, and RequiresConfirmation decorator. Exported from `@frontmcp/sdk/core`.
- **files**:
  - CREATE: `libs/sdk/src/hitl/types.ts`
  - CREATE: `libs/sdk/src/hitl/hitl-manager.ts`
  - CREATE: `libs/sdk/src/hitl/with-confirmation.ts`
  - CREATE: `libs/sdk/src/hitl/index.ts`
  - MODIFY: `libs/sdk/src/core/index.ts` (add HiTL exports)

### [x] 14.2 Browser HiTL Manager

- **lib**: `@frontmcp/browser`
- **summary**: Create browser-specific HiTL manager
- **description**: Created `BrowserHitlManager` extending SDK `HitlManager` with localStorage/sessionStorage persistence for audit logs and remembered decisions. Includes native dialog fallback support.
- **files**:
  - CREATE: `libs/browser/src/hitl/browser-hitl-manager.ts`
  - CREATE: `libs/browser/src/hitl/types.ts` (re-exports SDK + browser types)
  - CREATE: `libs/browser/src/hitl/index.ts`

### [x] 14.3 HiTL React Components

- **lib**: `@frontmcp/browser`
- **summary**: Create React HiTL components
- **description**: Created `HitlProvider`, `useHitl` hook, and `DefaultConfirmationDialog` component. Provider manages BrowserHitlManager, renders confirmation dialogs automatically, and exposes context for manual confirmation requests.
- **files**:
  - CREATE: `libs/browser/src/react/context/HitlContext.tsx`
  - MODIFY: `libs/browser/src/react/context/index.ts` (add exports)
  - MODIFY: `libs/browser/src/react/index.ts` (add HiTL exports)

### [x] 14.4 Main Exports

- **lib**: `@frontmcp/browser`
- **summary**: Export HiTL from main package
- **description**: Updated main `libs/browser/src/index.ts` to export the HiTL module. All HiTL types and utilities available from both main package and React subpath.
- **files**:
  - MODIFY: `libs/browser/src/index.ts` (add hitl export)

---

## Phase 15: Advanced UI [COMPLETE]

> **STATUS**: ✅ All Advanced UI tasks complete.
>
> **Implementation Notes**:
>
> - Layout components (Stack, Grid, Container) with responsive props, spacing scale, alignment
> - Theming system with design tokens, dark/light mode, CSS custom properties
> - Theme MCP resources (theme://current, theme://tokens, theme://colors)
> - Accessibility utilities (focus management, ARIA helpers, screen reader announcements)
> - Web Components wrapper with Shadow DOM encapsulation

### [x] 15.1 Layout components

- **lib**: `@frontmcp/browser`
- **summary**: Create layout component library
- **description**: Created Stack, Grid, Container components with responsive props, spacing scale (4px base), alignment, and nested layout support.
- **files**:
  - CREATE: `libs/browser/src/components/layout/types.ts`
  - CREATE: `libs/browser/src/components/layout/Stack.tsx`
  - CREATE: `libs/browser/src/components/layout/Grid.tsx`
  - CREATE: `libs/browser/src/components/layout/Container.tsx`
  - CREATE: `libs/browser/src/components/layout/index.ts`
  - CREATE: `libs/browser/src/components/index.ts`

### [x] 15.2 Theming system

- **lib**: `@frontmcp/browser`
- **summary**: Create theme provider and tokens
- **description**: Created ThemeProvider with design tokens, dark/light/system mode, CSS custom properties (--fmcp-\*), and hooks (useTheme, useToken).
- **files**:
  - CREATE: `libs/browser/src/theme/tokens.ts`
  - CREATE: `libs/browser/src/theme/theme-provider.tsx`
  - CREATE: `libs/browser/src/theme/index.ts`

### [x] 15.3 Theme MCP resources

- **lib**: `@frontmcp/browser`
- **summary**: Create theme resources
- **description**: Created theme://current, theme://tokens, and theme://colors MCP resources for AI agent access to theme information.
- **files**:
  - CREATE: `libs/browser/src/entries/built-in/theme.resource.ts`
  - CREATE: `libs/browser/src/entries/built-in/index.ts`
  - MODIFY: `libs/browser/src/entries/index.ts` (add built-in export)

### [x] 15.4 Accessibility utilities

- **lib**: `@frontmcp/browser`
- **summary**: Create a11y helper utilities
- **description**: Created focus management (focus trap, focusable/tabbable selectors), ARIA helpers (dialog, menu, tabs, combobox props), and screen reader announcer (polite/assertive).
- **files**:
  - CREATE: `libs/browser/src/a11y/focus-management.ts`
  - CREATE: `libs/browser/src/a11y/aria-helpers.ts`
  - CREATE: `libs/browser/src/a11y/announcer.ts`
  - CREATE: `libs/browser/src/a11y/index.ts`

### [x] 15.5 Web Components wrapper

- **lib**: `@frontmcp/browser`
- **summary**: Create custom element wrapper
- **description**: Created FrontMCP custom element factory with Shadow DOM encapsulation, observed attributes, lifecycle callbacks, and MCP server integration.
- **files**:
  - CREATE: `libs/browser/src/web-components/frontmcp-element.ts`
  - CREATE: `libs/browser/src/web-components/index.ts`
  - MODIFY: `libs/browser/src/index.ts` (add exports)

---

## Phase 16: Schema Store [COMPLETE]

> **STATUS**: ✅ All schema store tasks complete.
>
> **Implementation Notes**:
>
> - `defineStore` factory with Zod schema validation and full TypeScript inference
> - Action context with `ctx.state`, `ctx.call()`, `ctx.generateId()`, `ctx.batch()`, `ctx.getSnapshot()` utilities
> - Automatic MCP tool generation from store actions via `createSchemaStoreTools()` and inline `action()` annotations
> - Automatic MCP resource generation for state and computed values via `createSchemaStoreResources()`
> - Persistence support with localStorage/sessionStorage and include/exclude filters
> - `store.registerWith(scope)` for bulk tool/resource registration
> - Derived stores via `deriveStore()` for reactive computed stores
> - All types fully inferred from Zod schemas - no manual type definitions needed

### [x] 16.1 Implement defineStore factory

- **lib**: `@frontmcp/browser`
- **summary**: Create schema-driven store factory
- **description**: Created `libs/browser/src/store/schema-store.ts` with `defineStore(schema, options)`. Features Zod schema parsing, default extraction, proxy creation, and the best DX for building schema-driven Valtio stores.
- **files**:
  - CREATED: `libs/browser/src/store/schema-store.ts`

### [x] 16.2 Implement action-to-tool generation

- **lib**: `@frontmcp/browser`
- **summary**: Auto-generate MCP tools from store actions
- **description**: Created `libs/browser/src/store/schema-store-tools.ts` with `createSchemaStoreTools()`, `createActionTool()`, `createBatchActionTool()`, and `action()` annotation helper. Naming convention: `{storeName}:{actionName}`.
- **files**:
  - CREATED: `libs/browser/src/store/schema-store-tools.ts`

### [x] 16.3 Implement StoreActionContext

- **lib**: `@frontmcp/browser`
- **summary**: Create action execution context
- **description**: Created `libs/browser/src/store/action-context.ts` with `ctx.state`, `ctx.call()`, `ctx.generateId()`, `ctx.generateShortId()`, `ctx.timestamp()`, `ctx.now()`, `ctx.batch()`, `ctx.getSnapshot()` methods. Extended context adds `ctx.log()` and `ctx.markSideEffect()`.
- **files**:
  - CREATED: `libs/browser/src/store/action-context.ts`

### [x] 16.4 Implement store resource generation

- **lib**: `@frontmcp/browser`
- **summary**: Auto-generate MCP resources from store
- **description**: Created `libs/browser/src/store/schema-store-resources.ts` with `createSchemaStoreResources()`, `createTemplateResourceHandler()`, `createStoreSnapshotResource()`, and `createNestedResources()`. Resources: `store://{name}`, `store://{name}/{key}`, `store://{name}/computed/{key}`.
- **files**:
  - CREATED: `libs/browser/src/store/schema-store-resources.ts`

### [x] 16.5 Add schema store persistence

- **lib**: `@frontmcp/browser`
- **summary**: Integrate persistence with schema store
- **description**: Persistence is integrated directly into `defineStore` via the `persist` option. Supports localStorage, sessionStorage, include/exclude path filters, debounce, versioning, and migrations.
- **files**:
  - INTEGRATED: `libs/browser/src/store/schema-store.ts` (PersistConfig interface)

### [x] 16.6 Create registerWith helper

- **lib**: `@frontmcp/browser`
- **summary**: Create bulk registration helper
- **description**: Implemented `store.registerWith(scope)` method directly on SchemaStore for bulk tool/resource registration with MCP scopes.
- **files**:
  - INTEGRATED: `libs/browser/src/store/schema-store.ts` (registerWith method)

### [x] 16.7 Add TypeScript type inference

- **lib**: `@frontmcp/browser`
- **summary**: Create full type inference for schema stores
- **description**: Full type inference for state (from Zod schema), actions (input/output), computed values, and bound action methods. Generic constraints ensure type safety throughout. No manual type definitions needed.
- **files**:
  - COMPLETED: `libs/browser/src/store/schema-store.ts`

---

## Phase 17: Telemetry

### [ ] 17.1 Implement createEventCollector factory

- **lib**: `@frontmcp/browser`
- **summary**: Create event collector factory
- **description**: Create `libs/browser/src/telemetry/collector/event-collector.ts` with category-based capture, event buffer, sampling configuration.
- **files**:
  - CREATE: `libs/browser/src/telemetry/collector/event-collector.ts`
  - CREATE: `libs/browser/src/telemetry/collector/index.ts`

### [ ] 17.2 Implement event capture modules

- **lib**: `@frontmcp/browser`
- **summary**: Create category-specific capture modules
- **description**: Create capture modules: `interaction-capture.ts` (clicks, inputs), `network-capture.ts` (fetch, XHR), `error-capture.ts` (errors, rejections), `log-capture.ts` (console).
- **files**:
  - CREATE: `libs/browser/src/telemetry/capture/interaction-capture.ts`
  - CREATE: `libs/browser/src/telemetry/capture/network-capture.ts`
  - CREATE: `libs/browser/src/telemetry/capture/error-capture.ts`
  - CREATE: `libs/browser/src/telemetry/capture/log-capture.ts`
  - CREATE: `libs/browser/src/telemetry/capture/index.ts`

### [ ] 17.3 Implement PII filter chain

- **lib**: `@frontmcp/browser`
- **summary**: Create PII filtering pipeline
- **description**: Create `libs/browser/src/telemetry/filters/pii-filter-chain.ts` with priority-ordered execution, pattern matching, custom filter support.
- **files**:
  - CREATE: `libs/browser/src/telemetry/filters/pii-filter-chain.ts`

### [ ] 17.4 Implement built-in PII patterns

- **lib**: `@frontmcp/browser`
- **summary**: Create default PII patterns
- **description**: Create `libs/browser/src/telemetry/filters/built-in-patterns.ts` with patterns for email, creditCard, ssn, phone, apiKey, bearerToken, jwt, ip.
- **files**:
  - CREATE: `libs/browser/src/telemetry/filters/built-in-patterns.ts`

### [ ] 17.5 Implement built-in PII filter

- **lib**: `@frontmcp/browser`
- **summary**: Create built-in filter factory
- **description**: Create `libs/browser/src/telemetry/filters/built-in-filter.plugin.ts` with `createBuiltInPiiFilter(options)` factory. Configurable patterns, allowlist/blocklist.
- **files**:
  - CREATE: `libs/browser/src/telemetry/filters/built-in-filter.plugin.ts`

### [ ] 17.6 Implement custom PII filter plugin

- **lib**: `@frontmcp/browser`
- **summary**: Create custom filter plugin factory
- **description**: Create `libs/browser/src/telemetry/filters/pii-filter.plugin.ts` with `createPiiFilterPlugin(options)` for custom patterns, filter function, priority.
- **files**:
  - CREATE: `libs/browser/src/telemetry/filters/pii-filter.plugin.ts`
  - CREATE: `libs/browser/src/telemetry/filters/index.ts`

### [ ] 17.7 Implement MCP resources for telemetry

- **lib**: `@frontmcp/browser`
- **summary**: Create telemetry MCP resources
- **description**: Create `libs/browser/src/telemetry/mcp/event-resources.ts` with resources: `events://recent`, `events://errors`, `events://network`, `events://stats`.
- **files**:
  - CREATE: `libs/browser/src/telemetry/mcp/event-resources.ts`

### [ ] 17.8 Implement MCP notifications for telemetry

- **lib**: `@frontmcp/browser`
- **summary**: Create real-time event notifications
- **description**: Create `libs/browser/src/telemetry/mcp/event-notifications.ts` for `notifications/events/captured` with significance levels.
- **files**:
  - CREATE: `libs/browser/src/telemetry/mcp/event-notifications.ts`
  - CREATE: `libs/browser/src/telemetry/mcp/index.ts`

### [ ] 17.9 Implement React integration for telemetry

- **lib**: `@frontmcp/browser`
- **summary**: Create React telemetry hooks
- **description**: Create hooks: `useEventCollector`, `useEvents`, `useTelemetryStats`. Create `TelemetryProvider` component.
- **files**:
  - CREATE: `libs/browser/src/telemetry/react/use-event-collector.ts`
  - CREATE: `libs/browser/src/telemetry/react/use-events.ts`
  - CREATE: `libs/browser/src/telemetry/react/telemetry-provider.tsx`
  - CREATE: `libs/browser/src/telemetry/react/index.ts`

### [ ] 17.10 Create telemetry barrel export

- **lib**: `@frontmcp/browser`
- **summary**: Create telemetry module exports
- **description**: Create `libs/browser/src/telemetry/index.ts` that exports all telemetry functionality.
- **files**:
  - CREATE: `libs/browser/src/telemetry/index.ts`

---

## Main Entry Point [COMPLETE]

> **STATUS**: ✅ Main entry point is complete with comprehensive exports.

### [x] Create main package entry

- **lib**: `@frontmcp/browser`
- **summary**: Create main index.ts for package
- **description**: `libs/browser/src/index.ts` exports all public APIs including: SDK/core re-exports (crypto, config, registries, entries, transports, errors, URI utilities), platform adapters, entry classes, transport layer, store (Valtio), registries (Component/Renderer), server, scope, and UI resource utilities.
- **files**:
  - CREATED: `libs/browser/src/index.ts` (comprehensive exports)
  - CREATED: `libs/browser/package.json` exports for `.`, `./react`, `./polyfill`, `./types`, `./host`

---

## Summary

| Phase                            | Tasks  | Status          |
| -------------------------------- | ------ | --------------- |
| Phase 0: SDK Prerequisites       | 7      | ✅ COMPLETE     |
| Phase 1: Foundation              | 7      | ✅ COMPLETE     |
| Phase 2: Transport Layer         | 5      | ✅ COMPLETE     |
| Phase 3: Valtio Store            | 5      | ✅ COMPLETE     |
| Phase 4: Registry                | 5      | ✅ COMPLETE     |
| Phase 5: Server                  | 4      | ✅ COMPLETE     |
| Phase 6: React                   | 7      | ✅ COMPLETE     |
| Phase 7: Examples                | 4      | ✅ COMPLETE     |
| Phase 8: Testing                 | 5      | ✅ COMPLETE     |
| Phase 9: Navigator Model Context | 6      | ✅ COMPLETE     |
| Phase 10: App Bridge             | 6      | ✅ COMPLETE     |
| Phase 11: UI Resources           | 5      | ✅ COMPLETE     |
| Phase 12: Chrome Extension       | 4      | ✅ COMPLETE     |
| Phase 13: Instances & Events     | 5      | ✅ COMPLETE     |
| Phase 14: Human-in-the-Loop      | 4      | ✅ COMPLETE     |
| Phase 15: Advanced UI            | 5      | ✅ COMPLETE     |
| Phase 16: Schema Store           | 7      | ✅ COMPLETE     |
| Phase 17: Telemetry              | 10     | Pending         |
| Main Entry                       | 1      | ✅ COMPLETE     |
| **TOTAL**                        | **97** | **95 Complete** |
