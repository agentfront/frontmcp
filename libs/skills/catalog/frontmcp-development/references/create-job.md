---
name: create-job
description: Create long-running background jobs with retry policies, timeouts, cancellation, cleanup, progress tracking, permissions, and runners (inline, worker thread, or a detached process that outlives the server)
---

# Creating Jobs

Jobs are long-running background tasks with built-in retry policies, progress tracking, and permission controls. Unlike tools (which execute synchronously within a request), jobs run asynchronously and persist their state across retries and restarts.

## When to Use This Skill

### Must Use

- Running work that takes longer than a request cycle (ETL pipelines, large imports)
- Tasks that need automatic retry with exponential backoff on failure
- Background operations that must track and report progress over time

### Recommended

- Operations requiring permission controls (role-based, scope-based access)
- Work that must persist state across retries and server restarts

### Skip When

- The work completes in a few seconds and needs no retry or progress tracking (see `create-tool`)
- You need to expose read-only data at a URI (see `create-resource`)
- The task requires autonomous LLM reasoning rather than a deterministic pipeline (see `create-agent`)
- The work runs on a schedule rather than when a client asks: a job has no schedule (see `create-duty`)

> **Decision:** Use this skill when you need a long-running background task with retry policies, progress tracking, or permission controls.

## Class-Based Pattern

Create a class extending `JobContext<In, Out>` and implement the `execute(input: In): Promise<Out>` method. The `@Job` decorator requires `name`, `inputSchema`, and `outputSchema`.

### JobMetadata Fields

| Field          | Type                                 | Required | Default                            | Description                                                                                                                       |
| -------------- | ------------------------------------ | -------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | `string`                             | Yes      | --                                 | Unique job name                                                                                                                   |
| `inputSchema`  | `ZodRawShape`                        | Yes      | --                                 | Zod raw shape for input validation                                                                                                |
| `outputSchema` | `ZodRawShape \| ZodType`             | Yes      | --                                 | Zod schema for output validation                                                                                                  |
| `description`  | `string`                             | No       | --                                 | Human-readable description                                                                                                        |
| `timeout`      | `number`                             | No       | `jobs.defaultTimeoutMs` (`300000`) | How long one attempt may run, in ms; the run ends as `timed_out` when its last attempt did. `0` = no limit                        |
| `cleanup`      | `JobCleanup \| { run, timeoutMs? }`  | No       | --                                 | Runs when an attempt is interrupted, times out or is cancelled (see [Timeouts, Cancel and Cleanup](#timeouts-cancel-and-cleanup)) |
| `runner`       | `'inline' \| 'worker' \| 'detached'` | No       | `jobs.runner` (`'inline'`)         | Where the attempts run (see [Runners](#runners))                                                                                  |
| `retry`        | `RetryPolicy`                        | No       | --                                 | Retry configuration (see below)                                                                                                   |
| `tags`         | `string[]`                           | No       | --                                 | Categorization tags                                                                                                               |
| `labels`       | `Record<string, string>`             | No       | --                                 | Key-value labels for filtering                                                                                                    |
| `permissions`  | `JobPermission[]`                    | No       | --                                 | Array of permission rules. Multiple rules may target the same action; all matching rules must pass                                |

### Basic Example

```typescript
import { Job, JobContext, z } from '@frontmcp/sdk';

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

- `execute(input: In): Promise<Out>` -- the main method you implement. Receives validated input, must return a value matching `outputSchema`: a result that doesn't fails the run with `INVALID_OUTPUT` (not retried, since `execute()` already ran and a retry would repeat its side effects), and fields the schema doesn't declare are stripped.
- `this.progress(pct: number, total?: number, msg?: string)` -- report progress. `pct` is the current value, `total` is the maximum (default 100), `msg` is an optional status message. It is kept on the run record (`progress` on `job://runs/{runId}`, whose subscribers are told) and sent to the caller's session as a progress notification.
- `this.log(message: string)` -- append a log entry to the job's log. Persisted with the job state and retrievable after completion.
- `this.respond(value: Out)` -- end the run with `value` as the job's result (checked against `outputSchema` like a returned one). Alternatively, return the value from `execute()`.
- `this.getLogs(): string[]` -- retrieve all log entries recorded so far.
- `this.get(token)` -- resolve a dependency from DI (throws if not found).
- `this.tryGet(token)` -- resolve a dependency from DI (returns `undefined` if not found).
- `this.fail(err)` -- abort execution, triggers error flow (never returns).
- `this.mark(stage)` -- set the active execution stage for debugging/tracking.
- `this.fetch(input, init?)` -- HTTP fetch with context propagation.

### Properties

- `this.attempt` -- the current attempt number (1-based). On the first run, `this.attempt` is `1`. On the first retry, it is `2`, and so on (up to 1.9.1 it was always `1`).
- `this.get(token)` -- a job declared on an `@App` resolves that app's providers, as the app's tools do (up to 1.9.1 it saw only the server's).
- `this.context`, `this.remember`, `this.featureFlags` and other CONTEXT-scoped providers -- a job started by `execute_job` or `execute_workflow` runs with the caller's request context; a background run gets its own copy (same session, auth and trace, no transport), or a fresh context for the passed auth when the caller had none. Up to 1.9.1 they threw inside a job.
- `this.input` -- the validated input object.
- `this.signal` -- an `AbortSignal` aborted when the attempt stops before it finishes; `signal.reason` says why: `JobTimeoutError` (its `timeout`), `JobCancelledError` (`cancel_job`), `JobInterruptedError` (the server shut down), or a workflow step's `WorkflowJobTimeoutError`. `this.fetch()` is aborted with it. The run ends at once, but `execute()` itself is not stopped, so a long job should pass the signal on or check it, and undo what it leaves in its `cleanup`. Up to 1.10 it was `undefined` outside a workflow step.
- `this.metadata` -- job metadata from the decorator.
- `this.scope` -- the current scope instance.

## Retry Configuration

Configure automatic retries with exponential backoff using the `retry` field.

### RetryPolicy Fields

| Field               | Type     | Default | Description                                          |
| ------------------- | -------- | ------- | ---------------------------------------------------- |
| `maxAttempts`       | `number` | `3`     | Total number of attempts (including the initial run) |
| `backoffMs`         | `number` | `1000`  | Initial delay before the first retry in milliseconds |
| `backoffMultiplier` | `number` | `2`     | Multiplier applied to backoff after each retry       |
| `maxBackoffMs`      | `number` | `60000` | Maximum backoff duration in milliseconds             |

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

With this configuration (`maxAttempts: 5`), if the job fails:

- Attempt 1: immediate execution
- Attempt 2: retry after 2000ms (2s)
- Attempt 3: retry after 4000ms (4s)
- Attempt 4: retry after 8000ms (8s)
- Attempt 5: retry after 16000ms (16s)

The backoff is capped at `maxBackoffMs` (60000ms), so no delay exceeds 60 seconds.

> **Default:** when you omit `retry`, the framework uses `maxAttempts: 3`, `backoffMs: 1000`, `backoffMultiplier: 2`, `maxBackoffMs: 60000` -- i.e., the initial run plus two retries (at ~1s and ~2s).

## Progress Tracking

Use `this.progress(pct, total?, msg?)` to report job progress. The last report is kept on the run (`progress: { progress, total, message }`), so `job://runs/{runId}` shows it and its subscribers get `notifications/resources/updated`; it is also sent to the caller's session as a progress notification.

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

## Timeouts, Cancel and Cleanup

**Timeouts.** Each attempt may run `timeout` ms (the job's own, else `jobs.defaultTimeoutMs`, default `300000`; `0` turns it off). A workflow step takes its own `timeout`, else its job's, else `jobs.defaultTimeoutMs`, with `0` meaning no limit there too. A timeout, a cleanup's `timeoutMs` or `jobs.defaultTimeoutMs` above 2147483647 ms (about 24.8 days, the longest timer Node.js keeps) is refused where it is declared. Past it the attempt is aborted with `JobTimeoutError` (code `JOB_TIMEOUT`): `this.signal` aborts, the job's `cleanup` runs, and the attempt fails. A timeout is retried when `retry` leaves attempts; a run whose last attempt timed out ends as `timed_out`. Up to 1.10 a plain `execute_job` had no timeout at all, although the 5-minute default was documented (only workflow steps applied it): a job that runs longer now sets its own `timeout`, or `0` for none, or the server sets `jobs.defaultTimeoutMs`. The timer starts when `execute()` does, so time spent waiting for [admission](#admission) does not count. The abort does not stop `execute()`: an attempt that ignores `this.signal` keeps running after its run moved on (a retry can start beside it), its result is dropped, and what it reports with `this.progress()` is no longer kept on the run.

**Cancel.** `cancel_job({ runId })` writes the cancel to the job store first, where every process sharing the store reads it, marks the run `cancelled`, and then aborts the run's `this.signal` with `JobCancelledError` (code `JOB_CANCELLED`). A run in another process is aborted within about a second, when that process next reads the store. A cancelled run is never retried, and an inline `execute_job` that is cancelled fails with `JOB_CANCELLED`. Once a cancel is written, the run stays `cancelled` however its attempt ends after it, in this process or another one. The caller who started the run may cancel it, and so may a caller who passes the job's `delete` rule (see [Permissions](#permissions)); for anyone else the run reads as unknown. Refusals carry a remedy:

| Code                      | When                                         | Remedy                               |
| ------------------------- | -------------------------------------------- | ------------------------------------ |
| `JOB_RUN_NOT_FOUND`       | Unknown run, or one the caller may not touch | Use a `runId` `execute_job` returned |
| `JOB_RUN_FINISHED`        | The run already ended                        | `get_job_status` with the `runId`    |
| `JOB_RUN_NOT_CANCELLABLE` | A workflow run (only job runs are cancelled) | `get_workflow_status`                |

**Cleanup.** `@Job({ cleanup })` runs when an attempt is interrupted (`'interrupt'`: the server shut down), times out (`'timeout'`) or is cancelled (`'cancel'`), after `this.signal` aborted, with the attempt's instance. It never runs for an attempt that ends on its own. It has its own time limit (3000 ms, or `{ run, timeoutMs }`), and a cleanup that throws or outlasts it is logged without changing how the run ends. At shutdown every active run is interrupted, runs its cleanup and ends as `interrupted` before the stores close; the shutdown waits for them at most `lifecycle.shutdownHookTimeoutMs` (default 3000 ms), however long a cleanup's own limit is.

```typescript
import { Job, JobContext, z, type JobCleanup } from '@frontmcp/sdk';

declare function removeDirectory(dir: string): Promise<void>;
declare function runBuild(dir: string, options: { signal?: AbortSignal }): Promise<void>;

const removeWorkspace: JobCleanup = async (job, reason) => {
  const { dir } = job.input as { dir: string };
  await removeDirectory(dir); // e.g. kill child processes, delete temp files
  console.warn(`build in ${dir} stopped: ${reason}`);
};

@Job({
  name: 'build-project',
  inputSchema: { dir: z.string() },
  outputSchema: { ok: z.boolean() },
  timeout: 600_000, // 10 minutes per attempt
  cleanup: { run: removeWorkspace, timeoutMs: 10_000 },
})
class BuildProjectJob extends JobContext {
  async execute({ dir }: { dir: string }) {
    await runBuild(dir, { signal: this.signal }); // pass the signal to cancellable work
    return { ok: true };
  }
}
```

## Admission

`@FrontMcp({ jobs: { enabled: true, admission: { concurrency, memoryMb, maxWaitMs } } })` bounds when job attempts (and workflow steps) start in this process: at most `concurrency` run at once, and each claims `memoryMb` of the memory the process may still use (`process.availableMemory()`: the free system memory, or what is left under a container's memory limit), so one starts only once that much is available beyond what the running ones claimed. Waiting attempts start in the order they arrived. One that waits `maxWaitMs` (default `600000`) is refused with `JobAdmissionTimeoutError` (code `JOB_ADMISSION_TIMEOUT`, with a remedy) and not retried: an inline call fails with it, and a background run ends as `failed`. A cancel or shutdown stops the wait. An attempt frees its slot when it ends, however it ends; an attempt aborted by a timeout or a cancel ends at once, so a job that ignores `this.signal` keeps running outside the limits. Admission is the `admit` stage of `jobs:execute-job`, so a hook can observe or replace it.

```typescript
@FrontMcp({
  info: { name: 'ci-server', version: '1.0.0' },
  apps: [CiApp],
  jobs: { enabled: true, admission: { concurrency: 2, memoryMb: 2_048, maxWaitMs: 600_000 } },
})
class CiServer {}
```

## Run Handle and `job://runs/{runId}`

`execute_job` answers with `{ runId, state, uri }`; a background run answers at once with `state: 'pending'` and `uri: 'job://runs/<runId>'`. Reading that resource returns the run as JSON (`runId`, `jobName`, `state`, `attempt`, `maxAttempts`, `startedAt`, `completedAt`, `updatedAt`, `revision`, `progress`, `result`, `error`, `logs`); `resources/subscribe` to it, and every write this process makes to the run (state changes and `this.progress()` reports) sends `notifications/resources/updated`. The same owner and `read` rule as `get_job_status` decide who may read it; a run the caller may not read reads as not found. Run states: `pending`, `running`, `retrying`, then `completed`, `failed`, `cancelled`, `timed_out` or `interrupted`. Each write bumps the record's `revision` and stamps `updatedAt`.

## Runners

`@Job({ runner })`, or `@FrontMcp({ jobs: { enabled: true, runner } })` for the jobs that set none, picks where a job's attempts run. Any other value fails the decorator (`runner must be 'inline', 'worker' or 'detached'`).

| Runner     | Where `execute()` runs                                  | Use for                                                                  |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `inline`   | The server's event loop (the default)                   | Jobs that wait on I/O and use providers                                  |
| `worker`   | A worker thread of the server's offload pool            | CPU-heavy jobs that would block the server                               |
| `detached` | A process of its own that outlives the server's process | Work that must finish after a restart, a deploy or a crash of the server |

**`worker`.** The `jobs:execute-job` flow (permissions, admission, timeout, `cleanup`, the run record) stays on the main thread; only `execute()` moves to a worker of the offload pool (see `offload-cpu-work`), which imports the module that declares the job. The same rules as `this.offload()` apply: the worker has no DI container, scope or request context (`this.get()` and `this.scope` throw `ProviderNotAvailableError`), the worker's environment holds only `offload.env`, and the input and output cross by structured clone. `this.log()` lines reach the run as they do inline, and the latest `this.progress()` is kept on the run every 500 ms at most (and before the outcome), however often the worker reports. A timeout, a cancel or a shutdown terminates the worker, so `execute()` really stops; `this.signal` is not available inside the worker, and `cleanup` runs on the main thread. A bundle that inlines `@frontmcp/sdk` (SEA, `mcpb`, `lambda`, `vercel`) has no module to import and refuses the call with `InvalidOffloadCallError`.

**`detached`.** `execute_job` answers at once with `{ runId, state: 'pending', uri }`, whatever `background` says, and the server starts a process for the run with `spawnOwned`: the server's own command again (`process.execPath`, its `execArgv` without `--inspect`, `--inspect-brk` or `--inspect-wait`, its entry and arguments) in a process group of its own, so stopping the server's group spares it. That process boots the server's config with no transport, no `onReady()` and no service channel connection, runs the run through the same `jobs:execute-job` flow, then exits. The run lives in the job store:

- The runner writes its pid and keeps a heartbeat key in the store (renewed every second, expiring after 30 s by the store's own TTL, so a job that blocks its runner's event loop for less than that is not taken for gone on another host). The progress it reports is written every 500 ms at most; state changes are written at once.
- The run survives the server: a server killed or restarted mid-run leaves it running, and its result lands in the store. Any server on that store reads it (`get_job_status`, `job://runs/{runId}`) and cancels it with `cancel_job`; the runner reads the cancel within 500 ms, aborts `this.signal` and runs `cleanup` itself. A server watches the detached runs it knows of every second, so its `job://runs/{runId}` subscribers and `job-completion` channels hear about them.
- **Reconcile on boot.** A server that boots reads the store for runs left `pending`, `running` or `retrying`. A run whose runner is gone (on this host, its pid no longer runs, so a runner whose event loop is busy is never taken for gone, or it is the booting server's own pid on a run older than that server, as after a container restart; on another host, its heartbeat expired) ends `interrupted` (`JOB_INTERRUPTED`, `its runner is gone`) and its job's `cleanup` runs in that server with reason `'interrupt'`; one process settles each run, however many boot at once. A detached run whose runner never took it over ends `failed` with `JOB_RUNNER_BOOT_FAILED`, as does one whose runner could not boot (it writes the cause itself). A run whose runner is alive is watched until it ends. Inline runs of another live server are left alone. A run another process ended this way keeps that end, however its attempt finishes later, and a runner still alive (a server on another host took it for gone while its event loop was blocked for more than 30 s) aborts its attempt at its next read of the store (every 500 ms; a second for a server's inline run) and runs its `cleanup`.
- **What the runner gets.** The server's environment (it boots the same providers), its argv, `FRONTMCP_RUN_JOB_ID` and the owner tag; the run's input from the store. Nothing of the caller: no access token, headers or session, so `this.auth` is empty in a detached attempt. A job with `execute` permissions cannot run detached, since its attempts would check credentials the runner never receives.
- **Requirements.** A Node server started from its entry (`node dist/main.js`, `frontmcp dev`, a stdio server, a socket daemon) whose entry declares the server with `@FrontMcp` or calls `FrontMcpInstance.bootstrap()`, `runStdio()` or `runUnixSocket()`, and a store other processes share (`jobs.store.sqlite`, a top-level `sqlite`, or Redis). The runner runs that entry again, so code the entry runs before it starts the server runs in the runner too. At boot, a detached job on an edge or browser runtime, on a serverless deployment, or with `execute` permissions fails startup with `JobRunnerUnavailableError` (`JOB_RUNNER_UNAVAILABLE`, with a remedy). A server created any other way (`create()`, `createDirect()`, `connect()`, the generated CLI, `createForGraph()`, a handler) or a memory store refuses the run itself with the same code.
- `jobs.admission` bounds the attempts of one process, and each detached run is a process of its own: admission does not bound how many detached runs run at once.
- Runners carry the `spawnOwned` marker `JOB_WORKER_MARKER` (`'frontmcp-job'`). They are never reaped automatically, since outliving their server is the point; `reapOrphans(JOB_WORKER_MARKER)` from `@frontmcp/utils` stops the ones whose server is gone. SIGTERM interrupts a runner's run, which runs its `cleanup` and ends `interrupted`.

```typescript
import { FrontMcp, Job, JobContext, z } from '@frontmcp/sdk';

declare function exportBucket(
  bucket: string,
  options: { signal?: AbortSignal; onFile: (count: number) => void },
): Promise<number>;
declare function removePartialUpload(bucket: string): Promise<void>;
declare class ExportsApp {}

@Job({
  name: 'export-archive',
  inputSchema: { bucket: z.string() },
  outputSchema: { files: z.number() },
  runner: 'detached',
  timeout: 0,
  permissions: [{ action: 'read' }, { action: 'delete' }],
  cleanup: async (job) => removePartialUpload((job.input as { bucket: string }).bucket),
})
class ExportArchiveJob extends JobContext {
  async execute({ bucket }: { bucket: string }) {
    const files = await exportBucket(bucket, { signal: this.signal, onFile: (n) => this.progress(n) });
    return { files };
  }
}

@FrontMcp({
  info: { name: 'exports', version: '1.0.0' },
  apps: [ExportsApp],
  sqlite: { path: '~/.exports/state.sqlite' }, // the runners read and write runs here
})
class ExportsServer {}
```

## Permissions

Control who can interact with jobs using the `permissions` field. **`permissions` is an array** of rules; each rule grants access to a single `action` and lists the roles, scopes, and/or custom predicate required for that action.

**Requires 1.7.2 or later.** Before 1.7.2 (GHSA-58v2-gpcc-jmqv) the `permissions` array was validated and stored but never evaluated — every job was reachable by every caller who could reach `execute_job`. On older versions do not rely on this field for access control.

Semantics: no rules for an action means allow (the documented default); once any rule targets an action, **all** rules for that action must pass, and `roles`/`scopes` within a single rule are **any-of**. A directly executed job is checked in `JobExecutionManager` when the run starts, before any run record exists (the `execute_job` tool, triggers, background runs); every attempt is then checked again by the `checkJobAuthorization` stage of its `jobs:execute-job` flow, and that is where a job reached as a workflow step is checked against its own rules, so authorizing the workflow does not launder the jobs it references. A denial is not retried. `list_jobs` hides entries the caller could not run, and a denial is indistinguishable from "not found" so restricted job names cannot be enumerated.

### Permission Rule Shape

```typescript
interface JobPermission {
  action: 'create' | 'read' | 'update' | 'delete' | 'execute' | 'list'; // singular!
  roles?: string[]; // caller must have one of these roles
  scopes?: string[]; // token must include one of these scopes
  custom?: (authInfo: Partial<Record<string, unknown>>) => boolean | Promise<boolean>;
}
```

### Permission Actions

| Action    | Description                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `create`  | Submit a new job                                                                                                |
| `read`    | View another caller's runs (`get_job_status`, `job://runs/{runId}`); the caller who started a run always may    |
| `update`  | Modify a running job                                                                                            |
| `delete`  | Cancel another caller's runs (`cancel_job`), or remove a job; the caller who started a run may always cancel it |
| `execute` | Trigger job execution                                                                                           |
| `list`    | List jobs matching filters                                                                                      |

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
  permissions: [
    {
      action: 'execute',
      roles: ['admin', 'data-engineer'],
      scopes: ['jobs:write', 'data:export'],
      custom: (authInfo) => (authInfo as { department?: string }).department === 'engineering',
    },
    { action: 'read', roles: ['admin', 'data-engineer', 'auditor'] },
    { action: 'list', roles: ['admin', 'data-engineer', 'auditor'] },
  ],
})
class DataExportJob extends JobContext {
  async execute(input: { dataset: string; destination: string }) {
    // Only users matching one of the permission rules for this action can run this
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

Within a single rule, `roles`, `scopes`, and `custom` are additive -- all specified conditions must be met, while the list inside `roles` (or `scopes`) is any-of. Add one entry per action. Adding a SECOND entry for the same action makes the check stricter, not looser -- both rules must pass -- so express alternatives as a longer `roles`/`scopes` list within one rule, never as an extra entry:

```typescript
permissions: [
  {
    action: 'execute',
    roles: ['admin', 'operator'],
    scopes: ['jobs:manage'],
    custom: (authInfo) => {
      const user = (authInfo as { user?: { isActive?: boolean; emailVerified?: boolean } }).user;
      return Boolean(user?.isActive && user?.emailVerified);
    },
  },
  { action: 'read', roles: ['admin', 'operator', 'viewer'] },
  { action: 'list', roles: ['admin', 'operator', 'viewer'] },
];
```

## Hooks

Every attempt of a job runs the hookable `jobs:execute-job` flow -- `execute_job` inline or in the background, each retry, each workflow step, and any in-process call of the job execution manager -- so audit, metrics, quota and authorization attach to job runs like to any other entry. Hook it from a plugin or provider with `JobHook` (`FlowHooksOf('jobs:execute-job')`):

```typescript
import { FlowCtxOf, JobHook, Plugin } from '@frontmcp/sdk';

@Plugin({ name: 'job-audit' })
class JobAuditPlugin {
  @JobHook.Did('updateRunState')
  recorded(flowCtx: FlowCtxOf<'jobs:execute-job'>) {
    const { job, attempt, runId, workflow, flowError } = flowCtx.state;
    audit.record({ job: job?.name, attempt, runId, step: workflow?.stepId, ok: !flowError });
  }
}
```

Stages: `parseInput` -> `checkJobAuthorization` -> `validateInput` -> `admit` -> `createJobContext` -> `execute` -> `validateOutput` -> `updateRunState` -> `finalize`, and the error stage `cleanup`, which runs the job's `cleanup` when the attempt failed after it was aborted. `admit` waits for a slot under `jobs.admission`. `updateRunState` writes the attempt to the run record (`completed`, `retrying` or `failed`) and notifies; a workflow step has no run record of its own (`state.runId` unset, `state.workflow` set). One flow run per attempt: a job with `retry.maxAttempts: 3` can run a hook three times per call. A hook that throws fails the attempt (a `JobNotAuthorizedError` is not retried); a hook that calls `flowCtx.respond({ result, logs })` answers for the job and the run records that result, checked against the job's `outputSchema` like a returned one (undeclared fields are dropped; a mismatch fails the attempt with `INVALID_OUTPUT`, not retried; up to 1.9.4 a hook's result skipped the schema). If a hook keeps `updateRunState` from running, or the run store fails its write, the manager records the attempt itself; a store failure never runs a completed job again (if the manager's write fails too, the call fails with the store's error). The hooks of a plugin installed on an app run for that app's jobs only.

A `@Job` class can declare hooks for `jobs:execute-job` itself, which run only for its attempts: instance methods from `createJobContext` on (`Did('createJobContext')`, `Will('execute')`, ...), `static` methods for the earlier stages (`parseInput`, `checkJobAuthorization`, `validateInput`). A hook for another flow fails startup with `InvalidHookFlowError`. Up to 1.9.3 jobs ran outside any flow and any hook on a job class failed startup.

```typescript
@Job({ name: 'export-report', inputSchema: { tenant: z.string() }, outputSchema: { url: z.string() } })
class ExportReportJob extends JobContext {
  @JobHook.Will('checkJobAuthorization')
  static refuseSuspended(flowCtx: FlowCtxOf<'jobs:execute-job'>) {
    const tenant = (flowCtx.state.input as { tenant?: string } | undefined)?.tenant;
    if (tenant && suspendedTenants.has(tenant)) throw new JobNotAuthorizedError('export-report');
  }

  async execute({ tenant }: { tenant: string }) {
    return { url: await exportFor(tenant) };
  }
}
```

## Function Builder

For simple jobs that do not need a class, use the `job()` function builder. The callback receives `(input, ctx)` where `ctx` is the run's `JobContext`, the object a class job reaches as `this`: `ctx.log()`, `ctx.progress()`, `ctx.get()`, `ctx.tryGet()`, `ctx.attempt`, `ctx.signal` and `ctx.respond()` behave as they do in a class. Up to 1.9.0 `log()` and `progress()` were protected, so only a `JobContext` class could call them.

```typescript
import { job, z } from '@frontmcp/sdk';

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
})(async (input, ctx) => {
  ctx.log(`Cleaning ${input.directory}, max age: ${input.maxAgeDays} days`);
  await ctx.progress(0, 100, 'Scanning');

  // ... scan and delete logic ...

  await ctx.progress(100, 100, 'Done');
  return { deleted: 42, freedBytes: 1024000 };
});
```

Register it the same way as a class job: `jobs: [CleanupTempFiles]`.

## Remote and ESM Loading

`Job.esm()` and `Job.remote()` exist, but startup refuses them with `ExternalEntryNotSupportedError`: per-entry `.esm()` and `.remote()` loading covers tools, resources and prompts only. Do not put them in `jobs`; declare the job locally with `@Job` or `job()`. To run work that lives on another server, proxy the tool that server exposes for it with `Tool.remote(url, name)`.

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

**Auto-enable (issue #408):** declaring any `@App({ jobs: [...] })` (or `workflows: [...]`) is enough — the jobs subsystem comes up and the management tools (`execute_job`, `list_jobs`, `get_job_status`, `cancel_job`, `remove_job`) are registered automatically so agents can invoke them. Runs are kept in `jobs.store`, else the server's top-level `redis` (unless it is Vercel KV), else its top-level `sqlite`, else in memory; `jobs.store: false` keeps them in memory whatever the top-level options say. `register_job` is added only when `jobs.allowDynamicRegistration` is `true`. No `@FrontMcp({ jobs: { enabled: true } })` is required for the happy path.

**When to configure `@FrontMcp({ jobs })` explicitly:** pick the store (Redis for multi-replica HA, or a SQLite file the processes on one machine share) so job state, progress, logs, and outputs survive retries and server restarts, and set `defaultTimeoutMs` and `admission`.

```typescript
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [DataApp],
  // A `jobs` block needs `enabled`; `false` opts out and suppresses the tools.
  jobs: {
    enabled: true,
    store: {
      redis: {
        provider: 'redis',
        host: 'localhost',
        port: 6379,
      },
      keyPrefix: 'mcp:jobs:',
    },
  },
})
class MyServer {}
```

For one machine, keep runs in a SQLite file (needs `@frontmcp/storage-sqlite`); a mistake in the block, such as a missing `path`, stops startup instead of falling back to memory, and `store` takes `redis` or `sqlite`, not both:

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [DataApp],
  jobs: {
    enabled: true,
    store: { sqlite: { path: '/var/lib/my-server/jobs.sqlite' } },
    defaultTimeoutMs: 900_000,
  },
})
class MyLocalServer {}
```

A server with a top-level `sqlite` (or `redis`) and no `jobs.store` keeps its runs there too. Up to 1.10 jobs ignored both and stayed in memory. On the top-level `redis`, the jobs' keys start with its `keyPrefix` followed by `jobs:` (`mcp:jobs:` by default; `jobs.store.keyPrefix` overrides it), so servers that share one Redis keep their runs and dynamic job definitions apart once each sets its own `redis.keyPrefix`. In Redis and SQLite a run record expires 24 hours after the run's last write.

`jobs: { enabled: true, store: false }` keeps runs and dynamic definitions in this process memory although the server has a top-level `redis` or `sqlite`, which its other subsystems (sessions, tasks) keep using. `store` takes `false` or an object; any other value stops startup with `jobs.store must be false (runs kept in memory) or an object with redis or sqlite`. A `runner: 'detached'` job needs a store other processes share, so it cannot use `false`. The generated CLI (`frontmcp build --target cli`, `connect(config, { mode: 'cli' })`) validates `jobs` the same way; up to 1.10 it took an invalid `jobs.store` in a config object for unset and kept the runs in the top-level `redis` or `sqlite`, and accepted a `jobs` block without `enabled`.

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [DataApp],
  sqlite: { path: '/var/lib/my-server/sessions.sqlite' }, // sessions and tasks persist here
  jobs: { enabled: true, store: false }, // job runs stay in memory
})
class MemoryJobsServer {}
```

In the browser build (`create()` in a web page, WebMCP), a job store on Redis or SQLite, named in `jobs.store` or taken from the top-level `redis` or `sqlite`, stops startup with `BrowserStoreUnavailableError` (`BROWSER_STORE_UNAVAILABLE`), which names the option; a browser has no TCP socket and no file. Set `jobs.store: false` there.

`store.redis` takes the same connection fields as the server's `redis` option (`host`, `port`, `password`, `db`, `tls`, or a `url` they fill in; a field that contradicts the `url` stops startup), and the job stores connect with all of them. Up to 1.9.2 they used the `url` alone, or `host` and `port` alone, dropping the separate `password`, `db` and `tls` fields, beside a `url` too; values written in the `url` itself were kept.

Setting `jobs: { enabled: false }` is an explicit opt-out — declared jobs will NOT be activated and the framework logs a warning so the configuration mismatch is loud.

### Calling Jobs from an Agent

Once jobs are registered, the SDK exposes six MCP tools (snake_case per ecosystem convention; hyphen aliases like `execute-job` keep working with a deprecation log line for one release):

| Tool             | Purpose                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `list_jobs`      | List registered jobs with optional `tags` / `labels` / `query` filters |
| `execute_job`    | Execute a registered job by name (`{ name, input?, background? }`)     |
| `get_job_status` | Get the run state for a `runId` returned by `execute_job`              |
| `cancel_job`     | Cancel a run by `runId`; its `cleanup` runs (see above)                |
| `register_job`   | Register a dynamic job at runtime — **opt-in**, see below              |
| `remove_job`     | Remove a dynamic job by name (`hideFromDiscovery: true`)               |

Workflows expose a parallel set: `list_workflows`, `execute_workflow`, `get_workflow_status`, `register_workflow`, `remove_workflow`.

`register_job` / `register_workflow` take a **raw script string** and register it as an executable job. Since 1.7.2 they are not registered unless you opt in:

```typescript
@FrontMcp({ jobs: { enabled: true, allowDynamicRegistration: true } })
```

Leave it off unless an agent is genuinely meant to author jobs — with it on, any caller who reaches the tool list can author and run code on the server.

`get_job_status` / `get_workflow_status` (and `job://runs/{runId}`) return runs started by the calling subject, and another caller's runs only when the job or workflow declares a `read` rule the caller passes; a run record carries the job's inputs and results, so any other `runId` reads as "not found".

For finer-grained control, opt out of auto-registration by importing the tool classes manually:

```typescript
import { App, ExecuteJobTool, GetJobStatusTool, ListJobsTool } from '@frontmcp/sdk';

@App({
  name: 'data-app',
  jobs: [GenerateReportJob],
  tools: [ExecuteJobTool, ListJobsTool, GetJobStatusTool], // omit register/remove
})
class DataApp {}
```

The subpaths `@frontmcp/sdk/job/tools` and `@frontmcp/sdk/workflow/tools` export the same classes: they re-export them from the root entry, so `ExecuteJobTool` from either is the class `@frontmcp/sdk` exports, and a subpath import does not make a bundle smaller. Up to 1.10 the subpaths shipped type declarations only, so loading one failed with `MODULE_NOT_FOUND` under `require` and `ERR_MODULE_NOT_FOUND` under `import`; on those versions import the classes from `@frontmcp/sdk`.

## Nx Generator

Scaffold a new job using the Nx generator:

```bash
nx generate @frontmcp/nx:job
```

This creates the job file, spec file, and updates barrel exports.

## Complete Example: Data Pipeline Job

```typescript
import { App, FrontMcp, Job, job, JobContext, z } from '@frontmcp/sdk';

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
  permissions: [
    { action: 'execute', roles: ['admin', 'data-engineer'], scopes: ['jobs:execute', 'data:write'] },
    { action: 'create', roles: ['admin', 'data-engineer'] },
    { action: 'read', roles: ['admin', 'data-engineer'] },
    { action: 'list', roles: ['admin', 'data-engineer'] },
  ],
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
      },
      keyPrefix: 'mcp:jobs:',
    },
  },
})
class DataServer {}
```

## Common Patterns

| Pattern           | Correct                                                                              | Incorrect                                                            | Why                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Progress tracking | `this.progress(50, 100, 'Processing batch 5')`                                       | Not reporting progress                                               | Sent to the caller's session as a progress notification; essential for long-running visibility                                         |
| Retry config      | `retry: { maxAttempts: 3, backoffMs: 2000, backoffMultiplier: 2 }`                   | Implementing retry logic manually in `execute()`                     | Framework handles retry with exponential backoff and attempt tracking                                                                  |
| Attempt awareness | Check `this.attempt` for retry-specific logic                                        | Ignoring attempt number                                              | `this.attempt` is 1-based; use it to log retry context or adjust behavior                                                              |
| Job logging       | `this.log('message')` for persistent, queryable logs                                 | Using `console.log()`                                                | `this.log()` persists with job state; `console.log` is ephemeral                                                                       |
| Stopping work     | Pass `this.signal` to cancellable work and undo leftovers in `cleanup`               | Ignoring `this.signal` in a long `execute()`                         | A timeout or cancel ends the run at once, but `execute()` keeps going unless it reads the signal                                       |
| Watching a run    | `resources/subscribe` to the `uri` `execute_job` returned                            | Polling `get_job_status` in a tight loop                             | Every write to the run sends `notifications/resources/updated` to subscribers                                                          |
| Permissions       | `permissions: [{ action: 'execute', roles: [...] }, ...]` (array, singular `action`) | `permissions: { actions: [...], roles, predicate }` (does not parse) | The schema requires an array of `{ action, roles, scopes, custom }` rules; `actions` plural and top-level `predicate` are not accepted |
| Job hooks         | `@JobHook.Will('execute')` on a plugin, or on the `@Job` class itself                | Hooking `tools:call-tool` for `execute_job`                          | `jobs:execute-job` runs for every attempt, background run and workflow step; the `execute_job` tool's flow sees only the call          |
| CPU-heavy job     | `runner: 'worker'`                                                                   | A tight loop in an inline `execute()`                                | An inline job blocks every other call of the server, `ping` included                                                                   |
| Outliving restart | `runner: 'detached'` with a shared store                                             | A background inline run for work that must survive a deploy          | An inline run ends `interrupted` when its server stops; a detached run keeps going in its own process                                  |

## Verification Checklist

### Configuration

- [ ] Job class extends `JobContext` and implements `execute(input)`
- [ ] `@Job` decorator has `name`, `inputSchema`, and `outputSchema`
- [ ] `retry` policy is configured if the job may fail transiently
- [ ] `timeout` is set appropriately for the expected execution duration (`0` only for work that must never be cut off)
- [ ] A job that starts processes or writes temp files has a `cleanup`, and passes `this.signal` on
- [ ] A `runner: 'worker'` job uses no providers; a `runner: 'detached'` job has no `execute` permissions and a shared store
- [ ] Job is registered in `jobs` array of `@App`

### Runtime

- [ ] Jobs subsystem is active — either implicitly via `@App({ jobs: [...] })`
      (auto-enable, issue #408) or explicitly via `@FrontMcp({ jobs: { enabled: true, store: { ... } } })`
      when overriding the in-memory default
- [ ] Job executes and returns output matching `outputSchema`
- [ ] Progress is reported and queryable during execution
- [ ] Retry fires with correct backoff delays on transient failures
- [ ] Permissions block unauthorized users before execution starts

## Troubleshooting

| Problem                                                 | Cause                                                                                                   | Solution                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Job not activated                                       | `@App` doesn't declare `jobs: [...]` AND `@FrontMcp({ jobs: { enabled: true } })` isn't set             | Add the job class to `@App({ jobs: [...] })` (auto-enables) OR set `@FrontMcp({ jobs: { enabled: true, store: { ... } } })` |
| Job fails without retrying                              | No `retry` policy configured                                                                            | Add `retry: { maxAttempts: 3, backoffMs: 2000 }` to `@Job` options                                                          |
| Progress not visible                                    | Not calling `this.progress()` during execution                                                          | Add `this.progress(pct, total, message)` calls at each stage                                                                |
| Job times out unexpectedly                              | Default 5-minute timeout too short (it applies to `execute_job` since 1.11)                             | Set `timeout` in `@Job` (e.g., `600000`), `jobs.defaultTimeoutMs`, or `0` for no limit                                      |
| `JOB_ADMISSION_TIMEOUT`                                 | `jobs.admission` had no slot (or not enough free memory) within `maxWaitMs`                             | Retry later, run in the background, or raise `concurrency` / `maxWaitMs`                                                    |
| `JOB_RUN_FINISHED`                                      | `cancel_job` on a run that already ended                                                                | Read its outcome with `get_job_status`                                                                                      |
| Run stays `running` after a cancel from another process | That process has no shared store, so it never sees the cancel                                           | Use a shared `jobs.store` (`sqlite` on one machine, `redis` across machines)                                                |
| Permission denied error                                 | User lacks required roles or scopes                                                                     | Verify user has one of the `roles` and all `scopes` defined in `permissions`                                                |
| `JOB_RUNNER_UNAVAILABLE` at startup                     | A detached job on an edge, browser or serverless runtime, or with `execute` permissions                 | Set `runner: 'inline'` (or `'worker'`) on the job, or drop its `execute` permissions                                        |
| `JOB_RUNNER_UNAVAILABLE` from `execute_job`             | A detached job on a server not started from its entry (in process, the generated CLI) or a memory store | Start the server from its entry, and give jobs a shared store (`sqlite` or `redis`)                                         |
| `JOB_RUNNER_BOOT_FAILED`                                | The detached runner could not boot the server, or exited before it took the run over                    | Check that the entry starts the server; the error's message names the cause                                                 |
| Detached run `interrupted`: `its runner is gone`        | Its process died (killed, out of memory, machine restart) and a server reconciled the store             | Its `cleanup` ran in that server; run the job again                                                                         |

## Examples

| Example                                                                  | Level        | Description                                                                                                        |
| ------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| [`basic-report-job`](../examples/create-job/basic-report-job.md)         | Basic        | A minimal job that generates a report with progress tracking and structured output.                                |
| [`job-with-permissions`](../examples/create-job/job-with-permissions.md) | Advanced     | A data export job with declarative permission controls, plus a function-style job for simple tasks.                |
| [`job-with-retry`](../examples/create-job/job-with-retry.md)             | Intermediate | A job that syncs data from an external API with automatic retry, exponential backoff, and batch progress tracking. |
| [`durable-build-job`](../examples/create-job/durable-build-job.md)       | Advanced     | A build job on a SQLite store with a timeout, a cleanup, admission limits, cancel and a subscribed run handle.     |
| [`detached-export-job`](../examples/create-job/detached-export-job.md)   | Advanced     | An export job that runs in a process of its own, survives a server restart and is cancelled from any server.       |

> See all examples in [`examples/create-job/`](../examples/create-job/)

## Reference

- [Jobs Documentation](https://frontmcp.dev/reference/sdk/job)
- Related skills: `create-tool`, `create-provider`, `create-agent`, `create-workflow`
