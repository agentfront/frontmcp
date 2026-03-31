---
name: graceful-shutdown-cleanup
reference: production-cli-daemon
level: intermediate
description: 'Shows how to implement graceful shutdown for a daemon process, including completing in-flight requests, closing database connections, removing the socket file, and cleaning up the PID file.'
tags: [production, unix-socket, cli, database, daemon, graceful]
features:
  - 'SIGTERM handler that completes in-flight requests before exiting'
  - 'Removing the Unix socket file to prevent stale `.sock` files on restart'
  - 'Cleaning up the PID file on shutdown'
  - 'Using `@frontmcp/utils` (`unlink`, `fileExists`, `ensureDir`) for file operations'
  - 'Implementing `onDestroy()` to close database connections'
---

# Daemon Graceful Shutdown with Socket Cleanup

Shows how to implement graceful shutdown for a daemon process, including completing in-flight requests, closing database connections, removing the socket file, and cleaning up the PID file.

## Code

```typescript
// src/lifecycle/daemon-shutdown.ts
import { unlink, fileExists } from '@frontmcp/utils';

export function setupDaemonShutdown(server: { close: () => Promise<void>; dispose: () => Promise<void> }): void {
  const socketPath = '/tmp/my-daemon.sock';
  const pidFile = `${process.env.HOME}/.config/my-daemon/daemon.pid`;

  const shutdown = async (signal: string) => {
    console.log(`[daemon] Received ${signal}. Shutting down...`);

    // 1. Stop accepting new connections
    await server.close();
    console.log('[daemon] Server closed.');

    // 2. Dispose all resources (SQLite, providers)
    await server.dispose();
    console.log('[daemon] Resources disposed.');

    // 3. Remove socket file (prevent stale .sock files)
    if (await fileExists(socketPath)) {
      await unlink(socketPath);
      console.log(`[daemon] Socket removed: ${socketPath}`);
    }

    // 4. Clean up PID file
    if (await fileExists(pidFile)) {
      await unlink(pidFile);
      console.log(`[daemon] PID file removed: ${pidFile}`);
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
```

```typescript
// src/providers/sqlite-store.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const LOCAL_STORE = Symbol('LocalStore');

@Provider({ token: LOCAL_STORE, scope: ProviderScope.GLOBAL })
export class SqliteStoreProvider {
  private db!: { close: () => void; exec: (sql: string) => void };

  async onInit(): Promise<void> {
    // Database path is configurable, not hardcoded
    const dbPath = process.env.DB_PATH ?? `${process.env.HOME}/.config/my-daemon/data.db`;

    // Ensure directory exists
    const { ensureDir } = await import('@frontmcp/utils');
    const path = await import('path');
    await ensureDir(path.dirname(dbPath));

    // Initialize with WAL mode for concurrent reads
    // Auto-migrate on startup
    this.db = await this.openDatabase(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
  }

  async onDestroy(): Promise<void> {
    // Close database connection on shutdown
    this.db.close();
  }

  private async openDatabase(path: string) {
    // Replace with your SQLite driver (e.g., better-sqlite3)
    throw new Error('Implement with your SQLite driver');
  }
}
```

## What This Demonstrates

- SIGTERM handler that completes in-flight requests before exiting
- Removing the Unix socket file to prevent stale `.sock` files on restart
- Cleaning up the PID file on shutdown
- Using `@frontmcp/utils` (`unlink`, `fileExists`, `ensureDir`) for file operations
- Implementing `onDestroy()` to close database connections

## Related

- See `production-cli-daemon` for the full graceful shutdown and security checklist
