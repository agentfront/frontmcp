import { tmpdir } from 'node:os';

import { mkdtemp, pathJoin, pathToFileURL, realpath, rm, writeFile } from '@frontmcp/utils';

import type { FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { PublicMcpError } from '../../errors/mcp.error';
import {
  InvalidOffloadCallError,
  OffloadAbortedError,
  OffloadBudgetExceededError,
  OffloadNotCloneableError,
  OffloadWorkerError,
} from '../../errors/offload.errors';
import { OffloadPool, tsxApiOf } from '../offload-pool';
import { workerResourceKey } from '../offload-worker.globals';
import type { OffloadRun } from '../offload.types';

const WORK_MODULE = `
import { isMainThread, threadId } from 'node:worker_threads';
export default function whereami() { return { isMainThread, threadId }; }
export function add(a, b) { return a + b; }
export function forever() { for (;;) {} }
export function slow(ms) { return new Promise((resolve) => setTimeout(() => resolve(threadId), ms)); }
export function fail() { const error = new TypeError('nope'); error.code = 'E_NOPE'; throw error; }
export function refuse() {
  const error = new Error('Resource "x" not found');
  Object.assign(error, { name: 'ResourceNotFoundError', isPublic: true, code: 'RESOURCE_NOT_FOUND', statusCode: 404 });
  throw error;
}
export function makeFunction() { return () => 1; }
export function readEnv() { return { ...process.env }; }
export function exitNow() { process.exit(3); }
export function crashLater() { setTimeout(() => { throw new Error('boom'); }, 0); return new Promise(() => undefined); }
export const notAFunction = 1;
`;

const CJS_MODULE = `module.exports = { triple: (n) => n * 3 };`;

const SLOW_TO_LOAD_MODULE = `
await new Promise((resolve) => setTimeout(resolve, 400));
export function spin(ms) { const end = Date.now() + ms; while (Date.now() < end); return ms; }
`;

const RESOURCE_MODULE = `
const { isMainThread } = require('node:worker_threads');
const key = Symbol.for('@frontmcp/sdk:worker-resources');
globalThis[key] = globalThis[key] || new Map();
globalThis[key].set(__filename + '#report', {
  read: async (uri, params, log) => {
    log('info', 'reading ' + uri);
    log('nonsense', 'unknown level');
    return { uri, params, isMainThread };
  },
});
`;

function testLogger(): FrontMcpLogger & Record<'verbose' | 'debug' | 'info' | 'warn' | 'error', jest.Mock> {
  const logger = {
    child: () => logger,
    verbose: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return logger;
}

describe('OffloadPool', () => {
  let dir: string;
  let work: string;
  const pools: OffloadPool[] = [];

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(pathJoin(tmpdir(), 'offload-pool-')));
    work = pathJoin(dir, 'work.mjs');
    await writeFile(work, WORK_MODULE);
    await writeFile(pathJoin(dir, 'triple.cjs'), CJS_MODULE);
    await writeFile(pathJoin(dir, 'slow-to-load.mjs'), SLOW_TO_LOAD_MODULE);
    await writeFile(pathJoin(dir, 'report.cjs'), RESOURCE_MODULE);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  function pool(options: ConstructorParameters<typeof OffloadPool>[0] = {}): OffloadPool {
    const created = new OffloadPool(options, testLogger());
    pools.push(created);
    return created;
  }

  function call(overrides: Partial<OffloadRun> = {}): OffloadRun {
    return { label: 'work', logger: testLogger(), ...overrides };
  }

  function runExport(target: OffloadPool, exportName: string | undefined, args: unknown[] = [], run = call()) {
    return target.run({ kind: 'function', moduleRef: { module: work, export: exportName }, args }, run);
  }

  it('runs an exported function in a worker thread and resolves with its result', async () => {
    const offload = pool();

    await expect(runExport(offload, 'add', [2, 3])).resolves.toBe(5);
    await expect(runExport(offload, undefined)).resolves.toMatchObject({ isMainThread: false });
  });

  it('accepts a file: URL, a URL object and a CommonJS module', async () => {
    const offload = pool();
    const tripleUrl = pathToFileURL(pathJoin(dir, 'triple.cjs'));

    await expect(
      offload.run({ kind: 'function', moduleRef: { module: tripleUrl, export: 'triple' }, args: [4] }, call()),
    ).resolves.toBe(12);
    await expect(
      offload.run({ kind: 'function', moduleRef: { module: tripleUrl.href, export: 'triple' }, args: [5] }, call()),
    ).resolves.toBe(15);
  });

  it('reuses an idle worker for the next call', async () => {
    const offload = pool();

    const first = (await runExport(offload, undefined)) as { threadId: number };
    const second = (await runExport(offload, undefined)) as { threadId: number };

    expect(second.threadId).toBe(first.threadId);
    expect(offload.size).toBe(1);
  });

  it('starts no more than maxWorkers, and queues the calls past it', async () => {
    const offload = pool({ maxWorkers: 2 });

    const running = [1, 2, 3, 4].map(() => runExport(offload, 'slow', [150]));
    expect(offload.size).toBe(2);
    const threads = await Promise.all(running);

    expect(new Set(threads).size).toBe(2);
    expect(offload.size).toBe(2);
  });

  it('stops a worker that stayed idle past idleTimeoutMs', async () => {
    const offload = pool({ idleTimeoutMs: 50 });

    await runExport(offload, 'add', [1, 1]);
    expect(offload.size).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(offload.size).toBe(0);
  });

  it('terminates a worker past its budget, rejects with OffloadBudgetExceededError and warns once per target', async () => {
    const offload = pool();
    const logger = testLogger();

    const overrun = runExport(offload, 'forever', [], call({ budgetMs: 100, logger }));
    await expect(overrun).rejects.toBeInstanceOf(OffloadBudgetExceededError);
    await expect(overrun).rejects.toMatchObject({ code: 'OFFLOAD_BUDGET_EXCEEDED', budgetMs: 100, target: 'work' });
    expect(offload.size).toBe(0);

    await expect(runExport(offload, 'forever', [], call({ budgetMs: 100, logger }))).rejects.toBeInstanceOf(
      OffloadBudgetExceededError,
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('ran past its 100 ms budget');
    expect(logger.verbose).toHaveBeenCalledTimes(1);

    await expect(runExport(offload, 'add', [1, 2])).resolves.toBe(3);
  });

  it('counts the budget from the moment the function starts, not while a fresh worker loads its module', async () => {
    const offload = pool();
    const module = pathJoin(dir, 'slow-to-load.mjs');

    await expect(
      offload.run({ kind: 'function', moduleRef: { module, export: 'spin' }, args: [400] }, call({ budgetMs: 600 })),
    ).resolves.toBe(400);
  });

  it('uses the pool budget when a call gives none', async () => {
    const offload = pool({ budgetMs: 100 });

    await expect(runExport(offload, 'forever')).rejects.toMatchObject({ budgetMs: 100 });
  });

  it('terminates the worker when the signal aborts', async () => {
    const offload = pool();
    const controller = new AbortController();

    const running = runExport(offload, 'forever', [], call({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 100);

    await expect(running).rejects.toBeInstanceOf(OffloadAbortedError);
    await expect(running).rejects.toMatchObject({ code: 'OFFLOAD_ABORTED' });
    expect(offload.size).toBe(0);
  });

  it('refuses a call whose signal already aborted, without starting a worker', async () => {
    const offload = pool();

    await expect(runExport(offload, 'add', [1, 1], call({ signal: AbortSignal.abort() }))).rejects.toBeInstanceOf(
      OffloadAbortedError,
    );
    expect(offload.size).toBe(0);
  });

  it('drops a queued call when its signal aborts, and keeps the running one', async () => {
    const offload = pool({ maxWorkers: 1 });
    const controller = new AbortController();

    const running = runExport(offload, 'slow', [200]);
    const queued = runExport(offload, 'add', [1, 1], call({ signal: controller.signal }));
    controller.abort();

    await expect(queued).rejects.toBeInstanceOf(OffloadAbortedError);
    await expect(running).resolves.toEqual(expect.any(Number));
  });

  it('refuses arguments and results that cannot be structured-cloned, and keeps the worker', async () => {
    const offload = pool();

    await expect(runExport(offload, 'add', [() => 1, 2])).rejects.toBeInstanceOf(OffloadNotCloneableError);
    await expect(runExport(offload, 'makeFunction')).rejects.toThrow(/its result cannot be structured-cloned/);
    await expect(runExport(offload, 'add', [1, 2])).resolves.toBe(3);
    expect(offload.size).toBe(1);
  });

  it("rejects with the function's error: its name, message, code and stack", async () => {
    const offload = pool();

    const failure = runExport(offload, 'fail');
    await expect(failure).rejects.toMatchObject({ name: 'TypeError', message: 'nope', code: 'E_NOPE' });
    await expect(failure).rejects.toHaveProperty('stack', expect.stringContaining('work.mjs'));
  });

  it('keeps a public error public', async () => {
    const offload = pool();

    const refusal = runExport(offload, 'refuse');
    await expect(refusal).rejects.toBeInstanceOf(PublicMcpError);
    await expect(refusal).rejects.toMatchObject({
      name: 'ResourceNotFoundError',
      code: 'RESOURCE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('rejects with OffloadWorkerError when the worker exits or crashes, and starts a new one', async () => {
    const offload = pool();

    await expect(runExport(offload, 'exitNow')).rejects.toThrow(
      new OffloadWorkerError('work', 'it exited with code 3'),
    );
    await expect(runExport(offload, 'crashLater')).rejects.toThrow(/failed: boom/);
    await expect(runExport(offload, 'add', [2, 2])).resolves.toBe(4);
  });

  it('refuses a module reference it cannot run', async () => {
    const offload = pool();
    const refused = (moduleRef: unknown, args: unknown = []) =>
      offload.run({ kind: 'function', moduleRef: moduleRef as never, args: args as never }, call());

    await expect(refused({ module: './work.mjs' })).rejects.toThrow(
      /absolute path or a file: URL \(got "\.\/work\.mjs"\)/,
    );
    await expect(refused({ module: new URL('https://example.com/work.mjs') })).rejects.toBeInstanceOf(
      InvalidOffloadCallError,
    );
    await expect(refused({ module: '' })).rejects.toBeInstanceOf(InvalidOffloadCallError);
    await expect(refused(null)).rejects.toBeInstanceOf(InvalidOffloadCallError);
    await expect(refused({ module: work, export: '' })).rejects.toBeInstanceOf(InvalidOffloadCallError);
    await expect(refused({ module: work, export: 'add' }, 'not an array')).rejects.toBeInstanceOf(
      InvalidOffloadCallError,
    );
    await expect(runExport(offload, 'add', [1, 1], call({ budgetMs: 0 }))).rejects.toBeInstanceOf(
      InvalidOffloadCallError,
    );
    await expect(runExport(offload, 'notAFunction')).rejects.toThrow(/has no exported function "notAFunction"/);
  });

  it('gives a worker only the environment variables it is configured to pass', async () => {
    process.env['OFFLOAD_SPEC_SECRET'] = 'do-not-cross';
    process.env['OFFLOAD_SPEC_PASSED'] = 'crosses';
    try {
      const defaults = (await runExport(pool(), 'readEnv')) as Record<string, string>;
      const listed = (await runExport(pool({ env: ['OFFLOAD_SPEC_PASSED'] }), 'readEnv')) as Record<string, string>;

      expect(defaults['OFFLOAD_SPEC_SECRET']).toBeUndefined();
      expect(Object.keys(defaults).every((name) => name === 'NODE_ENV')).toBe(true);
      expect(listed).toEqual({ OFFLOAD_SPEC_PASSED: 'crosses' });
    } finally {
      delete process.env['OFFLOAD_SPEC_SECRET'];
      delete process.env['OFFLOAD_SPEC_PASSED'];
    }
  });

  it('reads a worker resource through the reader its module registered, and forwards its log lines', async () => {
    const offload = pool();
    const logger = testLogger();
    const file = pathJoin(dir, 'report.cjs');

    const value = await offload.run(
      { kind: 'resource', file, name: 'report', uri: 'report://1', params: { id: '1' } },
      call({ label: 'report', logger }),
    );

    expect(value).toEqual({ uri: 'report://1', params: { id: '1' }, isMainThread: false });
    expect(logger.info).toHaveBeenCalledWith('reading report://1');
    expect(logger.info).toHaveBeenCalledWith('unknown level');
    expect(workerResourceKey(file, 'report')).toBe(`${file}#report`);
  });

  it('rejects a worker resource its module did not register', async () => {
    const offload = pool();

    await expect(
      offload.run(
        { kind: 'resource', file: pathJoin(dir, 'report.cjs'), name: 'other', uri: 'report://1', params: {} },
        call(),
      ),
    ).rejects.toThrow(/registered no worker resource "other"/);
  });

  it('stops every worker on close(): the calls running and waiting reject, and later calls are refused', async () => {
    const offload = pool({ maxWorkers: 1 });

    const outcomes = Promise.allSettled([runExport(offload, 'forever'), runExport(offload, 'add', [1, 1])]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await offload.close();

    expect(await outcomes).toEqual([
      { status: 'rejected', reason: new OffloadAbortedError('work', 'shutdown') },
      { status: 'rejected', reason: expect.any(OffloadAbortedError) },
    ]);
    expect(offload.size).toBe(0);
    await expect(runExport(offload, 'add', [1, 1])).rejects.toThrow(/the server is shutting down/);
  });
});

describe('tsxApiOf', () => {
  const api = (dist: string) => ({
    cjs: pathJoin(dist, 'cjs', 'api', 'index.cjs'),
    esm: pathToFileURL(pathJoin(dist, 'esm', 'api', 'index.mjs')).href,
  });

  it('finds the API next to the tsx loader the server runs under', () => {
    const loader = '/repo/node_modules/tsx/dist/loader.mjs';
    const expected = api('/repo/node_modules/tsx/dist');

    expect(tsxApiOf(['--require', '/repo/node_modules/tsx/dist/preflight.cjs'], '/repo')).toEqual(expected);
    expect(tsxApiOf(['--import', pathToFileURL(loader).href], '/repo')).toEqual(expected);
    expect(tsxApiOf([`--import=${loader}`], '/repo')).toEqual(expected);
  });

  it('resolves a bare tsx specifier from the working directory, and is undefined without tsx', () => {
    expect(tsxApiOf(['--import', 'tsx'], process.cwd())?.cjs).toMatch(
      /[\\/]tsx[\\/]dist[\\/]cjs[\\/]api[\\/]index\.cjs$/,
    );
    expect(tsxApiOf(['--import', 'tsx'], tmpdir())).toBeUndefined();
    expect(tsxApiOf(['--enable-source-maps'], process.cwd())).toBeUndefined();
  });
});
