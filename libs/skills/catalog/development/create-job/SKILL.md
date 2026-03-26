---
name: create-job
description: Create long-running jobs with retry policies, progress tracking, and permission controls. Use when building background tasks, data processing pipelines, or scheduled operations.
tags: [job, background, retry, progress, long-running]
priority: 6
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/servers/jobs
---

# Creating Jobs

Jobs are long-running background tasks with built-in retry policies, progress tracking, and permission controls. Unlike tools (which execute synchronously within a request), jobs run asynchronously and persist their state across retries and restarts.

## When to Use @Job

Use `@Job` when you need to run work that may take longer than a request cycle, needs retry guarantees, or should track progress over time. Examples include:

- Data processing and ETL pipelines
- File imports and exports
- Report generation
- Scheduled maintenance tasks
- External API synchronization

If the work completes in under a few seconds and does not need retry or progress tracking, use a `@Tool` instead.

## Class-Based Pattern

Create a class extending `JobContext<In, Out>` and implement the `execute(input: In): Promise<Out>` method. The `@Job` decorator requires `name`, `inputSchema`, and `outputSchema`.

### JobMetadata Fields

| Field          | Type                     | Required | Default          | Description                            |
| -------------- | ------------------------ | -------- | ---------------- | -------------------------------------- |
| `name`         | `string`                 | Yes      | --               | Unique job name                        |
| `inputSchema`  | `ZodRawShape`            | Yes      | --               | Zod raw shape for input validation     |
| `outputSchema` | `ZodRawShape \| ZodType` | Yes      | --               | Zod schema for output validation       |
| `description`  | `string`                 | No       | --               | Human-readable description             |
| `timeout`      | `number`                 | No       | `300000` (5 min) | Maximum execution time in milliseconds |
| `retry`        | `RetryPolicy`            | No       | --               | Retry configuration (see below)        |
| `tags`         | `string[]`               | No       | --               | Categorization tags                    |
| `labels`       | `Record<string, string>` | No       | --               | Key-value labels for filtering         |
| `permissions`  | `JobPermissions`         | No       | --               | Access control configuration           |

### Basic Example

```typescript
import { Job, JobContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Job({
  name: 'generate-report',
  description: 'Generate a PDF report from data',
  inputSchema: {
    reportType: z.enum(['sales', 'inventory', 'users']).describe('Type of report'),
    dateRange: z.object({
      from: z.string().describe('Start date (ISO 8601)'),
      to: z.string().describe('End date (ISO 8601)'),
    }),
    format: z.enum(['pdf', 'csv']).default('pdf').describe('Output format'),
  },
  outputSchema: {
    url: z.string().url(),
    pageCount: z.number().int(),
    generatedAt: z.string(),
  },
  timeout: 120000,
})
class GenerateReportJob extends JobContext {
  async execute(input: {
    reportType: 'sales' | 'inventory' | 'users';
    dateRange: { from: string; to: string };
    format: 'pdf' | 'csv';
  }) {
    this.log(`Starting ${input.reportType} report generation`);

    this.progress(10, 100, 'Fetching data');
    const data = await this.fetchReportData(input.reportType, input.dateRange);

    this.progress(50, 100, 'Generating document');
    const document = await this.buildDocument(data, input.format);

    this.progress(90, 100, 'Uploading');
    const url = await this.uploadDocument(document);

    this.progress(100, 100, 'Complete');
    return {
      url,
      pageCount: document.pages,
      generatedAt: new Date().toISOString(),
    };
  }

  private async fetchReportData(type: string, range: { from: string; to: string }) {
    return { rows: [], count: 0 };
  }
  private async buildDocument(data: unknown, format: string) {
    return { pages: 5, buffer: Buffer.alloc(0) };
  }
  private async uploadDocument(doc: { buffer: Buffer }) {
    return 'https://storage.example.com/reports/report-001.pdf';
  }
}
```

## JobContext Methods and Properties

`JobContext` extends `ExecutionContextBase` and adds job-specific capabilities:

### Methods

- `execute(input: In): Promise<Out>` -- the main method you implement. Receives validated input, must return a value matching `outputSchema`.
- `this.progress(pct: number, total?: number, msg?: string)` -- report progress. `pct` is the current value, `total` is the maximum (default 100), `msg` is an optional status message.
- `this.log(message: string)` -- append a log entry to the job's log. Persisted with the job state and retrievable after completion.
- `this.respond(value: Out)` -- explicitly set the job output. Alternatively, return the value from `execute()`.
- `this.getLogs(): string[]` -- retrieve all log entries recorded so far.
- `this.get(token)` -- resolve a dependency from DI (throws if not found).
- `this.tryGet(token)` -- resolve a dependency from DI (returns `undefined` if not found).
- `this.fail(err)` -- abort execution, triggers error flow (never returns).
- `this.mark(stage)` -- set the active execution stage for debugging/tracking.
- `this.fetch(input, init?)` -- HTTP fetch with context propagation.

### Properties

- `this.attempt` -- the current attempt number (1-based). On the first run, `this.attempt` is `1`. On the first retry, it is `2`, and so on.
- `this.input` -- the validated input object.
- `this.metadata` -- job metadata from the decorator.
- `this.scope` -- the current scope instance.

## Retry Configuration

Configure automatic retries with exponential backoff using the `retry` field.

### RetryPolicy Fields

| Field               | Type     | Default | Description                                          |
| ------------------- | -------- | ------- | ---------------------------------------------------- |
| `maxAttempts`       | `number` | `1`     | Total number of attempts (including the initial run) |
| `backoffMs`         | `number` | `1000`  | Initial delay before the first retry in milliseconds |
| `backoffMultiplier` | `number` | `2`     | Multiplier applied to backoff after each retry       |
| `maxBackoffMs`      | `number` | `30000` | Maximum backoff duration in milliseconds             |

### Example with Retry

```typescript
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

With this configuration, if the job fails:

- Attempt 1: immediate execution
- Attempt 2: retry after 2000ms
- Attempt 3: retry after 4000ms
- Attempt 4: retry after 8000ms
- Attempt 5: retry after 16000ms

The backoff is capped at `maxBackoffMs` (60000ms), so no delay exceeds 60 seconds.

## Progress Tracking

Use `this.progress(pct, total?, msg?)` to report job progress. The framework persists progress and makes it queryable.

```typescript
@Job({
  name: 'import-csv',
  description: 'Import records from a CSV file',
  inputSchema: {
    fileUrl: z.string().url(),
    tableName: z.string(),
  },
  outputSchema: {
    imported: z.number().int(),
    skipped: z.number().int(),
  },
})
class ImportCsvJob extends JobContext {
  async execute(input: { fileUrl: string; tableName: string }) {
    this.progress(0, 100, 'Downloading file');
    const rows = await this.downloadAndParse(input.fileUrl);

    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      this.progress(i + 1, rows.length, `Importing row ${i + 1} of ${rows.length}`);

      try {
        await this.insertRow(input.tableName, rows[i]);
        imported++;
      } catch {
        skipped++;
      }
    }

    this.log(`Import complete: ${imported} imported, ${skipped} skipped`);
    return { imported, skipped };
  }

  private async downloadAndParse(url: string) {
    return [];
  }
  private async insertRow(table: string, row: unknown) {
    /* insert */
  }
}
```

## Permissions

Control who can interact with jobs using the `permissions` field. Permissions support action-based access, roles, scopes, and custom predicates.

### Permission Actions

| Action    | Description                |
| --------- | -------------------------- |
| `create`  | Submit a new job           |
| `read`    | View job status and output |
| `update`  | Modify a running job       |
| `delete`  | Cancel or remove a job     |
| `execute` | Trigger job execution      |
| `list`    | List jobs matching filters |

### Permission Configuration

```typescript
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
  permissions: {
    actions: ['create', 'read', 'execute', 'list'],
    roles: ['admin', 'data-engineer'],
    scopes: ['jobs:write', 'data:export'],
    predicate: (ctx) => ctx.user?.department === 'engineering',
  },
})
class DataExportJob extends JobContext {
  async execute(input: { dataset: string; destination: string }) {
    // Only users with the right roles, scopes, or matching the predicate can run this
    this.log(`Exporting dataset: ${input.dataset}`);
    const rows = await this.exportData(input.dataset, input.destination);
    return { exportedRows: rows, location: input.destination };
  }

  private async exportData(dataset: string, destination: string) {
    return 1000;
  }
}
```

### Combining Permission Strategies

Permissions fields are additive -- all specified conditions must be met:

```typescript
permissions: {
  // Actions this job supports
  actions: ['create', 'read', 'execute', 'delete', 'list'],

  // Role-based: user must have one of these roles
  roles: ['admin', 'operator'],

  // Scope-based: user token must include these scopes
  scopes: ['jobs:manage'],

  // Custom predicate: arbitrary logic
  predicate: (ctx) => {
    const user = ctx.user;
    return user?.isActive && user?.emailVerified;
  },
}
```

## Function Builder

For simple jobs that do not need a class, use the `job()` function builder. The callback receives `(input, ctx)` where `ctx` provides all `JobContext` methods.

```typescript
import { job } from '@frontmcp/sdk';
import { z } from 'zod';

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

Register it the same way as a class job: `jobs: [CleanupTempFiles]`.

## Remote and ESM Loading

Load jobs from external modules or remote URLs without importing them directly.

**ESM loading** -- load a job from an ES module:

```typescript
const ExternalJob = Job.esm('@my-org/jobs@^1.0.0', 'ExternalJob', {
  description: 'A job loaded from an ES module',
});
```

**Remote loading** -- load a job from a remote URL:

```typescript
const CloudJob = Job.remote('https://example.com/jobs/cloud-job', 'CloudJob', {
  description: 'A job loaded from a remote server',
});
```

Both return values that can be registered in `jobs: [ExternalJob, CloudJob]`.

## Registration and Configuration

### Registering Jobs

Add job classes (or function-style jobs) to the `jobs` array in `@App`.

```typescript
import { App } from '@frontmcp/sdk';

@App({
  name: 'data-app',
  jobs: [GenerateReportJob, SyncExternalApiJob, ImportCsvJob, CleanupTempFiles],
})
class DataApp {}
```

### Enabling the Jobs System

Jobs require a persistent store for state management. Enable the jobs system in `@FrontMcp` configuration.

```typescript
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
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
class MyServer {}
```

The store persists job state, progress, logs, and outputs across retries and server restarts. Redis is recommended for production. Without `jobs.enabled: true`, registered jobs will not be activated.

## Nx Generator

Scaffold a new job using the Nx generator:

```bash
nx generate @frontmcp/nx:job
```

This creates the job file, spec file, and updates barrel exports.

## Complete Example: Data Pipeline Job

```typescript
import { Job, JobContext, FrontMcp, App, job } from '@frontmcp/sdk';
import { z } from 'zod';

@Job({
  name: 'etl-pipeline',
  description: 'Extract, transform, and load data from source to warehouse',
  inputSchema: {
    source: z.string().url().describe('Source data URL'),
    destination: z.string().describe('Destination table name'),
    transformations: z
      .array(z.enum(['normalize', 'deduplicate', 'validate', 'enrich']))
      .default(['normalize', 'validate']),
  },
  outputSchema: {
    extracted: z.number().int(),
    transformed: z.number().int(),
    loaded: z.number().int(),
    errors: z.array(
      z.object({
        row: z.number(),
        message: z.string(),
      }),
    ),
    duration: z.number(),
  },
  timeout: 900000, // 15 minutes
  retry: {
    maxAttempts: 3,
    backoffMs: 5000,
    backoffMultiplier: 2,
    maxBackoffMs: 30000,
  },
  tags: ['etl', 'data-pipeline'],
  labels: { team: 'data-engineering', priority: 'high' },
  permissions: {
    actions: ['create', 'read', 'execute', 'list'],
    roles: ['admin', 'data-engineer'],
    scopes: ['jobs:execute', 'data:write'],
  },
})
class EtlPipelineJob extends JobContext {
  async execute(input: {
    source: string;
    destination: string;
    transformations: ('normalize' | 'deduplicate' | 'validate' | 'enrich')[];
  }) {
    const startTime = Date.now();
    const errors: { row: number; message: string }[] = [];

    this.log(`Attempt ${this.attempt}: Starting ETL pipeline`);
    this.log(`Source: ${input.source}, Destination: ${input.destination}`);

    // Extract
    this.progress(0, 100, 'Extracting data');
    this.mark('extract');
    const rawData = await this.extract(input.source);
    this.log(`Extracted ${rawData.length} records`);

    // Transform
    this.progress(33, 100, 'Applying transformations');
    this.mark('transform');
    let transformed = rawData;
    for (const t of input.transformations) {
      transformed = await this.applyTransformation(transformed, t, errors);
    }
    this.log(`Transformed ${transformed.length} records (${errors.length} errors)`);

    // Load
    this.progress(66, 100, 'Loading into warehouse');
    this.mark('load');
    const loaded = await this.load(input.destination, transformed);
    this.log(`Loaded ${loaded} records into ${input.destination}`);

    this.progress(100, 100, 'Pipeline complete');
    const logs = this.getLogs();
    this.log(`Total log entries: ${logs.length}`);

    return {
      extracted: rawData.length,
      transformed: transformed.length,
      loaded,
      errors,
      duration: Date.now() - startTime,
    };
  }

  private async extract(source: string): Promise<unknown[]> {
    return [];
  }
  private async applyTransformation(
    data: unknown[],
    type: string,
    errors: { row: number; message: string }[],
  ): Promise<unknown[]> {
    return data;
  }
  private async load(table: string, data: unknown[]): Promise<number> {
    return data.length;
  }
}

@App({
  name: 'data-app',
  jobs: [EtlPipelineJob],
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
