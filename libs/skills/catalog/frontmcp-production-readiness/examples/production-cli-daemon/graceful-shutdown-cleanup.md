---
name: graceful-shutdown-cleanup
reference: production-cli-daemon
level: intermediate
description: 'Shows daemon-specific shutdown cleanup (socket file, PID file) layered on top of the framework-managed SIGTERM/SIGINT handlers.'
tags: [production, unix-socket, cli, database, daemon, graceful]
features:
  - 'Framework already wires SIGTERM/SIGINT — do not duplicate'
  - 'Use `server.dispose()` (NOT `server.close()` — that method does not exist)'
  - 'Removing the Unix socket file to prevent stale `.sock` files on restart'
  - 'Cleaning up the PID file on shutdown'
  - 'Using `@frontmcp/utils` (`unlink`, `fileExists`, `ensureDir`) for file operations'
---

# Daemon Graceful Shutdown with Socket Cleanup

Shows how to layer daemon-specific cleanup (socket file, PID file) **on top of** the framework's built-in SIGTERM/SIGINT handler.

> The FrontMCP framework already installs `SIGTERM` / `SIGINT` handlers that call `scope.shutdown()` and `mcpServer.close()` (see `libs/sdk/src/front-mcp/front-mcp.ts`). **Do not install your own** competing shutdown handler — only register _additional_ cleanup hooks (e.g. for socket / PID files) that run before the framework exits.
>
> `FrontMcpServerInstance` exposes `dispose()` only — there is **no** `server.close()` method.

## Code

```typescript
// src/lifecycle/daemon-shutdown.ts
import { fileExists, unlink } from '@frontmcp/utils';

/**
 * Register daemon-only side-effect cleanup. Run BEFORE the framework's
 * SIGTERM handler tears down the server. Do not call process.exit() here —
 * the framework owns that.
 */
export function setupDaemonSideEffectCleanup(): void {
  const socketPath = '/tmp/my-daemon.sock';
  const pidFile = `${process.env.HOME}/.config/my-daemon/daemon.pid`;

  const cleanup = async () => {
    if (await fileExists(socketPath)) {
      await unlink(socketPath);
      console.log(`[daemon] Socket removed: ${socketPath}`);
    }
    if (await fileExists(pidFile)) {
      await unlink(pidFile);
      console.log(`[daemon] PID file removed: ${pidFile}`);
    }
  };

  // The framework registers its own SIGTERM/SIGINT handlers. Adding ours
  // means BOTH run on signal — Node.js fires every registered listener.
  // Keep these idempotent and side-effect-only; framework will exit after.
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}
```

```typescript
// src/providers/sqlite-store.provider.ts
import { dirname } from 'path';

import { Provider, ProviderScope } from '@frontmcp/sdk';
import { ensureDir } from '@frontmcp/utils';

export const LOCAL_STORE = Symbol('LocalStore');

// Providers do NOT have onInit/onDestroy lifecycle hooks.
// Initialize in the constructor; resource cleanup happens via the
// framework-managed scope.shutdown() path.
@Provider({ token: LOCAL_STORE, scope: ProviderScope.GLOBAL })
export class SqliteStoreProvider {
  private readonly db: { close: () => void; exec: (sql: string) => void };

  constructor() {
    const dbPath = process.env.DB_PATH ?? `${process.env.HOME}/.config/my-daemon/data.db`;
    // ensureDir is sync-safe to call here if you accept a top-level await
    // in your bootstrap, otherwise inline-await in an async factory.
    void ensureDir(dirname(dbPath));
    this.db = this.openDatabase(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
  }

  private openDatabase(path: string) {
    // Replace with your SQLite driver (e.g., better-sqlite3)
    throw new Error('Implement with your SQLite driver');
  }
}
```

## What This Demonstrates

- The framework already wires SIGTERM/SIGINT — daemon cleanup attaches _additional_ listeners and does not call `process.exit()`
- Using `server.dispose()` (the only real method) instead of fictional `server.close()`
- Removing the Unix socket file to prevent stale `.sock` files on restart
- Cleaning up the PID file on shutdown
- Using `@frontmcp/utils` (`unlink`, `fileExists`, `ensureDir`) for file operations
- Providers initialize in the constructor — there is no `onInit` / `onDestroy`

## Related

- See `production-cli-daemon` for the full graceful shutdown and security checklist
- Framework SIGTERM/SIGINT wiring: `libs/sdk/src/front-mcp/front-mcp.ts`
