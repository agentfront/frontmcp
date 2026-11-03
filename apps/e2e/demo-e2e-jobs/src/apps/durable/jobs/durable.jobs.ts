import { z } from '@frontmcp/lazy-zod';
import { Job, JobContext, type JobCleanup } from '@frontmcp/sdk';

/** What each attempt did: `<tag>:started`, and `<tag>:<reason>` when its cleanup ran. */
export const durableLog: string[] = [];

const logCleanup: JobCleanup = (job, reason) => {
  durableLog.push(`${(job.input as { tag: string }).tag}:${reason}`);
};

const tagged = { tag: z.string().describe('A label the log entries carry') };

@Job({
  name: 'wait-for-cancel',
  description: 'Runs until it is cancelled or interrupted',
  inputSchema: tagged,
  outputSchema: {},
  timeout: 0,
  cleanup: logCleanup,
})
export class WaitForCancelJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    durableLog.push(`${tag}:started`);
    return new Promise(() => undefined);
  }
}

@Job({
  name: 'outlast-timeout',
  description: 'Never finishes, so its 200 ms timeout ends it',
  inputSchema: tagged,
  outputSchema: {},
  timeout: 200,
  cleanup: logCleanup,
})
export class OutlastTimeoutJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    durableLog.push(`${tag}:started`);
    return new Promise(() => undefined);
  }
}

@Job({
  name: 'report-progress',
  description: 'Reports three steps of progress, one every 150 ms',
  inputSchema: {},
  outputSchema: { steps: z.number() },
  timeout: 0,
})
export class ReportProgressJob extends JobContext {
  async execute() {
    for (let step = 1; step <= 3; step++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await this.progress(step, 3, `step ${step}`);
    }
    return { steps: 3 };
  }
}

@Job({
  name: 'answer-now',
  description: 'Answers at once',
  inputSchema: {},
  outputSchema: { ok: z.boolean() },
})
export class AnswerNowJob extends JobContext {
  async execute() {
    return { ok: true };
  }
}
