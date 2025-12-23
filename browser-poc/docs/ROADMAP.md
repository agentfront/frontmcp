# FrontMCP Browser Roadmap

This document outlines the implementation phases for FrontMCP Browser support.

## Table of Contents

- [Phase 0: SDK Prerequisites](#phase-0-sdk-prerequisites)
- [Phase 1: Core Browser Runtime](#phase-1-core-browser-runtime)
- [Phase 2: React Integration](#phase-2-react-integration)
- [Phase 3: Advanced Features](#phase-3-advanced-features)
- [Phase 4: Production Readiness](#phase-4-production-readiness)

---

## Phase 0: SDK Prerequisites

**Status: COMPLETED**

Build-time platform abstraction enables browser support without splitting the SDK.

### Completed

- [x] Create `libs/sdk/src/platform/browser-crypto.ts` - Web Crypto shim
- [x] Add esbuild to `@frontmcp/cli` dependencies
- [x] Create `browser` adapter in CLI (`libs/cli/src/commands/build/adapters/browser.ts`)
- [x] Implement module replacement for `crypto` imports
- [x] Add build-time constant: `process.env.FRONTMCP_BROWSER`
- [x] Fix circular dependency in `front-mcp.decorator.ts`

### Browser Crypto Shim Features

| Function                    | Implementation                    |
| --------------------------- | --------------------------------- |
| `randomUUID()`              | `crypto.randomUUID()`             |
| `randomBytes(n)`            | `crypto.getRandomValues()`        |
| `createHash('sha256')`      | `crypto.subtle.digest('SHA-256')` |
| `createHmac('sha256', key)` | `crypto.subtle.sign('HMAC')`      |
| AES-GCM encryption          | `crypto.subtle.encrypt/decrypt`   |
| HKDF key derivation         | `crypto.subtle.deriveBits`        |

---

## Phase 1: Core Browser Runtime

**Status: NOT STARTED**

Core browser runtime components.

### Tasks

- [ ] `BrowserMcpServer` - Main server class
- [ ] `EventTransport` - In-process event-based transport
- [ ] `PostMessageTransport` - WebWorker/iframe transport
- [ ] `ValtioStore` - Reactive state management
- [ ] `ComponentRegistry` - UI component discovery
- [ ] MCP JSON-RPC message handling
- [ ] Connection lifecycle management

### Dependencies

- Phase 0 (completed)
- Valtio library for reactive state

---

## Phase 2: React Integration

**Status: NOT STARTED**

React hooks and provider for FrontMCP.

### Tasks

- [ ] `FrontMcpBrowserProvider` - React context provider
- [ ] `useStore()` - Reactive state access
- [ ] `useTool()` - Tool execution hook
- [ ] `useResource()` - Resource reading hook
- [ ] `useMcp()` - Full context access
- [ ] SSR hydration support

### Dependencies

- Phase 1 (core runtime)
- React 18+

---

## Phase 3: Advanced Features

**Status: NOT STARTED**

Advanced features for production use.

### Tasks

- [ ] `IframeParentTransport` / `IframeChildTransport` - App Bridge
- [ ] `navigator.modelContext` polyfill - W3C compatibility
- [ ] IndexedDB persistence layer
- [ ] Multi-tab synchronization via BroadcastChannel
- [ ] WebWorker execution context
- [ ] Resource subscription and notifications

### Dependencies

- Phase 2 (React integration)

---

## Phase 4: Production Readiness

**Status: NOT STARTED**

Production hardening and optimization.

### Tasks

- [ ] Comprehensive test suite (95%+ coverage)
- [ ] Performance benchmarks
- [ ] Bundle size optimization
- [ ] Security audit
- [ ] Documentation completion
- [ ] Example applications

### Dependencies

- Phase 3 (advanced features)

---

## Build Commands

```bash
# Build for browser
frontmcp build --adapter browser --outDir dist/browser

# Build for Node.js
frontmcp build --adapter node --outDir dist

# Build for Vercel
frontmcp build --adapter vercel --outDir api

# Build for Cloudflare Workers
frontmcp build --adapter cloudflare --outDir worker
```

---

## Success Metrics

- [ ] Browser bundle size < 50KB gzipped
- [ ] First contentful paint < 100ms
- [ ] MCP message latency < 10ms
- [ ] 95%+ test coverage
- [ ] Zero security vulnerabilities
- [ ] Full MCP protocol compliance
