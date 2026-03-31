---
name: basic-sqlite-setup
reference: setup-sqlite
level: basic
description: 'Configure a FrontMCP server with SQLite for local session storage with WAL mode enabled.'
tags: [setup, sqlite, session, database, local]
features:
  - '`@frontmcp/storage-sqlite` and `better-sqlite3` as required dependencies'
  - '`sqlite` config in `@FrontMcp` with `path` and `walMode`'
  - 'WAL mode creates three files (`.sqlite`, `.sqlite-wal`, `.sqlite-shm`)'
  - 'Tilde-prefixed paths for stable storage across working directories'
---

# Basic SQLite Setup

Configure a FrontMCP server with SQLite for local session storage with WAL mode enabled.

## Code

```bash
# Install the native dependency
yarn add @frontmcp/storage-sqlite better-sqlite3
yarn add -D @types/better-sqlite3

# Verify the native module loads
node -e "require('better-sqlite3')"
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
sqlite3 ~/.frontmcp/data/sessions.sqlite "SELECT key FROM kv_store LIMIT 5;"
```

## What This Demonstrates

- `@frontmcp/storage-sqlite` and `better-sqlite3` as required dependencies
- `sqlite` config in `@FrontMcp` with `path` and `walMode`
- WAL mode creates three files (`.sqlite`, `.sqlite-wal`, `.sqlite-shm`)
- Tilde-prefixed paths for stable storage across working directories

## Related

- See `setup-sqlite` for encryption, custom TTL cleanup, and migration to Redis
