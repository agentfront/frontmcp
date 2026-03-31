---
name: unix-socket-local
reference: configure-http
level: intermediate
description: 'Bind the server to a unix socket instead of a TCP port for local-only communication.'
tags: [config, unix-socket, cli, local, http, unix]
features:
  - 'Using `socketPath` to bind to a unix socket instead of a TCP port'
  - 'When `socketPath` is set, the `port` field is ignored'
  - 'Disabling CORS with `cors: false` since unix sockets are local-only'
  - 'Suitable for CLI tools, daemons, and process manager integrations'
---

# Unix Socket for Local Access

Bind the server to a unix socket instead of a TCP port for local-only communication.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'system_status',
  description: 'Get system status',
  inputSchema: {},
  outputSchema: { uptime: z.number(), healthy: z.boolean() },
})
class SystemStatusTool extends ToolContext {
  async execute() {
    return { uptime: process.uptime(), healthy: true };
  }
}

@App({
  name: 'daemon',
  tools: [SystemStatusTool],
})
class DaemonApp {}

@FrontMcp({
  info: { name: 'daemon-server', version: '1.0.0' },
  apps: [DaemonApp],
  http: {
    socketPath: '/tmp/my-mcp-server.sock',
    cors: false, // no CORS needed for local socket
  },
})
class Server {}
```

## What This Demonstrates

- Using `socketPath` to bind to a unix socket instead of a TCP port
- When `socketPath` is set, the `port` field is ignored
- Disabling CORS with `cors: false` since unix sockets are local-only
- Suitable for CLI tools, daemons, and process manager integrations

## Related

- See `configure-http` for the full HTTP configuration reference
- See `configure-transport` for transport protocol options
