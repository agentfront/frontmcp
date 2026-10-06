import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, Job, JobContext, LogLevel, Provider } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { InvalidOutputError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

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
  jobs: [CountTicketsJob, FlakySyncJob, WrongShapeJob, EarlyAnswerJob],
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

  it('takes the value of this.respond() as the job result', async () => {
    const result = await runJob('early_answer');

    expect(result.structuredContent).toEqual(
      expect.objectContaining({ state: 'completed', result: { answer: 'early' } }),
    );
  });
});
