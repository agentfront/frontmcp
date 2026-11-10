---
name: local-daemon-worker-and-cron
reference: create-event
level: intermediate
description: 'A local daemon whose folder-watching worker and cron duty publish events that local clients poll or stream.'
tags: [development, event, worker, duty, cron, watch-files, poll]
features:
  - 'Publishing from a `@Worker` that loops over `watchFiles()`'
  - 'Publishing from a cron `@Duty`'
  - 'Injecting the publisher with the `EVENT_PUBLISHER` token in an `AsyncProvider`'
  - 'Filtering a subscription with `match()` and its arguments'
  - 'A local server in public auth mode, which offers events by poll and push'
---

# Local Daemon: a Folder Watcher and a Schedule

A local daemon whose folder-watching worker and cron duty publish events that local clients poll or stream.

A server that runs on your machine. A worker publishes `file.dropped` for each file that appears or changes in a
folder; a cron duty publishes `folder.summary`. Local clients read both with `events/poll` or `events/stream`. The
runnable app, with a smoke test, is `apps/e2e/demo-e2e-events-daemon` in the FrontMCP repository.

## Code

```typescript
// src/apps/daemon/events/file-dropped.event.ts
import { event, z } from '@frontmcp/sdk';

export const fileDropped = event({
  name: 'file.dropped',
  description: 'A file appeared or changed in the drop folder',
  inputSchema: { extension: z.string().optional().describe('Only files with this extension, such as ".pdf"') },
  payloadSchema: { name: z.string(), change: z.enum(['add', 'change']) },
  match: (occurrence, args) => args.extension === undefined || occurrence.data.name.endsWith(args.extension),
});
```

```typescript
// src/apps/daemon/sources/drop-folder.worker.ts
import * as path from 'node:path';

import {
  AsyncProvider,
  EVENT_PUBLISHER,
  Worker,
  type EventPublisher,
  type WorkerInterface,
  type WorkerRunContext,
} from '@frontmcp/sdk';
import { watchFiles } from '@frontmcp/utils';

@Worker({ name: 'drop-folder-watcher', scope: 'machine' })
class DropFolderWatcher implements WorkerInterface {
  constructor(private readonly events: EventPublisher) {}

  async run({ signal }: WorkerRunContext): Promise<void> {
    for await (const { type, path: filePath } of watchFiles(dropFolder, { events: ['add', 'change'], signal })) {
      await this.events.publish(fileDropped, { name: path.basename(filePath), change: type as 'add' | 'change' });
    }
  }
}

export const dropFolderWatcher = AsyncProvider({
  provide: DropFolderWatcher,
  name: 'drop-folder-watcher',
  inject: () => [EVENT_PUBLISHER] as const,
  useFactory: (events) => new DropFolderWatcher(events),
});
```

```typescript
// src/apps/daemon/sources/folder-summary.duty.ts
@Duty({ name: 'folder-summary', cron: '0 9 * * *', scope: 'machine' })
class FolderSummaryDuty implements DutyInterface {
  constructor(private readonly events: EventPublisher) {}

  async run(): Promise<void> {
    const files = await readdir(dropFolder).catch(() => []);
    await this.events.publish(folderSummary, { fileCount: files.length, at: new Date().toISOString() });
  }
}
```

```typescript
// src/apps/daemon/index.ts and src/main.ts (excerpts)
@App({ name: 'daemon', events: [fileDropped, folderSummary], providers: [dropFolderWatcher, folderSummaryDuty] })
export class DaemonApp {}

@FrontMcp({ info: { name: 'Drop Folder Daemon', version: '0.1.0' }, apps: [DaemonApp], auth: { mode: 'public' } })
export default class Server {}
```

## What This Demonstrates

- Publishing from a `@Worker` that loops over `watchFiles()`
- Publishing from a cron `@Duty`
- Injecting the publisher with the `EVENT_PUBLISHER` token in an `AsyncProvider`
- Filtering a subscription with `match()` and its arguments
- A local server in public auth mode, which offers events by poll and push

## Notes

- Workers and duties publish with the `EventPublisher` they get in their constructor. Under `tsx` or esbuild, which
  emit no constructor types, an `AsyncProvider` injects the `EVENT_PUBLISHER` token.
- `watchFiles()` ends when the worker's `signal` aborts; files already in the folder at startup are not reported.
- In public auth mode the server offers its events by `poll` and `push`. Webhook delivery needs callers who sign in.
- ChatGPT subscribes by webhook only, over the internet: it needs the server at a public HTTPS address and an auth
  mode that signs callers in. No tunnel is part of this example.

## Related

- See `create-event` for polling and streaming, `create-worker` for `watchFiles`, and `create-duty` for cron
