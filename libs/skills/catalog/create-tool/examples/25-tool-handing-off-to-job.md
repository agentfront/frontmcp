---
name: 25-tool-handing-off-to-job
level: advanced
description: 'Thin tool that validates input and enqueues a `@Job` to do the heavy lifting — the right pattern for any operation that takes more than a few seconds.'
tags: [composition, jobs, job-handoff, hideFromDiscovery]
features:
  - 'Splitting a long-running operation into a thin tool (validates, enqueues, returns a tracking handle) plus a `@Job` (does the work)'
  - Returning the job ID + status URL from the tool so the client can poll or stream updates
  - "Using `availableWhen: { surface: ['mcp', 'agent'] }` on the tool while leaving the heavy `@Job` invisible to direct invocation"
  - 'Why this beats running the heavy work inside `execute()` (avoids tool-call timeout limits, lets the job retry independently)'
---

# Tool Handing Off To Job

Thin tool that validates input and enqueues a `@Job` to do the heavy lifting — the right pattern for any operation that takes more than a few seconds.

Tools are for synchronous-ish interactions (≤30s end-to-end). Anything longer should run in a `@Job`, with a thin tool to kick it off.

## Code

```typescript
// src/apps/main/jobs/export-data.job.ts
import { Job, JobContext } from '@frontmcp/sdk';

@Job({
  name: 'export_data',
  description: 'Export a dataset to CSV',
  retry: { maxAttempts: 3, backoff: 'exponential' },
})
export class ExportDataJob extends JobContext {
  async run(args: { datasetId: string; format: 'csv' | 'json' }) {
    await this.progress(0, 100, 'Loading dataset…');
    const rows = await this.loadDataset(args.datasetId);

    await this.progress(50, 100, 'Serializing…');
    const blob = await this.serialize(rows, args.format);

    await this.progress(95, 100, 'Uploading…');
    const downloadUrl = await this.upload(blob);

    await this.progress(100, 100, 'Done');
    return { downloadUrl, rowCount: rows.length };
  }

  private async loadDataset(_id: string) {
    return [{ a: 1 }, { a: 2 }];
  }
  private async serialize(_rows: unknown[], _fmt: string) {
    return Buffer.alloc(0);
  }
  private async upload(_blob: Buffer) {
    return 'https://exports.example/x.csv';
  }
}
```

```typescript
// src/apps/main/tools/export-data.tool.ts
import { ResourceNotFoundError, Tool, ToolContext, z } from '@frontmcp/sdk';

import { DATASETS, JOBS } from '../tokens';

const inputSchema = {
  datasetId: z.string().uuid(),
  format: z.enum(['csv', 'json']).default('csv'),
};
const outputSchema = {
  jobId: z.string(),
  statusUrl: z.string().url(),
  estimatedSeconds: z.number().int(),
};

@Tool({
  name: 'export_data',
  description: 'Start a dataset export — returns a job handle the client can poll',
  inputSchema,
  outputSchema,
  availableWhen: { surface: ['mcp', 'agent'] },
  annotations: { idempotentHint: false, openWorldHint: false },
})
export class ExportDataTool extends ToolContext {
  async execute(input: { datasetId: string; format: 'csv' | 'json' }) {
    // 1. AUTHORIZE BEFORE ENQUEUEING. The job inherits this caller's auth scope at
    //    enqueue time, so an unchecked tool here would let any caller export any
    //    dataset they happen to know the ID of. Concretely: look up the dataset
    //    scoped to the caller's tenant / user identity, fail fast if missing.
    const datasets = this.get(DATASETS);
    const userId = this.auth.user.sub;
    const tenantId = this.auth.claims['tenantId'] as string | undefined;
    const dataset = await datasets.findForUser(input.datasetId, { userId, tenantId });
    if (!dataset) {
      this.fail(new ResourceNotFoundError(`dataset:${input.datasetId}`));
    }

    // 2. Enqueue the job — runs in the caller's auth scope (the job's JobContext
    //    re-checks tenant / user access inside `run()` as a defense-in-depth).
    const jobs = this.get(JOBS);
    const job = await jobs.enqueue('export_data', input, { userId, tenantId });

    // 3. Return a handle the client can poll / stream.
    return {
      jobId: job.id,
      statusUrl: `/jobs/${job.id}`,
      estimatedSeconds: 30,
    };
  }
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { ExportDataJob } from './jobs/export-data.job';
import { ExportDataTool } from './tools/export-data.tool';

@App({
  name: 'main',
  tools: [ExportDataTool],
  jobs: [ExportDataJob],
})
export class MainApp {}
```

## What This Demonstrates

- Splitting a long-running operation into a thin tool (validates, enqueues, returns a tracking handle) plus a `@Job` (does the work)
- Returning the job ID + status URL from the tool so the client can poll or stream updates
- Using `availableWhen: { surface: ['mcp', 'agent'] }` on the tool while leaving the heavy `@Job` invisible to direct invocation
- Why this beats running the heavy work inside `execute()` (avoids tool-call timeout limits, lets the job retry independently)

## Why hand off

| Inside `execute()`                              | Inside a `@Job`                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Capped by the tool's `timeout` (typically ≤30s) | Designed for minutes / hours                                                                  |
| One attempt — fails on transient errors         | Retry config — `maxAttempts`, `backoff`                                                       |
| Progress emits to the current MCP session only  | Job runs independently of the session — can survive disconnects (with a persistent job store) |
| Synchronous from the client's POV               | Asynchronous — client polls `statusUrl` or subscribes to a channel                            |

If the work can take >10 seconds OR needs to survive a session drop OR needs retry-on-failure, it belongs in a job.

See `create-job` for the full job surface — retry, progress, batching, permission scopes.
