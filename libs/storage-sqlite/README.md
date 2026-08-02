# @frontmcp/storage-sqlite

SQLite storage backend for FrontMCP — session, task, elicitation, and event
persistence without running Redis.

[![NPM](https://img.shields.io/npm/v/@frontmcp/storage-sqlite.svg)](https://www.npmjs.com/package/@frontmcp/storage-sqlite)

## When to use it

Reach for SQLite when you need state to survive a restart but do not want a
network dependency:

- **Local development** — restart `frontmcp dev` without losing sessions.
- **Single-node deployments** — a VPS or container with a mounted volume.
- **CLI / desktop distributions** — a single binary with embedded storage.
- **Background tasks** — the CLI task runner spawns detached workers that need a
  shared store the parent process can also read.

Use Redis instead when more than one node has to see the same state — SQLite is
a local file, so it cannot coordinate across machines.

## Install

```bash
npm install @frontmcp/storage-sqlite
```

`better-sqlite3` is a native module and is loaded lazily, so importing
`@frontmcp/sdk` never pulls it in unless you actually enable SQLite. It does not
work on Edge/V8-isolate runtimes (Cloudflare Workers) — use Redis or Upstash
there.

## Usage

Most servers never import this package directly. Point a store at SQLite in
config and the SDK wires it up:

```ts
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  // Persist sessions across restarts.
  transport: { persistence: { sqlite: { path: './data/frontmcp.sqlite' } } },
  // Persist background tasks (required for the `cli` task runner).
  tasks: { enabled: true, sqlite: { path: './data/tasks.sqlite', walMode: true } },
})
class Server {}
```

### Direct use

```ts
import { openDatabase, SqliteSessionStore } from '@frontmcp/storage-sqlite';

const store = new SqliteSessionStore({ path: './data/sessions.sqlite', walMode: true });
await store.set('session-id', { userId: 'u1' }, { ttlSeconds: 3600 });
```

## Stores

| Export                   | Backs                                                 |
| ------------------------ | ----------------------------------------------------- |
| `SqliteSessionStore`     | MCP transport sessions                                |
| `SqliteTaskStore`        | Background tasks (status, outcome, cancel signalling) |
| `SqliteElicitationStore` | Pending elicitation round trips                       |
| `SqliteEventStore`       | Streamable-HTTP event replay                          |
| `SqliteKvStore`          | Generic key/value with TTL                            |
| `SqliteStorageAdapter`   | The `StorageAdapter` the SDK's factories accept       |

## Options

| Option                 | Default | Notes                                                  |
| ---------------------- | ------- | ------------------------------------------------------ |
| `path`                 | —       | Database file. Parent directories are created for you. |
| `walMode`              | `true`  | Write-ahead logging. Leave on for concurrent readers.  |
| `ttlCleanupIntervalMs` | `60000` | How often expired rows are swept.                      |
| `encryption`           | —       | Encrypt values at rest; pass a key to enable.          |

## Operational notes

- **Back up the file.** It is ordinary SQLite — copy it, or use `sqlite3 .backup`.
- **WAL creates sidecar files** (`-wal`, `-shm`). Ship the whole set, or check
  point before copying.
- **One writer.** Multiple processes can read; concurrent writers serialize. The
  CLI task runner relies on WAL for exactly this.

Full guide: [SQLite Setup](https://docs.agentfront.dev/frontmcp/deployment/sqlite-setup)

## License

Apache-2.0
