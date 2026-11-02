import 'reflect-metadata';

import { tmpdir } from 'node:os';

import { z } from '@frontmcp/lazy-zod';
import { mkdtemp, pathJoin, realpath, rm, writeFile } from '@frontmcp/utils';

import { LogLevel, Resource, ResourceContext, ResourceTemplate, Tool, ToolContext } from '../../common';
import { create } from '../../direct/create';
import { OffloadAbortedError, OffloadBudgetExceededError } from '../../errors/offload.errors';
import { OffloadService } from '../offload.service';

const WORK_MODULE = `
export function add(a, b) { return a + b; }
export function forever() { for (;;) {} }
export function slow(ms) { return new Promise((resolve) => setTimeout(() => resolve(ms), ms)); }
`;

let work = '';

@Tool({ name: 'add', inputSchema: { a: z.number(), b: z.number() } })
class AddTool extends ToolContext {
  async execute({ a, b }: { a: number; b: number }) {
    return { sum: await this.offload<(a: number, b: number) => number>({ module: work, export: 'add' }, [a, b]) };
  }
}

@Tool({ name: 'stuck', inputSchema: {}, timeout: { executeMs: 200 } })
class StuckTool extends ToolContext {
  async execute() {
    return { never: await this.offload({ module: work, export: 'forever' }, [], { budgetMs: 60_000 }) };
  }
}

@Tool({ name: 'slow', inputSchema: { ms: z.number() } })
class SlowTool extends ToolContext {
  async execute({ ms }: { ms: number }) {
    return { slept: await this.offload({ module: work, export: 'slow' }, [ms]) };
  }
}

@Resource({ name: 'report', uri: 'report://worker', mimeType: 'application/json', worker: { budgetMs: 1234 } })
class WorkerReport extends ResourceContext {
  async execute(): Promise<never> {
    throw new Error('reads in the worker, not here');
  }
}

@ResourceTemplate({ name: 'user-report', uriTemplate: 'report://users/{id}', worker: true })
class UserReport extends ResourceContext<{ id: string }> {
  async execute(): Promise<never> {
    throw new Error('reads in the worker, not here');
  }
}

describe('this.offload() and worker: true in a server', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(pathJoin(tmpdir(), 'offload-context-')));
    work = pathJoin(dir, 'work.mjs');
    await writeFile(work, WORK_MODULE);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function serve(offload?: { maxWorkers?: number; budgetMs?: number }) {
    return create({
      info: { name: 'offload-context', version: '1.0.0' },
      tools: [AddTool, StuckTool, SlowTool],
      resources: [WorkerReport, UserReport],
      logging: { level: LogLevel.Off },
      ...(offload && { offload }),
    });
  }

  it('runs a tool’s offloaded function in a worker and answers with its result', async () => {
    const server = await serve();
    try {
      const result = await server.callTool('add', { a: 20, b: 22 });

      const [first] = result.content;
      expect(result.isError).toBeFalsy();
      expect(first?.type === 'text' ? JSON.parse(first.text) : first).toEqual({ sum: 42 });
    } finally {
      await server.dispose();
    }
  });

  it('terminates the worker when the tool’s signal aborts (its timeout), freeing it for the next call', async () => {
    const server = await serve({ maxWorkers: 1 });
    try {
      await expect(server.callTool('stuck', {})).rejects.toThrow('Execution of "stuck" timed out after 200ms');
      const next = await server.callTool('add', { a: 1, b: 2 });

      expect(next.isError).toBeFalsy();
    } finally {
      await server.dispose();
    }
  });

  it('stops the pool when the server is disposed: a call in flight is refused', async () => {
    const server = await serve();
    const slow = server.callTool('slow', { ms: 30_000 }).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 200));

    await server.dispose();

    expect(await slow).toEqual(new OffloadAbortedError('slow', 'shutdown'));
  });

  it('reads a worker: true resource through the pool, with its module, budget and the read’s signal', async () => {
    const run = jest.spyOn(OffloadService.prototype, 'run').mockResolvedValue({ from: 'worker' });
    const server = await serve();
    try {
      const read = await server.readResource('report://worker');
      const templated = await server.readResource('report://users/7');

      expect(JSON.parse(String((read.contents[0] as { text: string }).text))).toEqual({ from: 'worker' });
      expect(templated.contents).toHaveLength(1);
      expect(run).toHaveBeenNthCalledWith(
        1,
        {
          kind: 'resource',
          file: __filename,
          key: `${__filename}#report#report://worker`,
          name: 'report',
          uri: 'report://worker',
          params: {},
        },
        expect.objectContaining({ label: 'report', budgetMs: 1234 }),
      );
      expect(run).toHaveBeenNthCalledWith(
        2,
        {
          kind: 'resource',
          file: __filename,
          key: `${__filename}#user-report#report://users/{id}`,
          name: 'user-report',
          uri: 'report://users/7',
          params: { id: '7' },
        },
        expect.objectContaining({ label: 'user-report', budgetMs: undefined }),
      );
    } finally {
      await server.dispose();
    }
  });

  it('answers a read past its budget with the budget error', async () => {
    jest.spyOn(OffloadService.prototype, 'run').mockRejectedValue(new OffloadBudgetExceededError('report', 1234));
    const server = await serve();
    try {
      await expect(server.readResource('report://worker')).rejects.toThrow(
        'Offloaded "report" ran past its 1234 ms budget and was stopped',
      );
    } finally {
      await server.dispose();
    }
  });
});
