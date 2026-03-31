---
name: cli-binary-build
reference: build-for-cli
level: basic
description: 'Build a FrontMCP server as a standalone binary using Node.js Single Executable Applications (SEA).'
tags: [deployment, cli, local, node, binary]
features:
  - 'Building a FrontMCP server as a self-contained binary with `--target cli`'
  - 'Using `socketPath` for local communication instead of a TCP port'
  - 'The `--js` flag to produce a bundled JS file without the native binary wrapper'
---

# CLI Binary Build

Build a FrontMCP server as a standalone binary using Node.js Single Executable Applications (SEA).

## Code

```typescript
// src/main.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'greet',
  description: 'Greet a user by name',
  inputSchema: { name: z.string() },
})
class GreetTool extends ToolContext<{ name: string }> {
  async execute(input: { name: string }) {
    return { content: [{ type: 'text' as const, text: `Hello, ${input.name}!` }] };
  }
}

@App({ name: 'GreeterApp', tools: [GreetTool] })
class GreeterApp {}

@FrontMcp({
  info: { name: 'greeter-cli', version: '1.0.0' },
  apps: [GreeterApp],
  http: { socketPath: '/tmp/greeter.sock' },
})
class GreeterCLI {}
```

```bash
# Build the SEA binary (requires Node.js 24+)
frontmcp build --target cli

# Test the binary
./dist/greeter-cli --help

# Or build a JS bundle only (no SEA)
frontmcp build --target cli --js
node dist/greeter-cli.cjs.js
```

## What This Demonstrates

- Building a FrontMCP server as a self-contained binary with `--target cli`
- Using `socketPath` for local communication instead of a TCP port
- The `--js` flag to produce a bundled JS file without the native binary wrapper

## Related

- See `build-for-cli` for SEA requirements, process management, and system service installation
