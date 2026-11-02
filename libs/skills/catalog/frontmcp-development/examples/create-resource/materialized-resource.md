---
name: materialized-resource
reference: create-resource
level: intermediate
description: 'A resource serving a stored value that another process updates, with live updates.'
tags: [development, resource, materialized, subscribe, sqlite]
features:
  - 'Declaring a `resourceStore()` on SQLite once, in a module the server and the writers import'
  - 'Serving a key with `@Resource({ from })` and `MaterializedResourceContext`'
  - 'Writing atomically with `set()` and `update()` from a tool and from another process'
  - 'Subscribers get `notifications/resources/updated` on every revision change'
---

# Materialized Resource

A resource serving a stored value that another process updates, with live updates.

## Code

```typescript
// src/board.store.ts -- the one declaration the server and every writer import
import { resourceStore } from '@frontmcp/sdk';

export interface Board {
  open: number;
  note: string;
}

export const boardStore = resourceStore({ storage: { type: 'sqlite', sqlite: { path: '.board/state.sqlite' } } });
export const board = boardStore.key<Board>('board', { initial: { open: 0, note: '' } });
```

```typescript
// src/apps/main/resources/board.resource.ts
import { MaterializedResourceContext, Resource } from '@frontmcp/sdk';

import { board } from '../../../board.store';

@Resource({ name: 'board-status', uri: 'board://status', mimeType: 'application/json', from: board })
export class BoardStatusResource extends MaterializedResourceContext {}
```

```typescript
// src/apps/main/tools/open-ticket.tool.ts
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { board } from '../../../board.store';

@Tool({ name: 'open_ticket', inputSchema: { note: z.string() }, authorities: 'support' })
export class OpenTicketTool extends ToolContext {
  async execute(input: { note: string }) {
    const { revision } = await board.update((current) => ({ open: current.open + 1, note: input.note }));
    return { revision };
  }
}
```

```typescript
// scripts/import-tickets.ts -- another process, run with `tsx scripts/import-tickets.ts`
import { board, boardStore } from '../src/board.store';

await board.set({ open: 12, note: 'imported' });
await boardStore.close();
```

## What This Demonstrates

- Declaring a `resourceStore()` on SQLite once, in a module the server and the writers import
- Serving a key with `@Resource({ from })` and `MaterializedResourceContext`
- Writing atomically with `set()` and `update()` from a tool and from another process
- Subscribers get `notifications/resources/updated` on every revision change

## Notes

- The read returns the value as JSON, with `_meta['frontmcp/materialized'] = { revision, updatedAt }`.
- `update()` runs its change again if another write came first, so keep it pure.
- The server checks `PRAGMA data_version` every 250 ms and announces each key at most once per 50 ms.
- Clients change the board only through the `open_ticket` tool, which applies its own `authorities`.

## Related

- See `create-resource` for the store options, who is told of a change, and the topic API
- See `setup-sqlite` for sharing one SQLite file between processes
