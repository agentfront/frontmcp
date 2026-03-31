---
name: daemon-socket-config
reference: production-cli-daemon
level: basic
description: 'Shows how to configure a FrontMCP server as a long-running local daemon with Unix socket transport, process management, and SQLite storage.'
tags: [production, unix-socket, sqlite, cli, transport, performance]
features:
  - 'Configuring Unix socket transport for local-only communication'
  - 'Using SQLite with WAL mode for concurrent read/write performance'
  - 'Storing data in user-specific config directory (`~/.config/`)'
  - 'Process management with `frontmcp start/stop/restart/status/logs`'
  - 'System service registration for auto-start on boot'
---

# Daemon Process with Unix Socket Transport

Shows how to configure a FrontMCP server as a long-running local daemon with Unix socket transport, process management, and SQLite storage.

## Code

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'my-daemon', version: '1.0.0' },
  apps: [MyApp],

  // Unix socket transport — no network exposure
  http: {
    socketPath: '/tmp/my-daemon.sock',
  },

  // SQLite for local persistence (sessions, cache)
  sqlite: {
    path: `${process.env.HOME}/.config/my-daemon/data.db`,
    wal: true, // WAL mode for concurrent reads
  },
})
export default class MyDaemonServer {}
```

```bash
# Process management commands

# Start the daemon
frontmcp start my-daemon --entry ./src/main.ts

# Check status
frontmcp status
# Output: my-daemon  running  pid:12345  socket:/tmp/my-daemon.sock

# View logs
frontmcp logs my-daemon --follow

# Restart without orphaned processes
frontmcp restart my-daemon

# Stop cleanly
frontmcp stop my-daemon
```

```bash
# Register as a system service (auto-start on boot)
frontmcp service install my-daemon

# Verify system health
frontmcp doctor
```

## What This Demonstrates

- Configuring Unix socket transport for local-only communication
- Using SQLite with WAL mode for concurrent read/write performance
- Storing data in user-specific config directory (`~/.config/`)
- Process management with `frontmcp start/stop/restart/status/logs`
- System service registration for auto-start on boot

## Related

- See `production-cli-daemon` for the full daemon process management checklist
