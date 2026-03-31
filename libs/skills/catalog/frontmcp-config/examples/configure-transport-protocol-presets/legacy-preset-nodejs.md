---
name: legacy-preset-nodejs
reference: configure-transport-protocol-presets
level: basic
description: 'Use the default legacy preset for maximum compatibility with all MCP clients.'
tags: [config, anthropic, session, transport, node, protocol]
features:
  - "The `'legacy'` preset is the default and can be omitted"
  - 'Enables SSE, Streamable HTTP, and Legacy SSE for maximum client compatibility'
  - '`strictSession: true` requires `mcp-session-id` header for streamable HTTP'
  - 'Best for single-instance Node.js deployments (Claude Desktop, etc.)'
---

# Legacy Preset for Node.js

Use the default legacy preset for maximum compatibility with all MCP clients.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'hello',
  description: 'Say hello',
  inputSchema: { name: z.string() },
  outputSchema: { greeting: z.string() },
})
class HelloTool extends ToolContext {
  async execute(input: { name: string }) {
    return { greeting: `Hello, ${input.name}!` };
  }
}

@App({
  name: 'my-app',
  tools: [HelloTool],
})
class MyApp {}

@FrontMcp({
  info: { name: 'legacy-server', version: '1.0.0' },
  apps: [MyApp],
  transport: {
    protocol: 'legacy', // default -- can be omitted
  },
})
class Server {}
// Enables: SSE + Streamable HTTP + Legacy SSE
// Flags: { sse: true, streamable: true, json: false, stateless: false, legacy: true, strictSession: true }
```

## What This Demonstrates

- The `'legacy'` preset is the default and can be omitted
- Enables SSE, Streamable HTTP, and Legacy SSE for maximum client compatibility
- `strictSession: true` requires `mcp-session-id` header for streamable HTTP
- Best for single-instance Node.js deployments (Claude Desktop, etc.)

## Related

- See `configure-transport-protocol-presets` for all preset definitions
- See `configure-transport` for full transport configuration
