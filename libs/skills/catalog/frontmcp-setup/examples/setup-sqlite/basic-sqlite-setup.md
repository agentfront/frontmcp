---
name: basic-sqlite-setup
reference: setup-sqlite
level: basic
description: 'Configure a FrontMCP server with SQLite for local session storage with WAL mode enabled.'
tags: [setup, sqlite, session, database, local]
features:
  - '`@frontmcp/storage-sqlite`, which runs on `node:sqlite`, or on `better-sqlite3` (an optional peer) when it is installed'
  - '`sqlite` config in `@FrontMcp` with `path` and `walMode`'
  - 'WAL mode creates three files (`.sqlite`, `.sqlite-wal`, `.sqlite-shm`)'
  - 'Tilde-prefixed paths for stable storage across working directories'
---

# Basic SQLite Setup

Configure a FrontMCP server with SQLite for local session storage with WAL mode enabled.

## Code

```bash
# Install the package; the stores run on Node's built-in node:sqlite
yarn add @frontmcp/storage-sqlite

# Optional: add better-sqlite3 (a native module) to run them on it instead, and verify it loads
yarn add better-sqlite3
node -e "new (require('better-sqlite3'))(':memory:').close()"
```

```typescript
// src/main.ts
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

```env
# .env
SQLITE_DB_PATH=~/.frontmcp/data/sessions.sqlite
```

```bash
# Start the server
frontmcp dev

# Verify the database file was created
ls -la ~/.frontmcp/data/sessions.sqlite
ls -la ~/.frontmcp/data/sessions.sqlite-wal
ls -la ~/.frontmcp/data/sessions.sqlite-shm

# Inspect the database after at least one session
sqlite3 ~/.frontmcp/data/sessions.sqlite ".tables"
sqlite3 ~/.frontmcp/data/sessions.sqlite "SELECT key FROM kv LIMIT 5;"
```

## What This Demonstrates

- `@frontmcp/storage-sqlite`, which runs on `node:sqlite`, or on `better-sqlite3` (an optional peer) when it is installed
- `sqlite` config in `@FrontMcp` with `path` and `walMode`
- WAL mode creates three files (`.sqlite`, `.sqlite-wal`, `.sqlite-shm`)
- Tilde-prefixed paths for stable storage across working directories

## Related

- See `setup-sqlite` for encryption, custom TTL cleanup, and migration to Redis
