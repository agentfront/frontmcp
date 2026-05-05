---
name: dev-workflow-commands
reference: project-structure-standalone
level: basic
description: 'Run the standard development workflow for a standalone FrontMCP project: dev server, build, and tests.'
tags: [setup, e2e, structure, standalone, dev, workflow]
features:
  - '`frontmcp dev` for hot-reloading development server'
  - '`frontmcp build --target <target>` for production builds targeting different runtimes'
  - 'Test files use `.spec.ts` extension (not `.test.ts`) per FrontMCP convention'
  - 'E2E tests live in the `e2e/` directory with `*.e2e.spec.ts` naming'
---

# Development Workflow Commands

Run the standard development workflow for a standalone FrontMCP project: dev server, build, and tests.

## Code

```bash
# Start the development server with hot reload
frontmcp dev
```

```bash
# Build for different deployment targets
frontmcp build --target node
frontmcp build --target vercel
frontmcp build --target lambda
frontmcp build --target cloudflare
```

```bash
# Run unit and E2E tests (auto-discovers *.spec.ts and e2e/*.e2e.spec.ts)
# Do NOT create a standalone jest.e2e.config.ts -- frontmcp test generates one automatically
frontmcp test
```

```typescript
// To run with HTTP transport, set http: { port } in the @FrontMcp metadata.
// Setting PORT=3000 alone does NOT switch the server from stdio to HTTP.
import 'reflect-metadata';

import { FrontMcp } from '@frontmcp/sdk';

import { CalcApp } from './calc.app';

@FrontMcp({
  info: { name: 'demo', version: '0.1.0' },
  apps: [CalcApp],
  http: { port: 3000 }, // <-- enables HTTP transport on port 3000
})
export default class Server {}
```

```bash
# With http: { port } configured in metadata, start the dev server
frontmcp dev
```

```bash
# Test the running HTTP server with an MCP initialize request
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}'
```

## What This Demonstrates

- `frontmcp dev` for hot-reloading development server
- `frontmcp build --target <target>` for production builds targeting different runtimes
- Test files use `.spec.ts` extension (not `.test.ts`) per FrontMCP convention
- E2E tests live in the `e2e/` directory with `*.e2e.spec.ts` naming

## Related

- See `project-structure-standalone` for the full project layout and file naming conventions
