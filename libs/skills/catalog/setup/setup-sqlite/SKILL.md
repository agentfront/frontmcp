---
name: setup-sqlite
description: Configure SQLite for local development and single-instance deployments. Use when setting up local storage, CLI tools, unix-socket daemons, or WAL mode.
category: setup
tags: [setup, sqlite, storage, local]
targets: [node]
bundle: [minimal, full]
hasResources: false
storageDefault:
  node: sqlite
allowed-tools: Bash Write Edit Read Grep
parameters:
  - name: walMode
    type: boolean
    description: Enable WAL (Write-Ahead Logging) mode for better read concurrency
    default: true
  - name: dbPath
    type: string
    description: File path for the SQLite database
    default: '~/.frontmcp/data/sessions.sqlite'
  - name: encryption
    type: boolean
    description: Enable AES-256-GCM at-rest encryption for stored values
    default: false
examples:
  - scenario: Set up SQLite storage for a CLI tool
    parameters:
      walMode: true
      dbPath: '~/.frontmcp/data/sessions.sqlite'
      encryption: false
  - scenario: Configure SQLite for a unix-socket daemon with encryption
    parameters:
      walMode: true
      dbPath: '/var/lib/frontmcp/daemon.sqlite'
      encryption: true
compatibility: 'Node.js 18+. Requires better-sqlite3 native bindings (build tools needed). Linux, macOS, Windows (x64/arm64). Not recommended for multi-instance, serverless, or horizontally scaled deployments.'
install:
  destinations: [project-local]
  mergeStrategy: overwrite
  dependencies: [setup-project]
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/sqlite-setup
---

# Configure SQLite for Local and Single-Instance Deployments

## When to use this skill

Use this skill when your FrontMCP server runs as a single instance and does not need distributed storage. SQLite is the right choice for:

- CLI tools and local-only MCP servers
- Single-instance daemons communicating over stdio or unix socket
- Local development when running a Redis container is unnecessary overhead
- Projects that will never run multiple instances behind a load balancer

Do NOT use SQLite when:

- Deploying to serverless (Vercel, Lambda, Cloudflare) -- there is no persistent local filesystem
- Running multiple server instances (SQLite does not support distributed access)
- You need pub/sub for resource subscriptions (use Redis instead)
- Horizontal scaling is required now or in the near future

For multi-instance or serverless deployments, use the `setup-redis` skill instead.

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
    protocol: 'streamable-http',
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

## Troubleshooting

| Symptom                               | Likely Cause                               | Fix                                                                        |
| ------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `Cannot find module 'better-sqlite3'` | Native module not installed                | Run `yarn add @frontmcp/storage-sqlite better-sqlite3`                     |
| `Could not locate the bindings file`  | Native compilation failed                  | Ensure build tools are installed, delete `node_modules` and reinstall      |
| `SQLITE_BUSY` errors                  | Multiple processes accessing the same file | Use WAL mode or ensure only one process writes to the database             |
| `SQLITE_READONLY`                     | File permissions                           | Check write permissions on the database file and its parent directory      |
| Database file on NFS with WAL errors  | WAL requires local filesystem              | Move the database to a local disk or disable WAL mode                      |
| Encrypted data unreadable             | Wrong or missing encryption secret         | The secret must be identical across restarts; if lost, delete the database |

## Verification Checklist

Before reporting completion, verify:

1. `@frontmcp/storage-sqlite` and `better-sqlite3` are in `dependencies`
2. `@types/better-sqlite3` is in `devDependencies`
3. `node -e "require('better-sqlite3')"` runs without errors
4. The `sqlite` block is present in the `@FrontMcp` decorator config with a valid `path` string
5. The database path parent directory exists and is writable
6. Environment variables are in `.env` and `.env` is gitignored
7. The server starts without SQLite errors (`frontmcp dev`)
8. If encryption is enabled: `SQLITE_ENCRYPTION_SECRET` is set and is at least 32 characters
