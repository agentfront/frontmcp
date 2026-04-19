---
name: unix-socket-daemon
reference: build-for-cli
level: intermediate
description: 'Run a FrontMCP server as a local daemon accessible via Unix socket for IDE extensions and local MCP clients.'
tags: [deployment, unix-socket, cli, transport, local, unix]
features:
  - 'Configuring a FrontMCP server for Unix socket transport instead of TCP'
  - 'Running the server as a background daemon with process management (`frontmcp start/stop/status`)'
  - 'Installing the daemon as a system service for automatic startup on reboot'
---

# Unix Socket Daemon Mode

Run a FrontMCP server as a local daemon accessible via Unix socket for IDE extensions and local MCP clients.

## Code

```typescript
// src/main.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'lookup',
  description: 'Look up a term in the local database',
  inputSchema: { term: z.string() },
})
class LookupTool extends ToolContext<{ term: string }> {
  async execute(input: { term: string }) {
    return { content: [{ type: 'text' as const, text: `Result for: ${input.term}` }] };
  }
}

@App({ name: 'DaemonApp', tools: [LookupTool] })
class DaemonApp {}

@FrontMcp({
  info: { name: 'my-daemon', version: '1.0.0' },
  apps: [DaemonApp],
  http: { socketPath: '/tmp/my-tool.sock' },
  sqlite: { path: '~/.my-tool/data.db' },
})
class MyDaemonServer {}
```

```bash
# Start daemon in foreground
frontmcp socket ./src/main.ts -s ~/.frontmcp/sockets/my-app.sock

# Start daemon in background with a local database
frontmcp socket ./src/main.ts -b --db ~/.my-tool/data.db

# Manage the daemon process
frontmcp start my-daemon -e ./src/main.ts --max-restarts 5
frontmcp status my-daemon
frontmcp logs my-daemon -F
frontmcp stop my-daemon
```

```bash
# Install as a system service for automatic startup
# Linux: creates a systemd unit
# macOS: creates a launchd plist
frontmcp service install my-daemon
```

## What This Demonstrates

- Configuring a FrontMCP server for Unix socket transport instead of TCP
- Running the server as a background daemon with process management (`frontmcp start/stop/status`)
- Installing the daemon as a system service for automatic startup on reboot

## Related

- See `build-for-cli` for the full process management and system service reference
