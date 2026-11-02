---
name: durable-build-job
reference: create-job
level: advanced
description: 'A build job on a SQLite store with a timeout, a cleanup, admission limits, cancel and a subscribed run handle.'
tags: [development, job, sqlite, cancel, timeout]
features:
  - 'Keeping runs in a SQLite file with `jobs.store.sqlite`, shared by the processes on one machine'
  - 'A per-attempt `timeout`, and `@Job({ cleanup })` that runs on a timeout, a cancel or a shutdown'
  - 'Passing `this.signal` to the work so a timeout or cancel stops it'
  - '`jobs.admission` with `concurrency`, `memoryMb` and `maxWaitMs`'
  - 'Cancelling with `cancel_job`, and following progress on `job://runs/{runId}`'
---

# Durable Build Job

A build job on a SQLite store with a timeout, a cleanup, admission limits, cancel and a subscribed run handle.

Each attempt has a time limit, its cleanup kills what it started, at most two builds run at once, and a client follows a run on its `job://runs/{runId}` resource or cancels it with `cancel_job`.

## Code

```typescript
// src/jobs/build.job.ts
import { spawn } from 'node:child_process';

import { Job, JobContext, z, type JobCleanup } from '@frontmcp/sdk';

/** The build process each attempt started, by working directory. */
const builds = new Map<string, ReturnType<typeof spawn>>();

const stopBuild: JobCleanup = (job, reason) => {
  const { dir } = job.input as { dir: string };
  builds.get(dir)?.kill('SIGTERM');
  builds.delete(dir);
  console.warn(`build in ${dir} stopped: ${reason}`);
};

@Job({
  name: 'build',
  description: 'Build a project and report each stage',
  inputSchema: { dir: z.string().describe('Project directory') },
  outputSchema: { stages: z.array(z.string()) },
  timeout: 900_000, // 15 minutes per attempt
  retry: { maxAttempts: 2, backoffMs: 5_000 },
  cleanup: { run: stopBuild, timeoutMs: 10_000 },
})
export class BuildJob extends JobContext {
  async execute({ dir }: { dir: string }) {
    const stages = ['typecheck', 'lint', 'test'];
    for (const [index, stage] of stages.entries()) {
      await this.progress(index, stages.length, `running ${stage}`);
      await this.run(dir, stage);
    }
    await this.progress(stages.length, stages.length, 'done');
    return { stages };
  }

  private run(dir: string, stage: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // The signal aborts on a timeout, a cancel or a shutdown, which kills the child too
      const child = spawn('npm', ['run', stage], { cwd: dir, signal: this.signal });
      builds.set(dir, child);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${stage} exited with ${code}`))));
      child.on('error', reject);
    });
  }
}
```

```typescript
// src/main.ts
import { App, FrontMcp } from '@frontmcp/sdk';

import { BuildJob } from './jobs/build.job';

@App({ name: 'ci', jobs: [BuildJob] })
class CiApp {}

@FrontMcp({
  info: { name: 'ci-server', version: '1.0.0' },
  apps: [CiApp],
  jobs: {
    enabled: true,
    store: { sqlite: { path: '/var/lib/ci-server/jobs.sqlite' } },
    admission: { concurrency: 2, memoryMb: 2_048, maxWaitMs: 600_000 },
  },
})
export default class CiServer {}
```

```typescript
// A client: start a background build, follow it, and cancel it
const started = await client.callTool({
  name: 'execute_job',
  arguments: { name: 'build', input: { dir: '/work/app' }, background: true },
});
const { runId, uri } = started.structuredContent as { runId: string; uri: string };

await client.subscribeResource({ uri }); // notifications/resources/updated on each progress report
const run = await client.readResource({ uri }); // { state, progress, revision, updatedAt, ... }

await client.callTool({ name: 'cancel_job', arguments: { runId } }); // the cleanup kills the build
```

## What This Demonstrates

- Keeping runs in a SQLite file with `jobs.store.sqlite`, shared by the processes on one machine
- A per-attempt `timeout`, and `@Job({ cleanup })` that runs on a timeout, a cancel or a shutdown
- Passing `this.signal` to the work so a timeout or cancel stops it
- `jobs.admission` with `concurrency`, `memoryMb` and `maxWaitMs`
- Cancelling with `cancel_job`, and following progress on `job://runs/{runId}`

## Related

- See `create-job` for the timeout, cancel, cleanup and admission rules
