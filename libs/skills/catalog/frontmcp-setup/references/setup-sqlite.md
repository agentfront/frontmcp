# Configure SQLite for Local and Single-Instance Deployments

## When to Use This Skill

### Must Use

- Your FrontMCP server runs as a single instance with local persistent storage (CLI tools, unix-socket daemons)
- You need session or key-value storage for local development without running external services
- Your deployment target is a single-process Node.js server on a machine with a local filesystem

### Recommended

- You are building a CLI tool or local-only MCP server that will never be horizontally scaled
- Local development when running a Redis container is unnecessary overhead
- Projects that store session data, credentials, or counters on a single host

### Skip When

- Deploying to serverless (Vercel, Lambda, Cloudflare) where there is no persistent local filesystem -- use `setup-redis` instead
- Running multiple server instances behind a load balancer -- use `setup-redis` instead
- You need pub/sub for resource subscriptions or real-time event distribution -- use `setup-redis` instead

> **Decision:** Use SQLite for single-instance local storage; switch to `setup-redis` for multi-instance or serverless deployments.

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
  /** Path to the .sqlite database file (required) */
  path: string;

  /** Enable WAL mode for better read concurrency (default: true) */
  walMode?: boolean;

  /** Encryption config for at-rest encryption of values (optional) */
  encryption?: {
    /** Secret key material for AES-256-GCM encryption via HKDF-SHA256 */
    secret: string;
  };

  /** Interval in ms for purging expired keys (default: 60000) */
  ttlCleanupIntervalMs?: number;
}
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

| Option                 | Type                 | Default     | Description                                         |
| ---------------------- | -------------------- | ----------- | --------------------------------------------------- |
| `path`                 | `string`             | (required)  | Absolute or `~`-prefixed path to the `.sqlite` file |
| `walMode`              | `boolean`            | `true`      | Enable WAL mode for better read concurrency         |
| `encryption`           | `{ secret: string }` | `undefined` | AES-256-GCM encryption for values at rest           |
| `ttlCleanupIntervalMs` | `number`             | `60000`     | Interval for purging expired keys (milliseconds)    |

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

## Step 3 -- WAL Mode Configuration

WAL (Write-Ahead Logging) mode is enabled by default (`walMode: true`) and is strongly recommended. It provides:

- Concurrent readers do not block writers
- Writers do not block readers
- Better performance for read-heavy workloads (typical for MCP session lookups)

WAL mode creates two additional files alongside the database:

```
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

## Step 4 -- Session Store Factory (Advanced)

The SDK creates the SQLite session store automatically from the `sqlite` config in the `@FrontMcp` decorator. For advanced scenarios where you need direct access to the factory function:

```typescript
import { createSqliteSessionStore } from '@frontmcp/sdk';

const sessionStore = createSqliteSessionStore({
  path: '~/.frontmcp/data/sessions.sqlite',
  walMode: true,
  encryption: { secret: process.env['SQLITE_ENCRYPTION_SECRET']! },
});
```

The `createSqliteSessionStore()` function signature:

```typescript
function createSqliteSessionStore(options: SqliteOptionsInput, logger?: FrontMcpLogger): SessionStore;
```

The factory function:

- Lazy-loads `@frontmcp/storage-sqlite` to avoid bundling native modules when not used
- Handles WAL mode pragma configuration internally
- Sets up the TTL cleanup interval for automatic key expiration
- Creates the database file and parent directories if they do not exist
- Returns synchronously (unlike the Redis `createSessionStore` which is async)

## Step 5 -- Environment Variables

Add to your `.env` file:

```env
# SQLite storage
SQLITE_DB_PATH=~/.frontmcp/data/sessions.sqlite

# Encryption (optional, at least 32 characters)
# SQLITE_ENCRYPTION_SECRET=your-secret-key-at-least-32-chars-long
```

Confirm `.env` is in `.gitignore`. Never commit credentials.

## Step 6 -- Verify the Setup

Start the server:

```bash
frontmcp dev
```

Check the logs for SQLite initialization:

```
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
sqlite3 ~/.frontmcp/data/sessions.sqlite "SELECT key FROM kv_store LIMIT 5;"
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

| Problem                                 | Cause                                                           | Solution                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Cannot find module 'better-sqlite3'`   | Native module not installed                                     | Run `yarn add @frontmcp/storage-sqlite better-sqlite3`                                                                    |
| `Could not locate the bindings file`    | Native compilation failed                                       | Ensure build tools are installed (Xcode CLI on macOS, `build-essential` on Linux), delete `node_modules` and reinstall    |
| `SQLITE_BUSY` errors                    | Multiple processes accessing the same database file             | Enable WAL mode (`walMode: true`) or ensure only one process writes to the database                                       |
| `SQLITE_READONLY`                       | Insufficient file permissions                                   | Check write permissions on the database file and its parent directory                                                     |
| WAL errors on network mount             | WAL mode requires a local filesystem with shared-memory support | Move the database to a local disk or set `walMode: false`                                                                 |
| Encrypted data unreadable after restart | Encryption secret changed or missing                            | The secret must be identical across restarts; if the original secret is lost, delete the database and let it be recreated |

## Reference

- **Docs:** [SQLite Setup Guide](https://docs.agentfront.dev/frontmcp/deployment/sqlite-setup)
- **Related skills:** `setup-redis`, `setup-project`, `nx-workflow`
