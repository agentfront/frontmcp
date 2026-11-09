import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { type CallToolResult } from '@frontmcp/protocol';

import { createTestFetchServer, rpc20260728 } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Job, JobContext, LogLevel, Provider } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { InvalidInputError, InvalidOutputError, JobTimeoutError, PublicMcpError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { JobExecutionManager } from '../execution/job-execution.manager';
import { runJobAttemptFlow, willRetryJobAttempt } from '../job-attempt';
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
    return 'done' as unknown as Record<string, never>;
  }
}

@Job({ name: 'early_answer', inputSchema: {}, outputSchema: { answer: z.string() } })
class EarlyAnswerJob extends JobContext {
  async execute(): Promise<{ answer: string }> {
    this.respond({ answer: 'early' });
  }
}

let ticketRuns = 0;

@Job({
  name: 'file_ticket',
  inputSchema: { title: z.string() },
  outputSchema: { filed: z.string() },
  retry: { maxAttempts: 3, backoffMs: 1 },
})
class FileTicketJob extends JobContext {
  async execute(input: { title: string }) {
    ticketRuns++;
    return { filed: input.title };
  }
}

let refusalRuns = 0;

@Job({ name: 'refuse_sync', inputSchema: {}, outputSchema: {}, retry: { maxAttempts: 3, backoffMs: 1 } })
class RefuseSyncJob extends JobContext {
  async execute(): Promise<Record<string, never>> {
    refusalRuns++;
    throw new PublicMcpError('The account is closed', 'ACCOUNT_CLOSED', 409);
  }
}

let slowRuns = 0;

@Job({
  name: 'slow_sync',
  inputSchema: {},
  outputSchema: {},
  timeout: 20,
  retry: { maxAttempts: 2, backoffMs: 1 },
})
class SlowSyncJob extends JobContext {
  async execute() {
    slowRuns++;
    await new Promise((resolve) => setTimeout(resolve, 60));
    return {};
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  providers: [TicketStore],
  jobs: [
    FileTicketJob,
    RefuseSyncJob,
    SlowSyncJob,
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

  it('fails bad input with INVALID_INPUT and its issues on the first attempt, and never retries it', async () => {
    ticketRuns = 0;
    const scope = (server as unknown as { scope: Scope }).scope;
    const job = scope.jobs?.findByName('file_ticket');
    if (!job) throw new Error('file_ticket is not registered');
    const manager = new JobExecutionManager(new MemoryJobStateStore(), scope.logger);

    const run = manager.executeJob(job, { title: 7 });

    await expect(run).rejects.toBeInstanceOf(InvalidInputError);
    await expect(run).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      validationErrors: [expect.objectContaining({ path: ['title'] })],
    });
    expect(ticketRuns).toBe(0);
    const [failed] = await manager.listRuns({ jobId: 'file_ticket' });
    expect(failed).toEqual(expect.objectContaining({ state: 'failed', attempt: 1 }));
  });

  it('tells execute_job callers what is wrong with the input, without a stack', async () => {
    const fetchServer = await createTestFetchServer({ info: { name: 'job-input', version: '1.0.0' }, apps: [DeskApp] });
    const { message } = await rpc20260728(fetchServer.handler, 'tools/call', {
      name: 'execute_job',
      arguments: { name: 'file_ticket', input: { title: 7 } },
    });

    const result = message.result as CallToolResult;
    const text = (result.content[0] as { text: string }).text;
    expect(result.isError).toBe(true);
    expect(text).toMatch(/^Invalid input for job "file_ticket"\nDetails: /);
    expect(text).toContain('"title"');
    expect(text).not.toMatch(/\n\s+at /);
  });

  it("fails an attempt given bad input (a workflow step's, or a hook's) with INVALID_INPUT, which is not retried", async () => {
    const scope = (server as unknown as { scope: Scope }).scope;
    const job = scope.jobs?.findByName('file_ticket');
    if (!job) throw new Error('file_ticket is not registered');
    ticketRuns = 0;

    const attempt = runJobAttemptFlow({ job, input: { title: 7 }, attempt: 1, authInfo: {} });

    await expect(attempt).rejects.toBeInstanceOf(InvalidInputError);
    expect(willRetryJobAttempt(new InvalidInputError('bad'), 1, 3)).toBe(false);
    expect(ticketRuns).toBe(0);
  });

  it('does not retry a job that fails with a PublicMcpError', async () => {
    refusalRuns = 0;

    await expect(runJob('refuse_sync')).rejects.toThrow('The account is closed');
    expect(refusalRuns).toBe(1);
  });

  it('still retries an attempt that timed out', async () => {
    slowRuns = 0;

    await expect(runJob('slow_sync')).rejects.toBeInstanceOf(JobTimeoutError);
    expect(slowRuns).toBe(2);
  });
});
