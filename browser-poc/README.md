# FrontMCP Browser POC

Proof-of-concept for running `@frontmcp/sdk` entirely in browser environments (WebWorker or main thread).

## Overview

This POC enables AI agents to interact with web applications via the MCP protocol, running entirely client-side without Node.js dependencies.

### Key Features

- **Browser-native MCP server** - No Node.js, no HTTP server
- **Event-based transports** - EventEmitter and postMessage APIs
- **Valtio reactive store** - Framework-agnostic state management
- **Components as Resources** - UI components discoverable by AI
- **Renderers as Tools** - Developer-defined rendering capabilities
- **React integration** - Optional hooks and provider

## Documentation Index

### Architecture & Design

| Document                                  | Description                                                 |
| ----------------------------------------- | ----------------------------------------------------------- |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | High-level system design, data flow, and MCP protocol scope |
| [API.md](./docs/API.md)                   | Complete API reference                                      |
| [SECURITY.md](./docs/SECURITY.md)         | Security guide (origin validation, rate limiting, CSP)      |
| [LIMITATIONS.md](./docs/LIMITATIONS.md)   | Known limitations and workarounds                           |
| [GAP-ANALYSIS.md](./docs/GAP-ANALYSIS.md) | Competitor analysis and feature roadmap                     |

### Core Modules

| Document                            | Description                                                   |
| ----------------------------------- | ------------------------------------------------------------- |
| [TRANSPORT.md](./docs/TRANSPORT.md) | Transport layer (EventEmitter, postMessage, BroadcastChannel) |
| [STORE.md](./docs/STORE.md)         | Valtio store with MCP integration and persistence             |
| [REGISTRY.md](./docs/REGISTRY.md)   | Component registry system                                     |
| [REACT.md](./docs/REACT.md)         | React provider, hooks, and error boundaries                   |

### SDK Changes (External Dependencies)

| Document                                                        | Description                                    |
| --------------------------------------------------------------- | ---------------------------------------------- |
| [NODE-DEPENDENCIES.md](./docs/sdk-changes/NODE-DEPENDENCIES.md) | Analysis of Node.js dependencies in `libs/sdk` |
| [REQUIRED-CHANGES.md](./docs/sdk-changes/REQUIRED-CHANGES.md)   | Required modifications to `libs/sdk`           |

### Implementation

| Document                                                     | Description                      |
| ------------------------------------------------------------ | -------------------------------- |
| [ROADMAP.md](./docs/implementation/ROADMAP.md)               | Step-by-step implementation plan |
| [FILE-STRUCTURE.md](./docs/implementation/FILE-STRUCTURE.md) | Target file structure            |

## Quick Start (Target API)

### Vanilla JavaScript

```typescript
import { createBrowserMcpServer, EventTransport } from '@frontmcp/browser';

const server = await createBrowserMcpServer({
  info: { name: 'MyApp', version: '1.0.0' },
});

// Store mutations trigger MCP notifications
server.store.state.count++;
```

### React

```typescript
import { FrontMcpBrowserProvider, useStore, useTool } from '@frontmcp/browser/react';

function App() {
  return (
    <FrontMcpBrowserProvider server={server}>
      <MyComponent />
    </FrontMcpBrowserProvider>
  );
}
```

### WebWorker

```typescript
// worker.ts
import { createBrowserMcpServer, PostMessageTransport } from '@frontmcp/browser';
const server = await createBrowserMcpServer({
  transport: new PostMessageTransport(self),
});

// main.ts
const worker = new Worker('./worker.ts', { type: 'module' });
const client = new McpBrowserClient(worker);
```

## Goals

1. **Zero Node.js dependencies** - Pure browser APIs only
2. **Framework agnostic** - Core works without React/Vue/etc
3. **MCP protocol compliant** - Full JSON-RPC over custom transports
4. **Developer ergonomics** - Simple registration of components/renderers
5. **AI-friendly** - Components and state discoverable via MCP resources

## Non-Goals (Out of Scope)

- HTTP/SSE transport (use main SDK for server-side)
- OAuth/external authentication flows
- Redis/database persistence
- Server-side rendering
