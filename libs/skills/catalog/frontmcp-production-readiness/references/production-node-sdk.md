---
name: production-node-sdk
description: Checklist for publishing FrontMCP as an embedded npm package used as a direct client SDK
---

# Production Readiness: Node.js Direct Client (SDK)

Checklist for publishing FrontMCP as an npm package used as a direct client SDK — embedded in someone else's Node.js application, not running as a standalone server.

> Run the `common-checklist` first, then use this checklist for SDK-specific items.

## API Surface

- [ ] `create()` function is exported and documented
- [ ] `connect()` returns a typed client with `listTools`, `callTool`, etc.
- [ ] `dispose()` properly cleans up all resources (connections, timers, listeners)
- [ ] TypeScript declarations (`.d.ts`) are included in the published package
- [ ] `package.json` has correct `main`, `module`, `types` fields

## Initialization & Lifecycle

- [ ] `create()` does not bind a port (SDK mode, not server mode)
- [ ] `serve: false` is set in the FrontMcp config (or uses direct API)
- [ ] Initialization is async and returns a promise
- [ ] No side effects at import time (no top-level `await`, no global state)
- [ ] Multiple instances can coexist without conflicts

## Memory & Cleanup

- [ ] `dispose()` is called in the host app's shutdown handler
- [ ] No event listener leaks (all listeners are removed on dispose)
- [ ] No dangling timers or intervals after dispose
- [ ] Provider lifecycle `dispose()` is implemented for all resources
- [ ] Memory usage is bounded (no unbounded caches or queues)

## npm Publishing

- [ ] Package name is available on npm
- [ ] `package.json` has `name`, `version`, `description`, `keywords`, `license`
- [ ] `files` field includes only: `dist/`, `README.md`, `LICENSE`
- [ ] `peerDependencies` are declared for shared packages (e.g., `zod`)
- [ ] `engines.node` matches required Node.js version
- [ ] `README.md` has usage examples with `create()` and `connect()` API

## Testing

- [ ] Unit tests cover tool execution via direct client
- [ ] Integration tests verify `create()` → `connect()` → `callTool()` → `dispose()`
- [ ] No tests depend on a running HTTP server
- [ ] Tests clean up (dispose) after each test case

## Example Usage in README

```typescript
import { create } from 'my-mcp-package';

const server = await create();
const client = await server.connect();

const tools = await client.listTools();
const result = await client.callTool('my_tool', { input: 'value' });

await client.close();
await server.dispose();
```
