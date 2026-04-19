---
name: job-with-permissions
reference: create-job
level: advanced
description: 'A data export job with declarative permission controls, plus a function-style job for simple tasks.'
tags: [development, redis, job, permissions]
features:
  - 'Declarative `permissions` with `actions`, `roles`, `scopes`, and a custom `predicate`'
  - 'Using `tags` and `labels` for categorization and filtering'
  - 'The `job()` function builder for simple jobs that need no class'
  - 'Full server registration with `jobs.enabled: true` and a Redis store'
---

# Job with Permissions, Tags, and Function Builder

A data export job with declarative permission controls, plus a function-style job for simple tasks.

## Code

```typescript
// src/jobs/data-export.job.ts
import { Job, job, JobContext, z } from '@frontmcp/sdk';

@Job({
  name: 'data-export',
  description: 'Export data to external storage',
  inputSchema: {
    dataset: z.string(),
    destination: z.string().url(),
  },
  outputSchema: {
    exportedRows: z.number().int(),
    location: z.string().url(),
  },
  tags: ['export', 'data'],
  labels: { team: 'data-engineering', priority: 'high' },
  permissions: {
    actions: ['create', 'read', 'execute', 'list'],
    roles: ['admin', 'data-engineer'],
    scopes: ['jobs:write', 'data:export'],
    predicate: (ctx) => ctx.user?.department === 'engineering',
  },
})
class DataExportJob extends JobContext {
  async execute(input: { dataset: string; destination: string }) {
    this.log(`Exporting dataset: ${input.dataset}`);
    const rows = await this.exportData(input.dataset, input.destination);
    return { exportedRows: rows, location: input.destination };
  }

  private async exportData(dataset: string, destination: string) {
    return 1000;
  }
}

// Function-style job for simple tasks
const CleanupTempFiles = job({
  name: 'cleanup-temp-files',
  description: 'Remove temporary files older than the specified age',
  inputSchema: {
    directory: z.string().describe('Directory to clean'),
    maxAgeDays: z.number().int().min(1).default(7),
  },
  outputSchema: {
    deleted: z.number().int(),
    freedBytes: z.number().int(),
  },
})((input, ctx) => {
  ctx.log(`Cleaning ${input.directory}, max age: ${input.maxAgeDays} days`);
  ctx.progress(0, 100, 'Scanning directory');

  // ... scan and delete logic ...

  ctx.progress(100, 100, 'Cleanup complete');
  return { deleted: 42, freedBytes: 1024000 };
});
```

```typescript
// src/server.ts
import { App, FrontMcp } from '@frontmcp/sdk';

@App({
  name: 'data-app',
  jobs: [DataExportJob, CleanupTempFiles],
})
class DataApp {}

@FrontMcp({
  info: { name: 'data-server', version: '1.0.0' },
  apps: [DataApp],
  jobs: {
    enabled: true,
    store: {
      redis: {
        provider: 'redis',
        host: 'localhost',
        port: 6379,
        keyPrefix: 'mcp:jobs:',
      },
    },
  },
})
class DataServer {}
```

## What This Demonstrates

- Declarative `permissions` with `actions`, `roles`, `scopes`, and a custom `predicate`
- Using `tags` and `labels` for categorization and filtering
- The `job()` function builder for simple jobs that need no class
- Full server registration with `jobs.enabled: true` and a Redis store

## Related

- See `create-job` for the complete permissions reference and all job registration options
