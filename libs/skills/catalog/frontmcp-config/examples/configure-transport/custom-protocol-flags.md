---
name: custom-protocol-flags
reference: configure-transport
level: advanced
description: 'Override individual protocol flags instead of using a preset for fine-grained control.'
tags: [config, redis, session, transport, custom, protocol]
features:
  - 'Passing an object to `protocol` instead of a preset string for fine-grained control'
  - 'Enabling SSE, streamable HTTP, and JSON-only modes simultaneously'
  - 'Setting `strictSession: true` to require `mcp-session-id` header on streamable HTTP'
  - "Using `distributedMode: 'auto'` to auto-detect based on whether Redis is configured"
  - 'Disabling `legacy` SSE while keeping modern SSE support'
---

# Custom Protocol Flags

Override individual protocol flags instead of using a preset for fine-grained control.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'stream_logs',
  description: 'Stream application logs',
  inputSchema: { service: z.string(), lines: z.number().optional() },
  outputSchema: { logs: z.array(z.string()) },
})
class StreamLogsTool extends ToolContext {
  async execute(input: { service: string; lines?: number }) {
    return { logs: ['[INFO] Service started', '[INFO] Healthy'] };
  }
}

@App({
  name: 'devtools',
  tools: [StreamLogsTool],
})
class DevtoolsApp {}

@FrontMcp({
  info: { name: 'custom-protocol-server', version: '1.0.0' },
  apps: [DevtoolsApp],
  transport: {
    sessionMode: 'stateful',
    protocol: {
      sse: true, // SSE endpoint enabled
      streamable: true, // Streamable HTTP POST enabled
      json: true, // JSON-only responses also available
      stateless: false, // Sessions required
      legacy: false, // No legacy SSE
      strictSession: true, // Require mcp-session-id header
    },
    distributedMode: 'auto', // auto-detect based on Redis config
  },
})
class Server {}
```

## What This Demonstrates

- Passing an object to `protocol` instead of a preset string for fine-grained control
- Enabling SSE, streamable HTTP, and JSON-only modes simultaneously
- Setting `strictSession: true` to require `mcp-session-id` header on streamable HTTP
- Using `distributedMode: 'auto'` to auto-detect based on whether Redis is configured
- Disabling `legacy` SSE while keeping modern SSE support

## Related

- See `configure-transport` for the full transport configuration reference
- See `configure-transport-protocol-presets` for the built-in preset definitions
