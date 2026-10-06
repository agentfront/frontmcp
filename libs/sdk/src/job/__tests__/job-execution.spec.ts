import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, Job, JobContext, LogLevel, Provider } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { InvalidOutputError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { JobExecutionManager } from '../execution/job-execution.manager';
import { MemoryJobStateStore } from '../store/memory-job-state.store';

@Provider({ name: 'TicketStore' })
class TicketStore {
  readonly tickets = ['T-1', 'T-2'];
}

@Job({ name: 'count_tickets', inputSchema: {}, outputSchema: { count: z.number() } })
class CountTicketsJob extends JobContext {
  async execute() {
    return { count: this.get(TicketStore).tickets.length };
  }
}

const attempts: number[] = [];

@Job({
  name: 'flaky_sync',
  inputSchema: {},
  outputSchema: { attempt: z.number() },
  retry: { maxAttempts: 3, backoffMs: 1 },
})
class FlakySyncJob extends JobContext {
  async execute() {
    attempts.push(this.attempt);
    if (this.attempt < 3) throw new Error(`attempt ${this.attempt} failed`);
    return { attempt: this.attempt };
  }
}

@Job({ name: 'wrong_shape', inputSchema: {}, outputSchema: { count: z.number() } })
class WrongShapeJob extends JobContext {
  async execute() {
    return { count: 'many' } as unknown as { count: number };
  }
}

let chargeRuns = 0;

@Job({
  name: 'charge_card',
  inputSchema: {},
  outputSchema: { receipt: z.string() },
  retry: { maxAttempts: 3, backoffMs: 1 },
})
class ChargeCardJob extends JobContext {
  async execute() {
    chargeRuns++;
    return { receipt: 42 } as unknown as { receipt: string };
  }
}

@Job({
  name: 'retry_then_wrong_shape',
  inputSchema: {},
  outputSchema: { count: z.number() },
  retry: { maxAttempts: 3, backoffMs: 1 },
})
class RetryThenWrongShapeJob extends JobContext {
  async execute() {
    if (this.attempt === 1) throw new Error('first attempt failed');
    return { count: 'many' } as unknown as { count: number };
  }
}

@Job({ name: 'free_form', inputSchema: {}, outputSchema: {} })
class FreeFormJob extends JobContext {
  async execute() {
    return 'done';
  }
}

@Job({ name: 'early_answer', inputSchema: {}, outputSchema: { answer: z.string() } })
class EarlyAnswerJob extends JobContext {
  async execute(): Promise<{ answer: string }> {
    this.respond({ answer: 'early' });
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  providers: [TicketStore],
  jobs: [
    CountTicketsJob,
    FlakySyncJob,
    WrongShapeJob,
    ChargeCardJob,
    RetryThenWrongShapeJob,
    FreeFormJob,
    EarlyAnswerJob,
  ],
})
class DeskApp {}

describe('job execution', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'job-execution', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  async function runJob(name: string) {
    return server.callTool('execute_job', { name, input: {} });
  }

  it('gives a job the providers of its app', async () => {
    const result = await runJob('count_tickets');

    expect(result.structuredContent).toEqual(expect.objectContaining({ state: 'completed', result: { count: 2 } }));
  });

  it('keeps the providers of its app when the caller passes request providers', () => {
    const scope = (server as unknown as { scope: Scope }).scope;
    const job = scope.jobs?.findByName('count_tickets');
    if (!job) throw new Error('count_tickets is not registered');

    const context = job.create({}, { authInfo: {}, contextProviders: scope.providers });

    expect(context.get(TicketStore).tickets).toEqual(['T-1', 'T-2']);
  });

  it('numbers each retry in this.attempt', async () => {
    const result = await runJob('flaky_sync');

    expect(attempts).toEqual([1, 2, 3]);
    expect(result.structuredContent).toEqual(expect.objectContaining({ result: { attempt: 3 } }));
  });

  it("fails a run whose result does not match the job's outputSchema", async () => {
    const run = runJob('wrong_shape');

    await expect(run).rejects.toBeInstanceOf(InvalidOutputError);
    await expect(run).rejects.toThrow('output does not match outputSchema at count');
  });

  it('does not run a job again when its result fails outputSchema, so its side effects happen once', async () => {
    await expect(runJob('charge_card')).rejects.toBeInstanceOf(InvalidOutputError);

    expect(chargeRuns).toBe(1);
  });

  it('records the attempt whose result failed outputSchema on the failed run', async () => {
    const scope = (server as unknown as { scope: Scope }).scope;
    const job = scope.jobs?.findByName('retry_then_wrong_shape');
    if (!job) throw new Error('retry_then_wrong_shape is not registered');
    const stateStore = new MemoryJobStateStore();
    const manager = new JobExecutionManager(stateStore, scope.logger);

    await expect(manager.executeJob(job, {})).rejects.toBeInstanceOf(InvalidOutputError);

    const [run] = await manager.listRuns({ jobId: 'retry_then_wrong_shape' });
    expect(run).toEqual(expect.objectContaining({ state: 'failed', attempt: 2 }));
  });

  it('advertises no output schema for an empty outputSchema, which checks nothing', () => {
    const scope = (server as unknown as { scope: Scope }).scope;

    expect(scope.jobs?.findByName('free_form')?.getOutputJsonSchema()).toBeNull();
    expect(scope.jobs?.findByName('count_tickets')?.getOutputJsonSchema()).toEqual(
      expect.objectContaining({ type: 'object' }),
    );
  });

  it('takes the value of this.respond() as the job result', async () => {
    const result = await runJob('early_answer');

    expect(result.structuredContent).toEqual(
      expect.objectContaining({ state: 'completed', result: { answer: 'early' } }),
    );
  });
});
