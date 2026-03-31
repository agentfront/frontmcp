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
# Run unit tests (test files use .spec.ts extension)
jest
```

```bash
# Run E2E tests from the e2e/ directory
jest --config e2e/jest.config.ts
```

```bash
# Start the dev server with HTTP transport on a specific port
PORT=3000 frontmcp dev
```

```bash
# Test the running server with an MCP initialize request
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
