import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';
import { App, Job, job, JobContext, LogLevel } from '../../index';
import { NotificationService } from '../../notification';

@Job({ name: 'class_report', inputSchema: { steps: z.number() }, outputSchema: { sent: z.boolean() } })
class ClassReportJob extends JobContext {
  async execute(input: { steps: number }) {
    this.log(`running ${input.steps} steps`);
    return { sent: await this.progress(1, input.steps, 'first step') };
  }
}

const FunctionReportJob = job({
  name: 'function_report',
  inputSchema: { steps: z.number() },
  outputSchema: { sent: z.boolean() },
})(async (input, ctx) => {
  ctx.log(`running ${input.steps} steps`);
  return { sent: await ctx.progress(1, input.steps, 'first step') };
});

@App({ name: 'Reports', jobs: [ClassReportJob, FunctionReportJob] })
class ReportsApp {}

function withoutTimestamps(logs: string[] | undefined): string[] {
  return (logs ?? []).map((line) => line.replace(/^\[[^\]]+\] /, ''));
}

describe.each(['class_report', 'function_report'])('the %s job', (jobName) => {
  let client: DirectClient;
  let progressNotifications: jest.SpyInstance;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'job-reports', version: '1.0.0' },
      apps: [ReportsApp],
      jobs: { enabled: true },
      logging: { level: LogLevel.Off },
    });
  });

  beforeEach(() => {
    progressNotifications = jest.spyOn(NotificationService.prototype, 'sendProgressNotification');
  });

  afterEach(() => {
    progressNotifications.mockRestore();
  });

  afterAll(async () => {
    await client.close();
  });

  it('records its log() calls in the run logs', async () => {
    const execution = await client.executeJob(jobName, { steps: 2 });

    expect(withoutTimestamps(execution.logs)).toEqual(['running 2 steps']);
  });

  it("sends its progress() calls as progress notifications to the caller's session", async () => {
    await client.executeJob(jobName, { steps: 2 });

    expect(progressNotifications.mock.calls).toEqual([[expect.any(String), jobName, 1, 2, 'first step']]);
  });
});
