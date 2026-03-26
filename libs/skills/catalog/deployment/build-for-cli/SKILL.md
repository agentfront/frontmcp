---
name: build-for-cli
description: Build a distributable CLI binary (SEA) or JS bundle from an MCP server. Use when creating standalone executables, CLI tools, or self-contained binaries.
tags: [deployment, cli, binary, sea, executable]
parameters:
  - name: output-format
    description: Output as native binary (default) or JS bundle (--js)
    type: string
    default: binary
examples:
  - scenario: Build a standalone CLI binary for distribution
    expected-outcome: Single executable file that runs without Node.js installed
  - scenario: Build a JS bundle for Node.js execution
    expected-outcome: Bundled JS file runnable with node
priority: 7
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/production-build
---

# Building a CLI Binary

Build your FrontMCP server as a distributable CLI binary using Node.js Single Executable Applications (SEA) or as a bundled JS file.

## When to Use

Use `--target cli` when you want to distribute your MCP server as:

- A standalone executable that end users run without installing Node.js
- A CLI tool installable via package managers
- A self-contained binary for deployment without dependencies

## Build Commands

### Native Binary (SEA)

```bash
frontmcp build --target cli
```

Produces a Node.js Single Executable Application — a single binary embedding your server code and the Node.js runtime.

### JS Bundle Only

```bash
frontmcp build --target cli --js
```

Produces a bundled JS file without the native binary wrapper. Run with `node dist/server.js`.

### Options

```bash
frontmcp build --target cli -o ./build        # Custom output directory
frontmcp build --target cli -e ./src/main.ts   # Custom entry file
frontmcp build --target cli --js               # JS bundle only (no SEA)
```

## Requirements

- **Node.js 22+** required for SEA support
- The entry file must export or instantiate a `@FrontMcp` decorated class
- SEA binaries are platform-specific (build on macOS for macOS, Linux for Linux)

## CLI Target vs Node Target

| Aspect   | `--target cli`                     | `--target node`                |
| -------- | ---------------------------------- | ------------------------------ |
| Output   | Single binary or JS bundle         | JS files for server deployment |
| Runtime  | Embedded Node.js (SEA) or external | Requires Node.js installed     |
| Use case | Distribution to end users          | Server deployment (Docker, VM) |
| Includes | Bundled dependencies               | External node_modules          |

## Server Configuration for CLI Mode

When building for CLI distribution, configure your server for local/stdin transport:

```typescript
@FrontMcp({
  info: { name: 'my-cli-tool', version: '1.0.0' },
  apps: [MyApp],
  http: { socketPath: '/tmp/my-tool.sock' }, // Unix socket instead of TCP
  sqlite: { path: '~/.my-tool/data.db' }, // Local storage
})
class MyCLIServer {}
```

## Verification

```bash
# Build
frontmcp build --target cli

# Test the binary
./dist/my-server --help

# Or test JS bundle
node dist/my-server.cjs.js
```
