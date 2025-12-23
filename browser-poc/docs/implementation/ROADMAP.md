# Implementation Roadmap

Step-by-step implementation plan for FrontMCP Browser.

> **SDK Integration**: Browser-poc imports from `@frontmcp/sdk/core` (platform-agnostic). See [SDK-INTEGRATION.md](../SDK-INTEGRATION.md) for import guide and extension patterns.

## Phase Overview

| Phase | Focus                   | Deliverable                                       |
| ----- | ----------------------- | ------------------------------------------------- |
| **0** | **SDK Prerequisites**   | **Platform-agnostic `/core` entry point in SDK**  |
| 1     | Foundation              | Package setup, transport interfaces               |
| 2     | Transport               | EventTransport, PostMessageTransport              |
| 3     | Store                   | Valtio integration, MCP resources                 |
| 4     | Registry                | Component & Renderer registries                   |
| 5     | Server                  | BrowserMcpServer core                             |
| 6     | React                   | Provider and hooks                                |
| 7     | Examples                | Working demos                                     |
| 8     | Testing                 | Test suite                                        |
| 9     | Navigator Model Context | W3C polyfill for `navigator.modelContext`         |
| 10    | App Bridge              | Host SDK for embedding apps                       |
| 11    | UI Resources            | HTML resource delivery pattern                    |
| 12    | Extension Transport     | Chrome Extension transport                        |
| 13    | Instances               | Component instance state & events                 |
| 14    | Human-in-the-Loop       | Confirmation workflows, audit logging             |
| 15    | Advanced UI             | Layout, theming, accessibility                    |
| 16    | Schema Store            | Schema-driven stores with auto-registered actions |
| 17    | Telemetry               | Browser event capture with PII filtering          |

> **Note**: See [GAP-ANALYSIS.md](../GAP-ANALYSIS.md) for detailed feature gap analysis and competitive positioning.

---

## Phase 0: SDK Prerequisites

### Goal

Implement platform-agnostic `/core` entry point in @frontmcp/sdk before browser-poc can be built.

> **BLOCKING**: Browser-poc cannot proceed until these SDK changes are complete.

### Tasks

- [ ] **0.1** Create platform crypto utilities

  - File: `libs/sdk/src/utils/platform-crypto.ts`
  - Functions: `generateUUID()`, `getRandomBytes()`, `sha256()`
  - Uses Web Crypto API (works in Node.js 19+ and browsers)

- [ ] **0.2** Create runtime configuration

  - File: `libs/sdk/src/config/runtime-config.ts`
  - Functions: `initializeConfig()`, `getConfig()`
  - Replaces `process.env` with injectable config
  - Node.js fallback for backward compatibility

- [ ] **0.3** Create abstract transport base

  - File: `libs/sdk/src/transport/adapters/transport.base.adapter.ts`
  - Class: `TransportAdapterBase`
  - Methods: `connect()`, `send()`, `destroy()`, `connectMcpHandlers()`
  - HTTP transports extend this (backward compatible)
  - Browser transports extend this (new)

- [ ] **0.4** Create NoOp host adapter

  - File: `libs/sdk/src/server/adapters/noop.host.adapter.ts`
  - Class: `NoOpHostAdapter extends HostServerAdapter`
  - No-op implementation for browser (no HTTP server)

- [ ] **0.5** Create `/core` entry point

  - File: `libs/sdk/src/core/index.ts`
  - Exports only platform-agnostic code
  - Does NOT export: Express adapter, SSE transport, auth modules, Redis

- [ ] **0.6** Update SDK package.json

  - Add `./core` export path
  - No breaking changes to main entry

- [ ] **0.7** Update SDK files to use platform utilities
  - Replace `import { randomUUID } from 'crypto'` with `generateUUID()`
  - Replace `process.env` with `getConfig()` (with fallback)
  - ~15 files need updates

### Acceptance Criteria

- `@frontmcp/sdk` main entry unchanged (backward compatible)
- `@frontmcp/sdk/core` exports platform-agnostic code
- All existing tests pass
- Browser can import from `/core` without Node.js errors

---

## Phase 1: Foundation

### Goal

Set up package structure, configure SDK dependency, and define core interfaces.

> **Depends on**: Phase 0 (SDK Prerequisites) must be complete before starting.
>
> **SDK Note**: Imports from `@frontmcp/sdk/core`. All later phases extend SDK base classes.

### Tasks

- [ ] **1.1** Create package.json with SDK dependency

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

  > Uses `@frontmcp/sdk` (not `@modelcontextprotocol/sdk` directly). SDK wraps MCP SDK internally.

- [ ] **1.2** Create tsconfig.json for browser target

  - Target: ES2022
  - Module: ESNext
  - Lib: ES2022, DOM, WebWorker
  - Configure paths for SDK imports

- [ ] **1.3** Verify SDK/core imports work

  - Test importing from `@frontmcp/sdk/core`:
    - `initializeConfig`, `getConfig`, `generateUUID`
    - `RegistryAbstract`, `RegistryBuildMapResult`
    - `ToolEntry`, `ResourceEntry`, `ToolContext`, `ResourceContext`
    - `TransportAdapterBase`, `NoOpHostAdapter`
    - Error classes: `McpError`, `ResourceNotFoundError`, etc.

- [ ] **1.4** Create browser-specific base classes

  - File: `src/entries/browser-tool.entry.ts`
    - `BrowserToolEntry` extends SDK's `ToolEntry`
  - File: `src/entries/browser-resource.entry.ts`
    - `BrowserResourceEntry` extends SDK's `ResourceEntry`

- [ ] **1.5** Create transport interface types

  - File: `src/transport/transport.interface.ts`
  - Types: BrowserTransport, RequestTransport, MessageHandler
  - Extends SDK's `TransportAdapterBase` pattern

- [ ] **1.6** Create store interface types

  - File: `src/store/store.types.ts`
  - Types: McpStore, MutationOperation
  - Browser-specific (no SDK equivalent)

- [ ] **1.7** Create registry interface types
  - File: `src/registry/types.ts`
  - Types: ComponentDefinition, RendererDefinition
  - Will extend SDK's `RegistryAbstract`

### Acceptance Criteria

- Package compiles without errors
- SDK imports resolve correctly
- Browser base classes extend SDK patterns
- All interface types exported

---

## Phase 2: Transport Layer

### Goal

Implement EventTransport and PostMessageTransport by extending SDK's `TransportAdapterBase`.

> **SDK Pattern**: Both transports extend `TransportAdapterBase` from `@frontmcp/sdk/core`, implementing `connect()`, `send()`, and `destroy()`.

### Tasks

- [ ] **2.1** Implement EventTransportAdapter

  - File: `src/transport/event-transport.adapter.ts`
  - Extends: `TransportAdapterBase`
  - Implement: `connect()`, `send()`, `destroy()`
  - Uses: `connectMcpHandlers()` from base class

- [ ] **2.2** Implement PostMessageTransportAdapter

  - File: `src/transport/postmessage-transport.adapter.ts`
  - Extends: `TransportAdapterBase`
  - Features: origin validation, structured clone
  - Implement: `connect()`, `send()`, `destroy()`

- [ ] **2.3** Implement helper utilities

  - File: `src/transport/utils.ts`
  - Functions: createSimpleEmitter, type guards
  - Note: `generateUUID` comes from SDK/core

- [ ] **2.4** Use SDK error classes

  - Import from `@frontmcp/sdk/core`:
    - `TransportError`, `TransportClosedError`
  - Add browser-specific if needed:
    - `OriginValidationError`

- [ ] **2.5** Create barrel export
  - File: `src/transport/index.ts`
  - Re-export SDK types: `JSONRPCMessage`, `MessageHandler`

### Acceptance Criteria

- Transports extend SDK's TransportAdapterBase
- EventTransport handles full request/response cycle
- PostMessageTransport works with Worker
- Pending requests rejected on close (inherited from SDK)

---

## Phase 3: Valtio Store

### Goal

Implement Valtio-based store with MCP integration.

> **Browser-Specific**: No SDK equivalent. Valtio store is unique to browser-poc for reactive UI state.

### Tasks

- [ ] **3.1** Implement createMcpStore

  - File: `src/store/valtio-store.ts`
  - Features: proxy state, subscribe, subscribeKey, onMutation

- [ ] **3.2** Implement IndexedDB persistence

  - File: `src/store/persistence/indexed-db.ts`
  - Features: load, save, debounced writes

- [ ] **3.3** Implement localStorage persistence

  - File: `src/store/persistence/local-storage.ts`
  - Features: simple sync storage

- [ ] **3.4** Implement MCP resource for store

  - File: `src/store/mcp-integration.ts`
  - Resource: `store://{path}`
  - Tool: `store-set`

- [ ] **3.5** Create barrel export
  - File: `src/store/index.ts`

### Acceptance Criteria

- Store mutations trigger subscribers
- MCP notifications sent on mutation
- Persistence works with IndexedDB

---

## Phase 4: Component & Renderer Registry

### Goal

Implement registries for UI components and renderers by extending SDK's `RegistryAbstract`.

> **SDK Pattern**: Both registries extend `RegistryAbstract` from @frontmcp/sdk, implementing `buildMap()` and `buildGraph()`.

### Tasks

- [ ] **4.1** Implement ComponentRegistry

  - File: `src/registry/component.registry.ts`
  - Extends: `RegistryAbstract<ComponentDefinition[], ComponentRecord>`
  - Implement: `buildMap()`, `buildGraph()`, `initialize()`
  - Features: byName index, byCategory index, byTag index

- [ ] **4.2** Implement RendererRegistry

  - File: `src/registry/renderer.registry.ts`
  - Extends: `RegistryAbstract<RendererDefinition[], RendererRecord>`
  - Implement: `buildMap()`, `buildGraph()`, `initialize()`
  - Features: byName index, byMimeType index

- [ ] **4.3** Create browser resource entries

  - File: `src/entries/built-in/component-list.resource.ts`
    - Extends: `BrowserResourceEntry`
  - Resource URI: `components://list`, `component://{name}`

- [ ] **4.4** Create browser tool entries

  - File: `src/entries/built-in/render.tool.ts`
    - Extends: `BrowserToolEntry`
  - Tool: `render`

- [ ] **4.5** Create barrel export
  - File: `src/registry/index.ts`
  - Re-export SDK types: `RegistryBuildMapResult`

### Acceptance Criteria

- Registries extend SDK's RegistryAbstract
- Components registered and discoverable via inherited methods
- Tools/resources use browser entry base classes
- Props validated via Zod (SDK pattern)

---

## Phase 5: Browser MCP Server

### Goal

Implement the main BrowserMcpServer class using SDK patterns without reimplementing core functionality.

> **SDK Pattern**: Uses SDK's registry patterns and adapts NotificationService for browser transport.

### Tasks

- [ ] **5.1** Implement BrowserMcpServer class

  - File: `src/server/browser-server.instance.ts`
  - Uses: SDK's `ToolRegistry`, `ResourceRegistry` patterns
  - Uses: Browser's `ComponentRegistry`, `RendererRegistry`
  - Features: initialize, connect transport, delegate to registries

- [ ] **5.2** Use SDK flow patterns (don't reimplement)

  - SDK provides request handling patterns
  - Browser adapts for EventEmitter-based transport
  - No `src/server/handlers/` directory needed

- [ ] **5.3** Implement BrowserNotificationAdapter

  - File: `src/server/browser-notification.adapter.ts`
  - Adapts: SDK's `NotificationService` patterns
  - Sends via: `EventTransportAdapter` or `PostMessageTransportAdapter`

- [ ] **5.4** Implement createBrowserMcpServer factory

  - File: `src/server/factory.ts`
  - Features: configuration, auto-registration
  - Injects: SDK registries + browser registries

- [ ] **5.5** Create barrel export
  - File: `src/server/index.ts`
  - Re-export SDK types: `ToolMetadata`, `ResourceMetadata`

### Acceptance Criteria

- Server uses SDK registry patterns (not reimplemented)
- Notification adapter bridges SDK to browser transport
- Clean shutdown with transport cleanup
- No duplicate handler implementations

---

## Phase 6: React Integration

### Goal

Implement React provider and hooks.

> **Browser-Specific**: No SDK equivalent. React integration is unique to browser-poc.

### Tasks

- [ ] **6.1** Implement FrontMcpBrowserProvider

  - File: `src/react/provider.tsx`
  - Features: context setup, memoization

- [ ] **6.2** Implement useStore hook

  - File: `src/react/hooks/use-store.ts`
  - Features: useSnapshot integration

- [ ] **6.3** Implement useTool hook

  - File: `src/react/hooks/use-tool.ts`
  - Features: loading state, error handling

- [ ] **6.4** Implement useResource hook

  - File: `src/react/hooks/use-resource.ts`
  - Features: auto-fetch, refetch interval

- [ ] **6.5** Implement useMcp hook

  - File: `src/react/hooks/use-mcp.ts`
  - Features: full context access

- [ ] **6.6** Implement useComponent hook

  - File: `src/react/hooks/use-component.ts`
  - Features: render components

- [ ] **6.7** Create barrel export
  - File: `src/react/index.ts`

### Acceptance Criteria

- All hooks work within provider
- Proper TypeScript types
- Error boundaries handled

---

## Phase 7: Examples

### Goal

Create working examples for different use cases.

### Tasks

- [ ] **7.1** Vanilla JavaScript example

  - Directory: `examples/vanilla/`
  - Demo: Basic store + tools

- [ ] **7.2** React example

  - Directory: `examples/react/`
  - Demo: Full React app with hooks

- [ ] **7.3** WebWorker example

  - Directory: `examples/worker/`
  - Demo: MCP server in worker

- [ ] **7.4** Component registration example
  - Directory: `examples/components/`
  - Demo: Custom components + renderer

### Acceptance Criteria

- All examples run successfully
- Clear documentation in each example
- No Node.js dependencies

---

## Phase 8: Testing

### Goal

Comprehensive test coverage.

### Tasks

- [ ] **8.1** Transport tests

  - EventTransport unit tests
  - PostMessageTransport unit tests
  - Integration tests

- [ ] **8.2** Store tests

  - Valtio store tests
  - Persistence tests
  - MCP integration tests

- [ ] **8.3** Registry tests

  - Component registry tests
  - Renderer registry tests
  - MCP resource/tool tests

- [ ] **8.4** Server tests

  - Request handler tests
  - Notification tests
  - Lifecycle tests

- [ ] **8.5** React tests
  - Hook tests (react-hooks-testing-library)
  - Provider tests
  - Integration tests

### Acceptance Criteria

- 90%+ code coverage
- All edge cases covered
- CI pipeline green

---

## Phase 9: Navigator Model Context

### Goal

Implement W3C-aligned `navigator.modelContext` polyfill for standard compatibility.

### Tasks

- [ ] **9.1** Implement navigator.modelContext polyfill

  - File: `src/polyfill/navigator-model-context.ts`
  - Auto-registration on import
  - Lazy server initialization

- [ ] **9.2** Implement registerTool API

  - Dynamic tool registration after connection
  - Schema validation
  - TypeScript types

- [ ] **9.3** Implement registerResource API

  - Dynamic resource registration
  - URI pattern validation
  - Subscription support

- [ ] **9.4** Implement registerPrompt API

  - Dynamic prompt registration
  - Argument schema validation

- [ ] **9.5** Document W3C alignment

  - File: `docs/NAVIGATOR-MODEL-CONTEXT.md`
  - API reference
  - Migration guide

- [ ] **9.6** Claude Desktop compatibility layer

  - Ensure polyfill works with Claude Desktop's MCP client
  - Test tool discovery and execution
  - Verify resource subscriptions work

- [ ] **9.7** Feature parity with WebMCP navigator.modelContext API
  - Match WebMCP's dynamic tool management
  - Support same event types
  - Ensure same schema formats

### Acceptance Criteria

- Polyfill works without modifying existing code
- Compatible with WebMCP-expecting AI clients
- Full TypeScript support
- Works seamlessly with Claude Desktop

---

## Phase 10: App Bridge / Host SDK

### Goal

Create SDK for host applications (Claude Desktop, chat UIs) to embed FrontMCP apps.

### Tasks

- [ ] **10.1** Create @frontmcp/browser/host package

  - File: `src/host/index.ts`
  - Package entry point
  - TypeScript declarations

- [ ] **10.2** Implement createAppHost factory

  - File: `src/host/app-host.ts`
  - Container management
  - Sandbox configuration
  - CSP injection

- [ ] **10.3** Implement IframeParentTransport

  - File: `src/transport/iframe-parent-transport.ts`
  - postMessage communication
  - Origin validation
  - Connection lifecycle

- [ ] **10.4** Implement IframeChildTransport

  - File: `src/transport/iframe-child-transport.ts`
  - Parent communication
  - Handshake protocol

- [ ] **10.5** Create UIResourceRenderer equivalent

  - File: `src/host/resource-renderer.tsx`
  - HTML rendering
  - Sandbox enforcement
  - Event forwarding

- [ ] **10.6** Document App Bridge

  - File: `docs/APP-BRIDGE.md`
  - Host integration guide
  - Security considerations

- [ ] **10.7** Test embedding in Claude Desktop iframe

  - Verify app loads correctly in Claude Desktop
  - Test tool calls from Claude to embedded app
  - Validate resource reads work correctly

- [ ] **10.8** Security audit for iframe sandboxing
  - Review sandbox attribute combinations
  - Test CSP header interactions
  - Validate origin restrictions

### Acceptance Criteria

- Host can embed FrontMCP apps securely
- Bi-directional communication working
- Sandbox isolation enforced
- Works in Claude Desktop iframe environment

---

## Phase 11: UI Resource Delivery

### Goal

Enable tools to return renderable HTML for AI clients.

### Tasks

- [ ] **11.1** Implement createUIResource helper

  - File: `src/ui/create-ui-resource.ts`
  - HTML wrapping
  - MIME type handling
  - URI generation

- [ ] **11.2** Add text/html;profile=mcp-app support

  - Resource type detection
  - Content security headers
  - Sanitization options

- [ ] **11.3** Implement \_meta.resourceUri linking

  - File: `src/ui/meta-linking.ts`
  - Tool-to-UI association
  - Instance tracking

- [ ] **11.4** Create renderToString utilities

  - SSR support for components
  - Hydration markers
  - Style extraction

- [ ] **11.5** Document UI Resources
  - File: `docs/UI-RESOURCES.md`
  - Pattern documentation
  - Examples

### Acceptance Criteria

- Tools can return renderable HTML
- AI clients can display returned UI
- Security maintained

---

## Phase 12: Chrome Extension Transport

### Goal

Enable communication with Chrome Extension-based AI clients.

### Tasks

- [ ] **12.1** Implement ExtensionServerTransport

  - File: `src/transport/extension-transport.ts`
  - chrome.runtime.Port communication
  - Connection management

- [ ] **12.2** Create extension bridge messaging

  - File: `src/transport/extension-bridge.ts`
  - Message routing
  - Tab identification

- [ ] **12.3** Implement TabServerTransport

  - File: `src/transport/tab-transport.ts`
  - Cross-navigation persistence
  - Session recovery

- [ ] **12.4** Document Claude Desktop/Code integration

  - File: `docs/CHROME-EXTENSION.md`
  - Setup guide
  - API reference

- [ ] **12.5** Document Chrome API wrapper patterns

  - Reference WebMCP's 62+ Chrome API wrappers as patterns
  - Implement high-value wrappers: tabs, history, bookmarks
  - Create standardized wrapper interface

- [ ] **12.6** Claude Desktop extension bridge
  - File: `docs/CLAUDE-DESKTOP-INTEGRATION.md`
  - Native messaging host setup
  - Browser extension configuration
  - Registration with Claude Desktop

### Acceptance Criteria

- Extension can communicate with page MCP server
- Connections persist across navigation
- Works with Claude Desktop
- Chrome API wrappers follow consistent pattern

---

## Phase 13: Component Instances & Events

### Goal

Track rendered component instances and handle events.

### Tasks

- [ ] **13.1** Implement ComponentInstanceRegistry

  - File: `src/registry/instance.registry.ts`
  - Instance lifecycle
  - State management

- [ ] **13.2** Add event bus for component events

  - File: `src/events/event-bus.ts`
  - Event types
  - Subscription management

- [ ] **13.3** Implement form state management

  - File: `src/forms/form-state.ts`
  - Validation state
  - Submission handling

- [ ] **13.4** Create instance MCP resources

  - `instance://{id}` - Get instance
  - `instances://list` - List all
  - `instances://component/{name}` - Filter by component

- [ ] **13.5** Create instance MCP tools

  - `instance-update` - Update state
  - `instance-destroy` - Remove
  - `instance-event` - Trigger event

- [ ] **13.6** Document Component Instances
  - File: `docs/COMPONENT-INSTANCES.md`

### Acceptance Criteria

- Instances tracked and queryable
- Events propagate to AI
- Form state accessible

---

## Phase 14: Human-in-the-Loop

### Goal

Implement confirmation workflows for sensitive actions.

### Tasks

- [ ] **14.1** Document HiTL philosophy

  - File: `docs/HUMAN-IN-THE-LOOP.md`
  - Security rationale
  - UX guidelines

- [ ] **14.2** Implement confirmation dialogs

  - File: `src/hitl/confirmation-dialog.ts`
  - Timeout handling
  - Response capture

- [ ] **14.3** Add withConfirmation wrapper

  - File: `src/hitl/with-confirmation.ts`
  - Tool integration
  - Bypass rules

- [ ] **14.4** Implement audit logging

  - File: `src/hitl/audit-log.ts`
  - Action recording
  - User decisions
  - Persistence

- [ ] **14.5** Create HiTL React components
  - ConfirmationProvider
  - useConfirmation hook

### Acceptance Criteria

- Sensitive actions require confirmation
- User decisions logged
- Timeout handling works

---

## Phase 15: Advanced UI

### Goal

Add layout components, theming, and accessibility.

### Tasks

- [ ] **15.1** Implement layout components

  - Stack, Grid, Container
  - Responsive props
  - Nested layouts

- [ ] **15.2** Create theming system

  - File: `src/theme/theme-provider.ts`
  - Design tokens
  - Dark/light mode

- [ ] **15.3** Add theme MCP resources

  - `theme://current` - Get theme
  - `theme://tokens` - Get tokens

- [ ] **15.4** Implement accessibility utilities

  - File: `src/a11y/index.ts`
  - Focus management
  - ARIA helpers
  - Announcements

- [ ] **15.5** Create Web Components wrapper

  - File: `src/web-components/frontmcp-element.ts`
  - Custom element
  - Shadow DOM

- [ ] **15.6** Document Advanced UI
  - `docs/THEMING.md`
  - `docs/ACCESSIBILITY.md`
  - `docs/WEB-COMPONENTS.md`

### Acceptance Criteria

- Layout components work
- Theming applies globally
- a11y requirements met
- Web Components available

---

## Phase 16: Schema Store

### Goal

Implement schema-driven stores where actions automatically become MCP tools.

### Tasks

- [ ] **16.1** Implement defineStore factory

  - File: `src/store/schema-store.ts`
  - Features: Zod schema parsing, default extraction, proxy creation

- [ ] **16.2** Implement action-to-tool generation

  - File: `src/store/schema-store-tools.ts`
  - Features: Auto-generate MCP tools from action definitions
  - Naming: `{storeName}:{actionName}`

- [ ] **16.3** Implement StoreActionContext

  - File: `src/store/action-context.ts`
  - Features: `ctx.state`, `ctx.call()`, `ctx.callTool()`, `ctx.getSnapshot()`

- [ ] **16.4** Implement store resource generation

  - File: `src/store/schema-store-resources.ts`
  - Resources: `store://{name}`, `store://{name}/{path}`

- [ ] **16.5** Add persistence integration

  - File: `src/store/schema-store-persistence.ts`
  - Features: IndexedDB/localStorage configuration

- [ ] **16.6** Create registerWith helper

  - File: `src/store/schema-store-registration.ts`
  - Features: Bulk tool/resource registration with BrowserMcpServer

- [ ] **16.7** Add TypeScript type inference

  - Full type inference for state, actions, and context
  - Generic constraints for action input/output

- [ ] **16.8** Document Schema Store
  - File: `docs/SCHEMA-STORE.md` ✓ (completed)
  - API reference, examples, patterns

### Acceptance Criteria

- Actions auto-register as MCP tools
- State mutations via `ctx.state` work
- `ctx.call()` can invoke other actions
- `ctx.callTool()` can invoke external tools
- Resources generated for store paths
- Full TypeScript type inference
- Documentation complete

---

## Phase 17: Telemetry

### Goal

Implement browser event capture with PII filtering before MCP exposure.

### Tasks

- [ ] **17.1** Implement createEventCollector factory

  - File: `src/telemetry/collector/event-collector.ts`
  - Features: Category-based capture, event buffer, sampling

- [ ] **17.2** Implement event capture modules

  - Files: `src/telemetry/capture/`
  - Modules: interaction-capture, network-capture, error-capture, log-capture

- [ ] **17.3** Implement PII filter chain

  - File: `src/telemetry/filters/pii-filter-chain.ts`
  - Features: Priority-ordered execution, pattern matching, custom filters

- [ ] **17.4** Implement built-in PII patterns

  - File: `src/telemetry/filters/built-in-patterns.ts`
  - Patterns: email, creditCard, ssn, phone, apiKey, bearerToken, jwt, ip

- [ ] **17.5** Implement createBuiltInPiiFilter factory

  - File: `src/telemetry/filters/built-in-filter.plugin.ts`
  - Features: Configurable patterns, allowlist/blocklist

- [ ] **17.6** Implement createPiiFilterPlugin factory

  - File: `src/telemetry/filters/pii-filter.plugin.ts`
  - Features: Custom patterns, filter function, priority

- [ ] **17.7** Implement MCP resources

  - File: `src/telemetry/mcp/event-resources.ts`
  - Resources: events://recent, events://errors, events://network, events://stats

- [ ] **17.8** Implement MCP notifications

  - File: `src/telemetry/mcp/event-notifications.ts`
  - Notification: notifications/events/captured with significance levels

- [ ] **17.9** Implement React integration

  - Files: `src/telemetry/react/`
  - Hooks: useEventCollector, useEvents, useTelemetryStats
  - Component: TelemetryProvider

- [ ] **17.10** Document Telemetry
  - File: `docs/TELEMETRY.md` ✓ (completed)
  - API reference, PII patterns, examples

### Acceptance Criteria

- Events captured by category (interaction, network, errors, logs)
- PII filtered BEFORE any MCP notification
- Built-in patterns redact common sensitive data
- Custom filter plugins supported
- Events exposed via MCP resources
- Real-time notifications with significance levels
- React hooks for telemetry access
- Documentation complete

---

## Dependencies Between Phases

```
Phase 1 (Foundation)
    │
    ├──▶ Phase 2 (Transport)
    │         │
    │         └──▶ Phase 5 (Server) ──▶ Phase 7 (Examples)
    │                   │
    ├──▶ Phase 3 (Store) ─┘
    │         │
    │         └──▶ Phase 6 (React) ──▶ Phase 7 (Examples)
    │
    └──▶ Phase 4 (Registry) ──▶ Phase 5 (Server)

Phase 8 (Testing) runs in parallel with all phases

Extended Phases (Post-Release):

Phase 5 (Server)
    │
    ├──▶ Phase 9 (Navigator Model Context)
    │         │
    │         └──▶ Phase 10 (App Bridge)
    │                   │
    │                   └──▶ Phase 11 (UI Resources)
    │
    ├──▶ Phase 12 (Extension Transport)
    │
    └──▶ Phase 13 (Instances) ──▶ Phase 14 (HiTL) ──▶ Phase 15 (Advanced UI)

Phase 3 (Store)
    │
    └──▶ Phase 16 (Schema Store)

Phase 5 (Server) + Phase 6 (React)
    │
    └──▶ Phase 17 (Telemetry)
```

---

## Milestones

| Milestone          | Phases | Deliverable                                 | Documentation                                              |
| ------------------ | ------ | ------------------------------------------- | ---------------------------------------------------------- |
| M1: Core           | 1-2    | SDK integration, working transport layer    | SDK-INTEGRATION.md, TRANSPORT.md                           |
| M2: Data           | 3-4    | Store + Registry working                    | STORE.md, REGISTRY.md                                      |
| M3: Server         | 5      | Full MCP server                             | API.md, ARCHITECTURE.md                                    |
| M4: React          | 6      | React integration complete                  | REACT.md                                                   |
| M5: Release        | 7-8    | Production ready                            | TESTING.md, DEPLOYMENT.md                                  |
| M6: Standards      | 9-11   | W3C compatibility, App Bridge, UI Resources | NAVIGATOR-MODEL-CONTEXT.md, APP-BRIDGE.md, UI-RESOURCES.md |
| M7: Extensions     | 12-13  | Extension transport, Component instances    | CLAUDE-DESKTOP-INTEGRATION.md                              |
| M8: Enterprise     | 14-15  | HiTL workflows, Advanced UI                 | SECURITY.md                                                |
| M9: Developer DX   | 16     | Schema-driven stores                        | SCHEMA-STORE.md                                            |
| M10: Observability | 17     | Browser telemetry with PII filtering        | TELEMETRY.md                                               |

### Documentation Status

| Document                      | Status   | Lines  |
| ----------------------------- | -------- | ------ |
| SDK-INTEGRATION.md            | Complete | ~400   |
| API.md                        | Complete | ~810   |
| ARCHITECTURE.md               | Updated  | ~809   |
| TRANSPORT.md                  | Complete | ~1,485 |
| STORE.md                      | Complete | ~925   |
| REGISTRY.md                   | Complete | ~585   |
| REACT.md                      | Complete | ~1,400 |
| SECURITY.md                   | Complete | ~1,500 |
| APP-BRIDGE.md                 | Complete | ~800   |
| UI-RESOURCES.md               | Complete | ~690   |
| NAVIGATOR-MODEL-CONTEXT.md    | Complete | ~576   |
| TESTING.md                    | Complete | ~500   |
| TROUBLESHOOTING.md            | Complete | ~670   |
| DEPLOYMENT.md                 | Complete | ~400   |
| DEBUGGING.md                  | Complete | ~350   |
| USE-CASES.md                  | Complete | ~600   |
| CLAUDE-DESKTOP-INTEGRATION.md | Complete | ~460   |
| GAP-ANALYSIS.md               | Updated  | ~720   |
| SCHEMA-STORE.md               | Complete | ~600   |
| TELEMETRY.md                  | Complete | ~800   |
| FILE-STRUCTURE.md             | Updated  | ~600   |

---

## Risk Mitigation

| Risk                          | Mitigation                            |
| ----------------------------- | ------------------------------------- |
| MCP SDK browser compatibility | Test early, fork if needed            |
| Valtio edge cases             | Comprehensive testing                 |
| WebWorker serialization       | Use structured clone compatible types |
| Bundle size                   | Tree-shaking, separate React entry    |

---

## Definition of Done

For each phase:

- [ ] All tasks completed
- [ ] TypeScript compiles without errors
- [ ] No browser console errors
- [ ] Tests pass
- [ ] Documentation updated
- [ ] Code reviewed
