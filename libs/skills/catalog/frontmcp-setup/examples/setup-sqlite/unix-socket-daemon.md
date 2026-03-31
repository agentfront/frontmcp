---
name: unix-socket-daemon
reference: setup-sqlite
level: advanced
description: 'Configure a FrontMCP daemon that listens on a unix socket and uses SQLite for persistent storage.'
tags: [setup, unix-socket, sqlite, session, transport, database]
features:
  - '`http.unixSocket` for unix socket transport instead of TCP port'
  - "`transport: { protocol: 'modern' }` for Streamable HTTP with strict sessions"
  - '`ttlCleanupIntervalMs: 15000` for more aggressive cleanup on high-throughput daemons'
  - 'Absolute path for the database file in system-level storage (`/var/lib/`)'
---

# Unix Socket Daemon with SQLite

Configure a FrontMCP daemon that listens on a unix socket and uses SQLite for persistent storage.

## Code

```typescript
// src/main.ts
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'frontmcp-daemon', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  sqlite: {
    path: '/var/lib/frontmcp/daemon.sqlite',
    walMode: true,
    ttlCleanupIntervalMs: 15000,
  },
  transport: {
    protocol: 'modern',
  },
  http: {
    unixSocket: '/tmp/frontmcp.sock',
  },
})
export default class Server {}
```

```env
# .env
SQLITE_DB_PATH=/var/lib/frontmcp/daemon.sqlite
```

```bash
# Start the daemon
frontmcp dev

# Test via unix socket
curl --unix-socket /tmp/frontmcp.sock \
  -X POST http://localhost/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}'
```

## What This Demonstrates

- `http.unixSocket` for unix socket transport instead of TCP port
- `transport: { protocol: 'modern' }` for Streamable HTTP with strict sessions
- `ttlCleanupIntervalMs: 15000` for more aggressive cleanup on high-throughput daemons
- Absolute path for the database file in system-level storage (`/var/lib/`)

## Related

- See `setup-sqlite` for basic setup, encryption, and WAL mode configuration
