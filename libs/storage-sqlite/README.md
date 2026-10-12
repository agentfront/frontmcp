# @frontmcp/storage-sqlite

SQLite storage for FrontMCP: sessions, background tasks, pending elicitations and stream events in a local file, so they survive a restart without running Redis. Install it next to `@frontmcp/sdk` and set `@FrontMcp({ sqlite })`; the SDK loads it. Use it on one machine: local development, a single VM or container with a volume, a CLI or desktop server, or the `cli` task runner, whose worker processes share the file. When several machines must see the same state, use Redis instead: a SQLite file can't be shared across machines.

[![npm](https://img.shields.io/npm/v/@frontmcp/storage-sqlite.svg)](https://www.npmjs.com/package/@frontmcp/storage-sqlite) [![License](https://img.shields.io/npm/l/@frontmcp/storage-sqlite.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/storage-sqlite
```

Requires Node.js 24 or later. `better-sqlite3` is a regular dependency, so it's installed with the package. It's a native module that downloads or compiles its binary at install time, so install on the platform the server runs on (in a Docker image, run `npm ci` inside the image). The peer dependency `@frontmcp/lazy-zod` comes with `@frontmcp/sdk`.

`@frontmcp/sdk` loads this package only when a `sqlite` option is set, so importing the SDK never loads `better-sqlite3`. SQLite doesn't run on Cloudflare Workers or other V8-isolate runtimes; use Redis or Upstash there.

## Usage

Most servers never import this package. Point FrontMCP at a file and the SDK builds the stores:

```ts
import { App, FrontMcp } from '@frontmcp/sdk';

@App({ id: 'help-desk', name: 'Help Desk', tools: [] })
class HelpDeskApp {}

@FrontMcp({
  info: { name: 'help-desk', version: '1.0.0' },
  apps: [HelpDeskApp],
  sqlite: { path: './data/desk.sqlite' },
})
export default class Server {}
```

The top-level `sqlite` block backs sessions, background tasks and pending elicitations. Without `path`, the file is `<project>/dist/sessions.sqlite` outside production and `~/.<info.name>/sessions.sqlite` in production. `FRONTMCP_SQLITE_PATH` overrides both, and `path` too.

To give one subsystem its own file, set it there instead:

```ts
import { App, FrontMcp } from '@frontmcp/sdk';

@App({ id: 'help-desk', name: 'Help Desk', tools: [] })
class HelpDeskApp {}

@FrontMcp({
  info: { name: 'help-desk', version: '1.0.0' },
  apps: [HelpDeskApp],
  transport: { persistence: { sqlite: { path: './data/sessions.sqlite' } } },
  tasks: { enabled: true, runner: 'cli', sqlite: { path: './data/tasks.sqlite' } },
})
export default class Server {}
```

The `cli` task runner starts detached worker processes, so it needs a store they share: `tasks.sqlite`, a top-level `sqlite`, or `tasks.redis`.

### Using a store directly

```ts
import { SqliteSessionStore } from '@frontmcp/storage-sqlite';

const store = new SqliteSessionStore({ path: './data/sessions.sqlite', defaultTtlMs: 3_600_000 });
await store.set('session-id', { userId: 'u1' }, 60 * 60_000); // TTL in milliseconds
const session = await store.get('session-id');
store.close();
```

## Stores

| Export                   | Backs                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `SqliteSessionStore`     | MCP transport sessions (`keyPrefix`, default `'mcp:session:'`; `defaultTtlMs`, default 1 hour)        |
| `SqliteTaskStore`        | Background tasks: status, outcome and cancellation                                                    |
| `SqliteElicitationStore` | Pending elicitation requests (`keyPrefix`, default `'mcp:elicit:'`)                                   |
| `SqliteEventStore`       | Stream events for Streamable HTTP resumption (`maxEvents`, default 10000; `ttlMs`, default 5 minutes) |
| `SqliteKvStore`          | A synchronous key/value store with TTL, which the stores above are built on                           |
| `SqliteStorageAdapter`   | The async `StorageAdapter` interface of `@frontmcp/utils` over the same file (no publish/subscribe)   |

The package also exports `openDatabase` and `withBusyRetry` (helpers for opening a file and retrying on `SQLITE_BUSY`), `deriveEncryptionKey`, `encryptValue`, `decryptValue` and `SqliteDecryptionError`, and `sqliteStorageOptionsSchema`, the Zod schema for the options below.

## Options

Every store takes these options, and so do `@FrontMcp`'s `sqlite`, `transport.persistence.sqlite` and `tasks.sqlite`:

| Option                 | Default  | Notes                                                                                                           |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `path`                 | required | The database file. Its folder is created if it's missing. Optional in `@FrontMcp({ sqlite })`, as above         |
| `encryption`           | none     | `{ secret }`: encrypt every stored value with AES-256-GCM, with a key derived from `secret`. Keys stay readable |
| `walMode`              | `true`   | SQLite's write-ahead log, for readers that don't wait for writers                                               |
| `ttlCleanupIntervalMs` | `60000`  | How often expired entries are deleted                                                                           |
| `busyTimeoutMs`        | `5000`   | How long a write waits for a lock another process holds before it fails with `SQLITE_BUSY`                      |

A lost `encryption.secret` loses the data, and a changed one makes stored values unreadable (`SqliteDecryptionError`).

## Operational notes

- **Back up the file.** It's an ordinary SQLite database: copy it, or use `sqlite3 .backup`.
- **Write-ahead logging adds two files** next to it, `-wal` and `-shm`. Copy all three, or checkpoint first.
- **One writer at a time.** Several processes can read the file; writes wait for each other, up to `busyTimeoutMs`.

## Docs

- [SQLite](https://frontmcp.dev/reference/deployment/sqlite): the `sqlite` option, where the file goes, what's stored, locking and encryption
- [Redis](https://frontmcp.dev/reference/deployment/redis): the store to use when several machines share state
- [Background tasks](https://frontmcp.dev/reference/server/tasks): task runners and their stores

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework that loads this package for its `sqlite` options
- [`@frontmcp/utils`](https://www.npmjs.com/package/@frontmcp/utils): the `StorageAdapter` interface `SqliteStorageAdapter` implements, and the other storage backends

## Contributing

Source: [`libs/storage-sqlite`](https://github.com/agentfront/frontmcp/tree/main/libs/storage-sqlite). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
