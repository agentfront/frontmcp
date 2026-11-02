---
name: setup-sqlite
description: Configure SQLite for local deployments, shared by the processes on one machine, with WAL mode and optional encryption
---

# Configure SQLite for Local and Single-Instance Deployments

## When to Use This Skill

### Must Use

- Your FrontMCP server runs on one machine with local persistent storage (CLI tools, unix-socket daemons)
- Several processes on one machine (a server per agent or terminal) share state, counters or locks
- You need session or key-value storage for local development without running external services
- Your deployment target is a single-process Node.js server on a machine with a local filesystem

### Recommended

- You are building a CLI tool or local-only MCP server that will never be horizontally scaled
- Local development when running a Redis container is unnecessary overhead
- Projects that store session data, credentials, or counters on a single host

### Skip When

- Deploying to serverless (Vercel, Lambda, Cloudflare) where there is no persistent local filesystem -- use `setup-redis` instead
- Running server instances on more than one machine (behind a load balancer) -- use `setup-redis` instead
- You need pub/sub for resource subscriptions or real-time event distribution -- use `setup-redis` instead

> **Decision:** Use SQLite for storage on one machine, including several processes sharing a file; switch to `setup-redis` for several machines or serverless deployments.

## Step 1 -- Install the Native Dependency

The `@frontmcp/storage-sqlite` package depends on `better-sqlite3`, which compiles a native C module during installation. Build tools must be available on the system.

```bash
yarn add @frontmcp/storage-sqlite better-sqlite3
yarn add -D @types/better-sqlite3
```

If the install fails with compilation errors:

- **macOS**: Install Xcode Command Line Tools: `xcode-select --install`
- **Linux (Debian/Ubuntu)**: `sudo apt-get install build-essential python3`
- **Linux (Alpine)**: `apk add build-base python3`
- **Windows**: Install Visual Studio Build Tools with the "Desktop development with C++" workload

Verify the native module loads:

```bash
node -e "require('better-sqlite3')"
```

No output means success. An error means the native bindings did not compile correctly.

## Step 2 -- Configure the FrontMCP Server

The `sqlite` field in the `@FrontMcp` decorator accepts a `SqliteOptionsInput` object with the following shape:

```typescript
interface SqliteOptionsInput {
  /**
   * Path to the .sqlite database file. **Optional** — when omitted the SDK
   * picks a sensible default at startup:
   *   - dev + node + non-CLI → `<projectRoot>/dist/sessions.sqlite`
   *   - prod OR CLI mode    → `~/.{info.name}/sessions.sqlite`
   * Set this to override either default (e.g. `./.data/sessions.sqlite`).
   */
  path?: string;

  /** Enable WAL mode for better read concurrency (default: true) */
  walMode?: boolean;

  /** Encryption config for at-rest encryption of values (optional) */
  encryption?: {
    /** Secret key material for AES-256-GCM encryption via HKDF-SHA256 */
    secret: string;
  };

  /** Interval in ms for purging expired keys (default: 60000) */
  ttlCleanupIntervalMs?: number;

  /** Ms to wait for a lock held by another process before SQLITE_BUSY (default: 5000) */
  busyTimeoutMs?: number;
}
```

### Default-path policy (issue #401)

If you set `sqlite: {}` without a `path`, the SDK resolves it as follows:

| Environment                                              | Resolved path                        |
| -------------------------------------------------------- | ------------------------------------ |
| `frontmcp dev` (NODE_ENV=development, node, no CLI mode) | `<projectRoot>/dist/sessions.sqlite` |
| Built CLI binary (`cliMode`)                             | `~/.{info.name}/sessions.sqlite`     |
| Production node server (`NODE_ENV=production`)           | `~/.{info.name}/sessions.sqlite`     |

The home-directory namespace is **derived from your `info.name`**, so two
frontmcp apps from different projects never share the same database
(e.g. `my-server` → `~/.my-server/sessions.sqlite`,
`other-app` → `~/.other-app/sessions.sqlite`). If `info.name` is unset or
sanitization strips it to empty, the fallback is `~/.frontmcp/`.

The SDK also `mkdir -p`'s the parent directory at startup, so you don't
need to pre-create it. The resolved path is logged at INFO level:

```text
[FrontMcp] No `sqlite.path` set — using default { path: '/Users/you/.my-server/sessions.sqlite' }
```

### Basic SQLite setup

Update the `@FrontMcp` decorator in `src/main.ts`:

```typescript
import 'reflect-metadata';

import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-cli-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  sqlite: {
    path: '~/.frontmcp/data/sessions.sqlite',
    walMode: true,
  },
})
export default class Server {}
```

Configuration reference:

| Option                 | Type                 | Default     | Description                                                                                                                                                                      |
| ---------------------- | -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`                 | `string`             | (optional)  | Absolute or `~`-prefixed path to the `.sqlite` file. Auto-resolved when omitted — see the default-path policy below.                                                             |
| `walMode`              | `boolean`            | `true`      | Enable WAL mode for better read concurrency                                                                                                                                      |
| `busyTimeoutMs`        | `number`             | `5000`      | How long a connection waits on a lock held by another process before `SQLITE_BUSY`. Set before WAL and table creation, so two processes starting on one file wait for each other |
| `encryption`           | `{ secret: string }` | `undefined` | AES-256-GCM encryption for values at rest                                                                                                                                        |
| `ttlCleanupIntervalMs` | `number`             | `60000`     | Interval for purging expired keys (milliseconds)                                                                                                                                 |

### With at-rest encryption

If the database stores sensitive session data (tokens, credentials), enable encryption:

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  sqlite: {
    path: '~/.frontmcp/data/sessions.sqlite',
    walMode: true,
    encryption: {
      secret: process.env['SQLITE_ENCRYPTION_SECRET']!,
    },
  },
})
export default class Server {}
```

Reading a value written under a different secret throws `SqliteDecryptionError` (code `SQLITE_DECRYPTION_FAILED`) whose message names the secret as the likely cause; restore the original secret or delete the database file.

The encryption uses HKDF-SHA256 for key derivation and AES-256-GCM for value encryption. The secret should be at least 32 characters. Store it in environment variables, never in source code.

### For a unix-socket daemon

```typescript
@FrontMcp({
  info: { name: 'frontmcp-daemon', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  sqlite: {
    path: '/var/lib/frontmcp/daemon.sqlite',
    walMode: true,
  },
  transport: {
    protocol: 'modern', // 'modern' preset enables streamable HTTP + strict sessions
  },
  http: {
    unixSocket: '/tmp/frontmcp.sock',
  },
})
export default class Server {}
```

### With custom TTL cleanup interval

For high-throughput servers with many short-lived sessions, reduce the cleanup interval:

```typescript
sqlite: {
  path: '~/.frontmcp/data/sessions.sqlite',
  walMode: true,
  ttlCleanupIntervalMs: 15000,  // purge expired keys every 15 seconds
},
```

## Step 3 -- Journal Mode, Busy Timeout and Several Processes

WAL (Write-Ahead Logging) mode is enabled by default (`walMode: true`) and is strongly recommended. It provides:

- Concurrent readers do not block writers
- Writers do not block readers
- Better performance for read-heavy workloads (typical for MCP session lookups)

WAL mode creates two additional files alongside the database:

```text
sessions.sqlite       # main database
sessions.sqlite-wal   # write-ahead log
sessions.sqlite-shm   # shared memory index
```

All three files must be on the same filesystem. Do not place the database on a network mount (NFS, SMB) when using WAL mode.

To disable WAL mode (only if you have a specific reason, such as a filesystem that does not support shared memory):

```typescript
sqlite: {
  path: '~/.frontmcp/data/sessions.sqlite',
  walMode: false,
},
```

### Choosing a journal mode

| Mode                                | Readers and the writer                                                                   | Files                                                                                                  | Use it for                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| WAL (`walMode: true`, default)      | Readers never wait for the writer, and the writer never waits for readers                | `-wal` and `-shm` beside the database while it is open; back it up with `VACUUM INTO`, not a file copy | Almost everything, and any file several processes write to                |
| Rollback journal (`walMode: false`) | The writer waits for readers to finish before it commits; readers wait during the commit | A `-journal` file only while a write commits                                                           | Mostly-read files with rare writes, or a filesystem without shared memory |

WAL needs a local filesystem: never put a WAL database on NFS, SMB or another network mount. A file once switched to WAL stays in WAL for every process that opens it, so `walMode: false` on one process does not switch it back.

### Several processes on one file

Any number of processes on one machine can open the same file. SQLite lets one process write at a time; FrontMCP keeps that cheap:

- **One connection per file per process.** The stores a process opens on one file (sessions, tasks, elicitation, events, job runs, and your own SQLite storage) share a single connection, so a process never waits on its own lock.
- **Short, atomic writes.** Each write is one short `BEGIN IMMEDIATE` transaction. A conditional set (`ifNotExists`/`ifExists`), `incr`, `deleteIfEquals` and `expireIfEquals` read and write in that one transaction, so counters stay exact and an NX lock has one holder across processes.
- **Waiting without blocking.** Operations through `createStorage({ type: 'sqlite' })`, `sqliteStorageProvider()` or `SqliteStorageAdapter` run one at a time per process and wait for another process's lock on a timer, so the event loop keeps running; `disconnect()` lets the operations already called finish first. The periodic sweeps of expired keys and events wait the same way. The built-in session, task, elicitation and event stores' own reads and writes still wait synchronously, for at most `busyTimeoutMs`.

### Busy timeout

`busyTimeoutMs` (default `5000`) is how long an operation waits for another process's write lock before it fails with `SQLITE_BUSY`. The wait counts from the call, so while the lock stays held every queued operation fails within `busyTimeoutMs` of its call, not one timeout after another; it restarts each time an earlier operation in the queue gets the lock. Writes hold the lock for one short transaction, so the default covers many writer processes. Raise it when processes hold the lock longer (bulk imports, long transactions) or when dozens of processes write at once; lower it for an interactive tool that should fail fast. When several stores in one process open a file with different values, the longest applies.

## Step 4 -- How the SDK Builds the SQLite Session Store

You do not call any factory yourself. The SDK constructs the SQLite session store internally from the `sqlite` field on the `@FrontMcp` decorator. The framework handles:

- Lazy-loading `@frontmcp/storage-sqlite` to avoid bundling native modules when not used
- WAL mode pragma configuration
- TTL cleanup interval setup for automatic key expiration
- Creating the database file and parent directories if they do not exist

### How the wiring works (issue #401)

Top-level `sqlite` is treated by the SDK as the **default SQLite backend** for
four subsystems:

| Subsystem                     | Default source     | Override                           |
| ----------------------------- | ------------------ | ---------------------------------- |
| Transport session persistence | top-level `sqlite` | `transport.persistence.sqlite`     |
| Background task store         | top-level `sqlite` | `tasks.sqlite`                     |
| Elicitation store             | top-level `sqlite` | `elicitation.sqlite`               |
| Job runs and definitions      | top-level `sqlite` | `jobs.store` (`sqlite` or `redis`) |

If you want different files per subsystem, set the subsystem's own `sqlite`
block — it takes precedence over the top-level one. To disable a single
subsystem, set its `enabled: false` (or set `transport.persistence: false` for
transports).

If you set the top-level `sqlite` block but disable every consuming subsystem,
the SDK emits a WARN at startup so the no-op doesn't go silent:

```text
[FrontMcp] Top-level `sqlite` config was provided but no subsystem consumes it ...
```

`createSqliteSessionStore` lives in
`libs/sdk/src/auth/session/index.ts` for the framework's own wiring, but
it is **not** re-exported from `@frontmcp/sdk`'s public entrypoint and
there is no `@frontmcp/sdk/auth/session` subpath export. End-user code
should rely on the decorator path (top-level `sqlite: {...}` on
`@FrontMcp`) — same guidance as
[`configure-session`](../../frontmcp-config/references/configure-session.md):
the SDK constructs the session store; user code does not.

If you need to share the same SQLite config in another part of your code, declare it once and reuse it:

```typescript
import 'reflect-metadata';

import { FrontMcp, type SqliteOptionsInput } from '@frontmcp/sdk';

const sqlite: SqliteOptionsInput = {
  path: '~/.frontmcp/data/sessions.sqlite',
  walMode: true,
  encryption: { secret: process.env['SQLITE_ENCRYPTION_SECRET']! },
};

@FrontMcp({
  info: { name: 'my-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  sqlite,
})
export default class Server {}
```

## Step 5 -- SQLite Storage in Your Own Code

The same file can hold your own keys, counters and locks. Install `@frontmcp/storage-sqlite`, then either register a provider and read it in tools:

```typescript
import { FrontMcp, sqliteStorageProvider, SqliteStorageToken, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'count_visit', description: 'Count a visit across every process on this machine', inputSchema: {} })
class CountVisitTool extends ToolContext {
  async execute() {
    const storage = this.get(SqliteStorageToken);
    return { visits: await storage.incr('visits') };
  }
}

@FrontMcp({
  info: { name: 'my-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  providers: [sqliteStorageProvider({ path: '/var/lib/my-server/app.sqlite', prefix: 'app:' })],
})
export default class Server {}
```

or create the storage yourself:

```typescript
import { createStorage } from '@frontmcp/utils';

const storage = await createStorage({
  type: 'sqlite',
  sqlite: { path: '/var/lib/my-server/app.sqlite' },
  fallback: 'error', // a lock in process memory would not be shared
});
await storage.set('lock:reindex', process.pid.toString(), { ifNotExists: true, ttlSeconds: 60 });
```

| Option (`sqliteStorageProvider` / `createStorage`'s `sqlite`) | Default              | Description                                                       |
| ------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| `path`                                                        | (required)           | The database file; its directory is created if missing            |
| `walMode`                                                     | `true`               | See [Choosing a journal mode](#choosing-a-journal-mode)           |
| `busyTimeoutMs`                                               | `5000`               | See [Busy timeout](#busy-timeout)                                 |
| `ttlCleanupIntervalMs`                                        | `60000`              | How often expired keys are purged; `0` turns the sweep off        |
| `encryption`                                                  | `undefined`          | `{ secret }` encrypts values at rest (AES-256-GCM)                |
| `prefix` (provider only)                                      | `''`                 | Prefix for every key the storage reads and writes                 |
| `provide` (provider only)                                     | `SqliteStorageToken` | Register under another token to hold more than one SQLite storage |

The provider opens the file at boot, fails the boot on an invalid option or a missing `@frontmcp/storage-sqlite` (it never falls back to memory), and disconnects at shutdown; it works in `createContainer()` scripts too. `createStorage` throws `StorageConfigError` for an invalid `sqlite` block whatever its `fallback`; with `fallback: 'memory'` (the default outside production) a missing package falls back to memory with a warning, as the other backends do. The same `{ type: 'sqlite', sqlite: { path } }` works for `throttle.storage` and for plugins that take a `StorageConfig`. SQLite storage has no pub/sub.

## Step 6 -- Environment Variables

Add to your `.env` file:

```env
# SQLite storage
SQLITE_DB_PATH=~/.frontmcp/data/sessions.sqlite

# Encryption (optional, at least 32 characters)
# SQLITE_ENCRYPTION_SECRET=your-secret-key-at-least-32-chars-long
```

Confirm `.env` is in `.gitignore`. Never commit credentials.

## Step 7 -- Verify the Setup

Start the server:

```bash
frontmcp dev
```

Check the logs for SQLite initialization:

```text
[SessionStoreFactory] Creating SQLite session store
```

Verify the database file was created:

```bash
ls -la ~/.frontmcp/data/sessions.sqlite
```

If WAL mode is enabled, you should also see:

```bash
ls -la ~/.frontmcp/data/sessions.sqlite-wal
ls -la ~/.frontmcp/data/sessions.sqlite-shm
```

Inspect the database contents (after at least one session is created):

```bash
sqlite3 ~/.frontmcp/data/sessions.sqlite ".tables"
sqlite3 ~/.frontmcp/data/sessions.sqlite "SELECT key FROM kv LIMIT 5;"
```

## Migrating from SQLite to Redis

When your project outgrows single-instance deployment, migrate to Redis:

1. Run the `setup-redis` skill to configure Redis.
2. Replace the `sqlite` block with a `redis` block in the `@FrontMcp` decorator.
3. Remove `@frontmcp/storage-sqlite` and `better-sqlite3` from dependencies.
4. Active sessions will not transfer -- users will need to re-authenticate.

The change in `src/main.ts`:

```typescript
// Before (SQLite)
@FrontMcp({
  info: { name: 'my-server', version: '0.1.0' },
  apps: [/* ... */],
  sqlite: {
    path: '~/.frontmcp/data/sessions.sqlite',
    walMode: true,
  },
})

// After (Redis)
@FrontMcp({
  info: { name: 'my-server', version: '0.1.0' },
  apps: [/* ... */],
  redis: {
    provider: 'redis',
    host: 'localhost',
    port: 6379,
    keyPrefix: 'mcp:',
  },
})
```

## Common Patterns

| Pattern                        | Correct                                            | Incorrect                                  | Why                                                                                                           |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Database path                  | `path: '~/.frontmcp/data/sessions.sqlite'`         | `path: './sessions.sqlite'`                | Tilde-prefixed or absolute paths are stable across working directories; relative paths break when CWD changes |
| Encryption secret source       | `secret: process.env['SQLITE_ENCRYPTION_SECRET']!` | `secret: 'hardcoded-secret-value'`         | Secrets must come from environment variables, never committed to source code                                  |
| WAL mode default               | `walMode: true` (or omit, defaults to `true`)      | `walMode: false` without a specific reason | WAL provides better read concurrency with no downside on local filesystems                                    |
| Native dependency installation | `yarn add @frontmcp/storage-sqlite better-sqlite3` | `yarn add better-sqlite3` alone            | Both packages are required; the storage package wraps the native bindings with FrontMCP session store logic   |
| TTL cleanup interval           | `ttlCleanupIntervalMs: 60000` (default)            | `ttlCleanupIntervalMs: 500`                | Overly aggressive cleanup wastes CPU; the default 60s is appropriate for most workloads                       |

## Verification Checklist

### Dependencies

- [ ] `@frontmcp/storage-sqlite` and `better-sqlite3` are in `dependencies`
- [ ] `@types/better-sqlite3` is in `devDependencies`
- [ ] `node -e "require('better-sqlite3')"` runs without errors

### Configuration

- [ ] The `sqlite` block is present in the `@FrontMcp` decorator config with a valid `path` string
- [ ] The database path parent directory exists and is writable
- [ ] WAL mode is enabled (default) unless there is a specific filesystem limitation

### Environment and Security

- [ ] Environment variables are in `.env` and `.env` is gitignored
- [ ] If encryption is enabled: `SQLITE_ENCRYPTION_SECRET` is set and is at least 32 characters
- [ ] No secrets are hardcoded in source files

### Runtime

- [ ] The server starts without SQLite errors (`frontmcp dev`)
- [ ] The database file is created at the configured path
- [ ] If WAL mode is enabled: `.sqlite-wal` and `.sqlite-shm` files appear alongside the database

## Troubleshooting

| Problem                                 | Cause                                                           | Solution                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Cannot find module 'better-sqlite3'`   | Native module not installed                                     | Run `yarn add @frontmcp/storage-sqlite better-sqlite3`                                                                        |
| `Could not locate the bindings file`    | Native compilation failed                                       | Ensure build tools are installed (Xcode CLI on macOS, `build-essential` on Linux), delete `node_modules` and reinstall        |
| `SQLITE_BUSY` errors                    | Another process held the write lock longer than `busyTimeoutMs` | Keep WAL mode on (`walMode: true`), keep transactions short, and raise `busyTimeoutMs` (default 5000)                         |
| `Failed to persist session to SQLite`   | A session write waited longer than `busyTimeoutMs` for the lock | Raise `busyTimeoutMs`, or use Redis for many writer processes                                                                 |
| `SQLITE_READONLY`                       | Insufficient file permissions                                   | Check write permissions on the database file and its parent directory                                                         |
| WAL errors on network mount             | WAL mode requires a local filesystem with shared-memory support | Move the database to a local disk; `walMode: false` only keeps a new file out of WAL, it does not switch an existing one back |
| Encrypted data unreadable after restart | Encryption secret changed or missing                            | The secret must be identical across restarts; if the original secret is lost, delete the database and let it be recreated     |

## Examples

| Example                                                                            | Level        | Description                                                                                       |
| ---------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| [`basic-sqlite-setup`](../examples/setup-sqlite/basic-sqlite-setup.md)             | Basic        | Configure a FrontMCP server with SQLite for local session storage with WAL mode enabled.          |
| [`encrypted-sqlite-storage`](../examples/setup-sqlite/encrypted-sqlite-storage.md) | Intermediate | Enable AES-256-GCM at-rest encryption for sensitive session data stored in SQLite.                |
| [`unix-socket-daemon`](../examples/setup-sqlite/unix-socket-daemon.md)             | Advanced     | Configure a FrontMCP daemon that listens on a unix socket and uses SQLite for persistent storage. |
| [`multi-process-storage`](../examples/setup-sqlite/multi-process-storage.md)       | Intermediate | Share counters and a lock between several local processes through one SQLite file.                |

> See all examples in [`examples/setup-sqlite/`](../examples/setup-sqlite/)

## Reference

- **Docs:** [SQLite Setup Guide](https://frontmcp.dev/reference/deployment/sqlite)
- **Related skills:** `setup-redis`, `setup-project`, `nx-workflow`
