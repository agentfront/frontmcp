---
name: multi-process-storage
reference: setup-sqlite
level: intermediate
description: 'Share counters and a lock between several local processes through one SQLite file.'
tags: [setup, sqlite, storage, multi-process, lock, local]
features:
  - '`sqliteStorageProvider()` registers a SQLite-backed storage that tools read with `this.get(SqliteStorageToken)`'
  - '`incr` stays exact and an `ifNotExists` lock has one holder across processes on the same file'
  - "`createStorage({ type: 'sqlite' })` gives scripts and `throttle.storage` the same file"
  - "Waiting for another process's lock does not block the event loop"
---

# Several Processes Sharing One SQLite File

Share counters and a lock between several local processes through one SQLite file.

## Code

```bash
yarn add @frontmcp/storage-sqlite better-sqlite3
```

```typescript
// src/tools/claim-reindex.tool.ts
import { SqliteStorageToken, Tool, ToolContext } from '@frontmcp/sdk';
import { randomUUID } from '@frontmcp/utils';

@Tool({
  name: 'claim_reindex',
  description: 'Run the reindex in this process unless another process already holds it',
  inputSchema: {},
})
export class ClaimReindexTool extends ToolContext {
  async execute() {
    const storage = this.get(SqliteStorageToken);
    const token = randomUUID();
    await storage.set('lock:reindex', token, { ifNotExists: true, ttlSeconds: 300 });
    if ((await storage.get('lock:reindex')) !== token) return { claimed: false };
    try {
      // Reindex here, within the 300 s the lock lasts.
      return { claimed: true, claims: await storage.incr('reindex:claims') };
    } finally {
      await storage.deleteIfEquals('lock:reindex', token);
    }
  }
}
```

```typescript
// src/main.ts
import 'reflect-metadata';

import { App, FrontMcp, sqliteStorageProvider } from '@frontmcp/sdk';

import { ClaimReindexTool } from './tools/claim-reindex.tool';

@App({ name: 'indexer', tools: [ClaimReindexTool] })
class IndexerApp {}

@FrontMcp({
  info: { name: 'indexer', version: '0.1.0' },
  apps: [IndexerApp],
  providers: [sqliteStorageProvider({ path: '/var/lib/indexer/state.sqlite', prefix: 'indexer:' })],
})
export default class Server {}
```

```typescript
// scripts/report.ts: the same file from a script, without a server
import { createStorage } from '@frontmcp/utils';

const storage = await createStorage({
  type: 'sqlite',
  sqlite: { path: '/var/lib/indexer/state.sqlite' },
  fallback: 'error',
});
console.log('claims so far:', await storage.get('indexer:reindex:claims'));
await storage.disconnect();
```

## What This Demonstrates

- `sqliteStorageProvider()` registers a SQLite-backed storage that tools read with `this.get(SqliteStorageToken)`
- `incr` stays exact and an `ifNotExists` lock has one holder across processes on the same file
- `createStorage({ type: 'sqlite' })` gives scripts and `throttle.storage` the same file
- Waiting for another process's lock does not block the event loop

## Related

- See `setup-sqlite` for journal modes, busy timeouts and the SDK's own SQLite stores
