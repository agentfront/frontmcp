---
name: job-with-retry
reference: create-job
level: intermediate
description: 'A job that syncs data from an external API with automatic retry, exponential backoff, and batch progress tracking.'
tags: [development, job, retry]
features:
  - 'Configuring `retry` with `maxAttempts`, `backoffMs`, `backoffMultiplier`, and `maxBackoffMs`'
  - 'Using `this.attempt` to log retry context (1-based attempt counter)'
  - 'Using `this.fail()` to abort execution and trigger the retry flow'
  - 'Combining batch processing with `this.progress()` for granular tracking'
---

# Job with Retry Policy and Batch Processing

A job that syncs data from an external API with automatic retry, exponential backoff, and batch progress tracking.

## Code

```typescript
// src/jobs/sync-external-api.job.ts
import { Job, JobContext, z } from '@frontmcp/sdk';

@Job({
  name: 'sync-external-api',
  description: 'Synchronize data from an external API',
  inputSchema: {
    endpoint: z.string().url().describe('API endpoint to sync from'),
    batchSize: z.number().int().min(1).max(1000).default(100),
  },
  outputSchema: {
    synced: z.number().int(),
    errors: z.number().int(),
  },
  timeout: 600000, // 10 minutes
  retry: {
    maxAttempts: 5,
    backoffMs: 2000,
    backoffMultiplier: 2,
    maxBackoffMs: 60000,
  },
})
class SyncExternalApiJob extends JobContext {
  async execute(input: { endpoint: string; batchSize: number }) {
    this.log(`Attempt ${this.attempt}: syncing from ${input.endpoint}`);

    const response = await this.fetch(input.endpoint);
    if (!response.ok) {
      this.fail(new Error(`API returned ${response.status}`));
    }

    const data = await response.json();
    let synced = 0;
    let errors = 0;

    for (let i = 0; i < data.items.length; i += input.batchSize) {
      const batch = data.items.slice(i, i + input.batchSize);
      this.progress(i, data.items.length, `Processing batch ${Math.floor(i / input.batchSize) + 1}`);

      try {
        await this.processBatch(batch);
        synced += batch.length;
      } catch (err) {
        errors += batch.length;
        this.log(`Batch error: ${err}`);
      }
    }

    return { synced, errors };
  }

  private async processBatch(batch: unknown[]) {
    // process batch
  }
}
```

## What This Demonstrates

- Configuring `retry` with `maxAttempts`, `backoffMs`, `backoffMultiplier`, and `maxBackoffMs`
- Using `this.attempt` to log retry context (1-based attempt counter)
- Using `this.fail()` to abort execution and trigger the retry flow
- Combining batch processing with `this.progress()` for granular tracking

## Related

- See `create-job` for the full retry policy reference and backoff schedule
