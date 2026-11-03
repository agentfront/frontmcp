---
name: detached-export-job
reference: create-job
level: advanced
description: 'An export job that runs in a process of its own, survives a server restart and is cancelled from any server.'
tags: [development, job, detached, worker, sqlite, cancel]
features:
  - "`runner: 'detached'`: each run in a process of its own that outlives the server that started it"
  - 'A store the runner and every server share (the top-level `sqlite`), which the runs live in'
  - 'Reading and cancelling a run from a server started after it, and a `cleanup` the runner runs on a cancel'
  - 'Runs whose runner died settled as `interrupted` when the next server boots, with their cleanup'
  - "`runner: 'worker'` for a CPU-heavy job that runs in a worker thread instead"
---

# Detached Export Job

An export job that runs in a process of its own, survives a server restart and is cancelled from any server.

A nightly export takes an hour. It must not stop when the server is redeployed, restarted by a client, or crashes:
the job runs detached, keeps its run in the server's SQLite file, and any server on that file reads, follows or
cancels it.

## Code

```typescript
// src/jobs/export.job.ts
import { Job, JobContext, z, type JobCleanup } from '@frontmcp/sdk';

declare function exportTable(
  table: string,
  options: { signal?: AbortSignal; onBatch: (done: number, total: number) => void },
): Promise<number>;
declare function dropPartialExport(table: string): Promise<void>;

const dropPartial: JobCleanup = async (job) => {
  await dropPartialExport((job.input as { table: string }).table);
};

@Job({
  name: 'export-table',
  inputSchema: { table: z.string() },
  outputSchema: { rows: z.number() },
  runner: 'detached',
  timeout: 0,
  // Read and cancel rules: a server started later answers callers other than the one who started the run
  permissions: [
    { action: 'read', roles: ['ops'] },
    { action: 'delete', roles: ['ops'] },
  ],
  cleanup: { run: dropPartial, timeoutMs: 30_000 },
})
export class ExportTableJob extends JobContext {
  async execute({ table }: { table: string }) {
    const rows = await exportTable(table, {
      signal: this.signal, // a cancel from any server aborts it
      onBatch: (done, total) => void this.progress(done, total, `${done} of ${total} batches`),
    });
    return { rows };
  }
}
```

```typescript
// src/jobs/checksum.job.ts
import { createHash } from 'node:crypto';

import { Job, JobContext, z } from '@frontmcp/sdk';

// CPU-heavy and provider-free: it runs in a worker thread of the server, not on its event loop
@Job({
  name: 'checksum',
  inputSchema: { text: z.string() },
  outputSchema: { sha256: z.string() },
  runner: 'worker',
})
export class ChecksumJob extends JobContext {
  async execute({ text }: { text: string }) {
    return { sha256: createHash('sha256').update(text).digest('hex') };
  }
}
```

```typescript
// src/main.ts
import { App, FrontMcp } from '@frontmcp/sdk';

import { ChecksumJob } from './jobs/checksum.job';
import { ExportTableJob } from './jobs/export.job';

@App({ name: 'exports', jobs: [ExportTableJob, ChecksumJob] })
class ExportsApp {}

@FrontMcp({
  info: { name: 'exports', version: '1.0.0' },
  apps: [ExportsApp],
  // The runners read and write their runs here, as every server on this machine does
  sqlite: { path: '~/.exports/state.sqlite' },
})
export default class ExportsServer {}
```

```typescript
// A client: start an export, then (after the server restarted) follow and cancel it
const started = await client.callTool({
  name: 'execute_job',
  arguments: { name: 'export-table', input: { table: 'orders' } },
});
const { runId, uri } = started.structuredContent as { runId: string; uri: string }; // state: 'pending', at once

// ...the server is redeployed; the export keeps running in its own process...

await client.subscribeResource({ uri }); // the new server reads the run every second and notifies on changes
await client.callTool({ name: 'cancel_job', arguments: { runId } }); // the runner aborts and runs dropPartial
```

## What This Demonstrates

- `runner: 'detached'`: each run in a process of its own that outlives the server that started it
- A store the runner and every server share (the top-level `sqlite`), which the runs live in
- Reading and cancelling a run from a server started after it, and a `cleanup` the runner runs on a cancel
- Runs whose runner died settled as `interrupted` when the next server boots, with their cleanup
- `runner: 'worker'` for a CPU-heavy job that runs in a worker thread instead

## Related

- See `create-job` for the runners, what a detached runner receives, and where it is refused
- See `offload-cpu-work` for the worker pool's rules
