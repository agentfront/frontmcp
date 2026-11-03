import { appendFileSync } from 'node:fs';
import { isMainThread } from 'node:worker_threads';

import { z } from '@frontmcp/lazy-zod';
import { Job, JobContext, type JobCleanup, type JobPermission } from '@frontmcp/sdk';

/** Any caller may read and cancel these runs: each test client is a different anonymous user. */
const anyone: JobPermission[] = [{ action: 'read' }, { action: 'delete' }];

/** Append `<tag>:<event>:<pid>` to the file the test reads, from whichever process runs the job. */
function record(tag: string, event: string): void {
  const events = process.env['JOBS_EVENTS_PATH'];
  if (events) appendFileSync(events, `${tag}:${event}:${process.pid}\n`);
}

const recordCleanup: JobCleanup = (job, reason) => {
  record((job.input as { tag: string }).tag, `cleanup:${reason}`);
};

@Job({
  name: 'slow-count',
  description: 'Counts `steps` steps, `stepMs` apart, reporting each one as progress',
  inputSchema: { tag: z.string(), steps: z.number().int().positive(), stepMs: z.number().int().nonnegative() },
  outputSchema: { counted: z.number(), pid: z.number() },
  timeout: 0,
  permissions: anyone,
})
export class SlowCountJob extends JobContext {
  async execute({ tag, steps, stepMs }: { tag: string; steps: number; stepMs: number }) {
    record(tag, 'started');
    for (let step = 1; step <= steps; step++) {
      await new Promise((resolve) => setTimeout(resolve, stepMs));
      await this.progress(step, steps, `step ${step}`);
    }
    return { counted: steps, pid: process.pid };
  }
}

@Job({
  name: 'wait-for-cancel',
  description: 'Runs until it is cancelled or interrupted',
  inputSchema: { tag: z.string() },
  outputSchema: {},
  timeout: 0,
  permissions: anyone,
  cleanup: recordCleanup,
})
export class WaitForCancelJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    record(tag, 'started');
    await new Promise((resolve) => this.signal?.addEventListener('abort', resolve, { once: true }));
    return {};
  }
}

@Job({
  name: 'crunch-in-worker',
  description: 'Doubles a number in a worker thread of the server',
  inputSchema: { n: z.number() },
  outputSchema: { doubled: z.number(), isMainThread: z.boolean(), pid: z.number() },
  runner: 'worker',
})
export class CrunchInWorkerJob extends JobContext {
  async execute({ n }: { n: number }) {
    await this.progress(1, 1, 'crunched');
    return { doubled: n * 2, isMainThread, pid: process.pid };
  }
}
