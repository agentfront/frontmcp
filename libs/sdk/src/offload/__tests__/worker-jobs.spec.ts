/**
 * `runner: 'worker'`: a job's `execute()` runs in a worker thread of the scope's offload pool, while its
 * `jobs:execute-job` flow (permissions, admission, timeout, cleanup, the run record) stays on the main thread.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, Job, job, JobContext, LogLevel } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { ProviderNotAvailableError } from '../../errors/provider.errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { workerJobKey, workerJobRunners, type WorkerJobRunner } from '../offload-worker.globals';
import { OffloadService } from '../offload.service';
import { workerJobSourceOf } from '../worker-jobs';

class Token {}

@Job({
  name: 'crunch_job',
  inputSchema: { n: z.number() },
  outputSchema: { doubled: z.number() },
  runner: 'worker',
})
class CrunchJob extends JobContext {
  async execute({ n }: { n: number }) {
    this.log(`crunching ${n}`);
    await this.progress(1, 2, 'half way');
    if (n < 0) this.respond({ doubled: 0 });
    if (n === 7) return { doubled: this.get(Token) as never };
    return { doubled: n * 2 };
  }
}

@Job({ name: 'plain_job', inputSchema: { n: z.number() }, outputSchema: { n: z.number() } })
class PlainJob extends JobContext {
  async execute({ n }: { n: number }) {
    return { n };
  }
}

const HandlerJob = job({
  name: 'handler_job',
  inputSchema: { n: z.number() },
  outputSchema: { tripled: z.number() },
  runner: 'worker',
})(({ n }, ctx) => {
  ctx.log('tripling');
  return { tripled: n * 3 };
});

@App({ id: 'workers', name: 'Workers', jobs: [CrunchJob, PlainJob, HandlerJob] })
class WorkersApp {}

function runnerOf(target: unknown, name: string): WorkerJobRunner {
  const source = workerJobSourceOf(target);
  expect(source).toEqual({ file: __filename, name, key: workerJobKey(__filename, name) });
  const runner = workerJobRunners().get(source?.key ?? '');
  if (!runner) throw new Error(`${name} registered no worker runner`);
  return runner;
}

describe('a worker job, as its worker thread runs it', () => {
  it('runs execute() with its input and attempt, and answers with its output, logs and progress', async () => {
    const progress = jest.fn();
    const log = jest.fn();

    const answer = await runnerOf(CrunchJob, 'crunch_job').run({ n: 4 }, 2, log, progress);

    expect(answer).toEqual({ output: { doubled: 8 }, logs: [expect.stringMatching(/\] crunching 4$/)] });
    expect(progress).toHaveBeenCalledWith({ progress: 1, total: 2, message: 'half way' });
    expect(log).toHaveBeenCalledWith('info', 'crunching 4');
  });

  it('answers with what respond() sends, and refuses this.get(): a worker has no DI container', async () => {
    const runner = runnerOf(CrunchJob, 'crunch_job');

    await expect(runner.run({ n: -1 }, 1, jest.fn(), jest.fn())).resolves.toMatchObject({ output: { doubled: 0 } });
    await expect(runner.run({ n: 7 }, 1, jest.fn(), jest.fn())).rejects.toBeInstanceOf(ProviderNotAvailableError);
    await expect(runner.run({ n: 7 }, 1, jest.fn(), jest.fn())).rejects.toThrow(
      /job "crunch_job" runs in a worker thread \(runner: 'worker'\), which has no DI container/,
    );
  });

  it('runs a function-style job through its handler', async () => {
    const handler = (HandlerJob as unknown as () => unknown)();

    await expect(runnerOf(handler, 'handler_job').run({ n: 2 }, 1, jest.fn(), jest.fn())).resolves.toEqual({
      output: { tripled: 6 },
      logs: [expect.stringMatching(/\] tripling$/)],
    });
  });
});

describe('a worker job in a server', () => {
  const servers: DirectMcpServer[] = [];

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const server of servers.splice(0)) await server.dispose();
  });

  async function serve(runner?: 'worker'): Promise<DirectMcpServer> {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'worker-jobs', version: '1.0.0' },
      apps: [WorkersApp],
      logging: { level: LogLevel.Off },
      jobs: { enabled: true, ...(runner ? { runner } : {}) },
    });
    servers.push(server);
    return server;
  }

  it('hands execute() to the pool with the job and its signal, and keeps its result, logs and progress', async () => {
    const run = jest.spyOn(OffloadService.prototype, 'run').mockImplementation(async (task, call) => {
      call.onProgress?.({ progress: 1, total: 2, message: 'from the worker' });
      return { output: { doubled: 10 }, logs: ['[t] worked'] };
    });
    const server = await serve();

    const response = await server.callTool('execute_job', { name: 'crunch_job', input: { n: 5 } });

    expect(response.structuredContent).toEqual(
      expect.objectContaining({ state: 'completed', result: { doubled: 10 }, logs: ['[t] worked'] }),
    );
    expect(run).toHaveBeenCalledWith(
      {
        kind: 'job',
        file: __filename,
        key: workerJobKey(__filename, 'crunch_job'),
        name: 'crunch_job',
        input: { n: 5 },
        attempt: 1,
      },
      expect.objectContaining({ label: 'crunch_job', signal: expect.any(AbortSignal) }),
    );
    const runId = (response.structuredContent as { runId: string }).runId;
    const read = await server.readResource(`job://runs/${runId}`);
    expect(JSON.parse(String((read.contents[0] as { text: string }).text))).toEqual(
      expect.objectContaining({ state: 'completed', progress: { progress: 1, total: 2, message: 'from the worker' } }),
    );
  });

  it("runs a job that sets no runner on the pool under jobs.runner: 'worker', and inline otherwise", async () => {
    const run = jest.spyOn(OffloadService.prototype, 'run').mockResolvedValue({ output: { n: 1 }, logs: [] });

    const inline = await serve();
    await inline.callTool('execute_job', { name: 'plain_job', input: { n: 1 } });
    expect(run).not.toHaveBeenCalled();

    const pooled = await serve('worker');
    await pooled.callTool('execute_job', { name: 'plain_job', input: { n: 1 } });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'job', name: 'plain_job' }), expect.anything());
  });

  it("checks the worker's output against the job's outputSchema", async () => {
    jest.spyOn(OffloadService.prototype, 'run').mockResolvedValue({ output: { doubled: 'nine' }, logs: [] });
    const server = await serve();

    await expect(server.callTool('execute_job', { name: 'crunch_job', input: { n: 1 } })).rejects.toThrow(
      /output does not match outputSchema/,
    );
  });
});
