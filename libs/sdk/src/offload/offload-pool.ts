import type { Worker } from 'node:worker_threads';

import { dirname, isAbsolute, pathJoin, pathToFileURL } from '@frontmcp/utils';

import type { FrontMcpLogger } from '../common/interfaces/logger.interface';
import type { OffloadOptions } from '../common/types/options/offload';
import { PublicMcpError, type ErrorRemedy } from '../errors/mcp.error';
import {
  InvalidOffloadCallError,
  OffloadAbortedError,
  OffloadBudgetExceededError,
  OffloadNotCloneableError,
  OffloadWorkerError,
} from '../errors/offload.errors';
import type { WorkerLogLevel } from './offload-worker.globals';
import { OFFLOAD_WORKER_SOURCE } from './offload-worker.source';
import type { OffloadRun, OffloadTask } from './offload.types';

const DEFAULT_BUDGET_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_ENV = ['NODE_ENV'];
const LOG_LEVELS: readonly WorkerLogLevel[] = ['verbose', 'debug', 'info', 'warn', 'error'];

type WorkerTask =
  | { kind: 'function'; url: string; exportName: string; args: readonly unknown[] }
  | { kind: 'resource'; url: string; key: string; name: string; uri: string; params: Record<string, string> };

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  isPublic?: boolean;
  statusCode?: number;
  remedy?: ErrorRemedy;
  jsonRpc?: { code: number; message: string; data?: Record<string, unknown> };
}

type WorkerMessage =
  | { type: 'started' }
  | { type: 'log'; level: string; text: string }
  | { type: 'result'; value: unknown }
  | { type: 'error'; error: SerializedError; notCloneable?: boolean };

interface PendingCall {
  task: WorkerTask;
  call: OffloadRun;
  budgetMs: number;
  resolve(value: unknown): void;
  reject(error: Error): void;
  onAbort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface PooledWorker {
  worker: Worker;
  running?: PendingCall;
  idleTimer?: ReturnType<typeof setTimeout>;
  gone: boolean;
}

/** Worker threads that run offloaded work one call at a time each, started on demand and stopped when idle. */
export class OffloadPool {
  private readonly workers = new Set<PooledWorker>();
  private readonly idle: PooledWorker[] = [];
  private readonly queue: PendingCall[] = [];
  private readonly warnedTargets = new Set<string>();
  private readonly maxWorkers: number;
  private readonly idleTimeoutMs: number;
  private readonly budgetMs: number;
  private readonly env: Record<string, string>;
  private readonly tsxApi: TsxApi | undefined;
  private closed = false;

  constructor(
    options: OffloadOptions | undefined,
    private readonly logger: FrontMcpLogger,
  ) {
    this.maxWorkers = options?.maxWorkers ?? defaultMaxWorkers();
    this.idleTimeoutMs = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.budgetMs = options?.budgetMs ?? DEFAULT_BUDGET_MS;
    this.env = pickEnv(options?.env ?? DEFAULT_ENV);
    this.tsxApi = tsxApiOf(process.execArgv, process.cwd());
  }

  /** How many worker threads are running, busy or idle. */
  get size(): number {
    return this.workers.size;
  }

  run(task: OffloadTask, call: OffloadRun): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new OffloadAbortedError(call.label, 'shutdown'));
      if (call.signal?.aborted) return reject(new OffloadAbortedError(call.label, 'cancelled'));
      const budgetMs = call.budgetMs ?? this.budgetMs;
      if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
        return reject(
          new InvalidOffloadCallError(`budgetMs must be a positive number of milliseconds (got ${budgetMs})`),
        );
      }
      let workerTask: WorkerTask;
      try {
        workerTask = toWorkerTask(task);
      } catch (error) {
        return reject(error instanceof Error ? error : new InvalidOffloadCallError(String(error)));
      }
      const pending: PendingCall = { task: workerTask, call, budgetMs, resolve, reject };
      if (call.signal) {
        pending.onAbort = () => this.abort(pending);
        call.signal.addEventListener('abort', pending.onAbort, { once: true });
      }
      this.queue.push(pending);
      this.dispatch();
    });
  }

  /** Stop every worker; the calls running or waiting reject with `OffloadAbortedError`. */
  async close(): Promise<void> {
    this.closed = true;
    for (const pending of this.queue.splice(0))
      this.settle(pending, new OffloadAbortedError(pending.call.label, 'shutdown'));
    await Promise.all(
      [...this.workers].map((pooled) => {
        if (pooled.running) this.settle(pooled.running, new OffloadAbortedError(pooled.running.call.label, 'shutdown'));
        return this.discard(pooled);
      }),
    );
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      let pooled: PooledWorker | undefined;
      try {
        pooled = this.idle.pop() ?? (this.workers.size < this.maxWorkers ? this.spawn() : undefined);
      } catch (error) {
        const failed = this.queue.shift();
        if (failed)
          this.settle(failed, new OffloadWorkerError(failed.call.label, `it could not start: ${messageOf(error)}`));
        continue;
      }
      if (!pooled) return;
      const pending = this.queue.shift();
      if (pending) this.start(pooled, pending);
    }
  }

  private start(pooled: PooledWorker, pending: PendingCall): void {
    clearTimeout(pooled.idleTimer);
    try {
      pooled.worker.postMessage(pending.task);
    } catch (error) {
      this.release(pooled);
      this.settle(pending, new OffloadNotCloneableError(pending.call.label, 'arguments', messageOf(error)));
      return;
    }
    pooled.running = pending;
    pooled.worker.ref();
    this.startBudget(pooled, pending, Math.max(this.budgetMs, pending.budgetMs));
  }

  private startBudget(pooled: PooledWorker, pending: PendingCall, budgetMs: number): void {
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => this.overBudget(pooled, pending, budgetMs), budgetMs);
  }

  private spawn(): PooledWorker {
    const { Worker } = require('node:worker_threads') as typeof import('node:worker_threads');
    const worker = new Worker(OFFLOAD_WORKER_SOURCE, {
      eval: true,
      env: this.env,
      stdout: true,
      workerData: { env: this.env, tsxApi: this.tsxApi },
    });
    worker.stdout.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    const pooled: PooledWorker = { worker, gone: false };
    worker.on('message', (message: WorkerMessage) => this.onMessage(pooled, message));
    worker.on('error', (error) => this.onFailure(pooled, messageOf(error)));
    worker.on('exit', (code) => this.onFailure(pooled, `it exited with code ${code}`));
    this.workers.add(pooled);
    return pooled;
  }

  private onMessage(pooled: PooledWorker, message: WorkerMessage): void {
    const pending = pooled.running;
    if (!pending || pooled.gone) return;
    if (message.type === 'started') {
      this.startBudget(pooled, pending, pending.budgetMs);
      return;
    }
    if (message.type === 'log') {
      const level = LOG_LEVELS.find((candidate) => candidate === message.level) ?? 'info';
      pending.call.logger[level](message.text);
      return;
    }
    pooled.running = undefined;
    this.release(pooled);
    if (message.type === 'result') {
      this.settle(pending, undefined, message.value);
    } else if (message.notCloneable) {
      this.settle(pending, new OffloadNotCloneableError(pending.call.label, 'result', message.error.message));
    } else {
      this.settle(pending, fromWorker(message.error));
    }
    this.dispatch();
  }

  private onFailure(pooled: PooledWorker, detail: string): void {
    if (pooled.gone) return;
    const pending = pooled.running;
    void this.discard(pooled);
    if (pending) this.settle(pending, new OffloadWorkerError(pending.call.label, detail));
    this.dispatch();
  }

  private overBudget(pooled: PooledWorker, pending: PendingCall, budgetMs: number): void {
    if (pooled.running !== pending) return;
    void this.discard(pooled);
    const target = targetOf(pending.task);
    const message = `Offloaded "${pending.call.label}" (${target}) ran past its ${budgetMs} ms budget; its worker was terminated`;
    if (this.warnedTargets.has(target)) {
      pending.call.logger.verbose(message);
    } else {
      this.warnedTargets.add(target);
      pending.call.logger.warn(`${message}. Later overruns of it are logged at verbose level.`);
    }
    this.settle(pending, new OffloadBudgetExceededError(pending.call.label, budgetMs));
    this.dispatch();
  }

  private abort(pending: PendingCall): void {
    const queued = this.queue.indexOf(pending);
    if (queued >= 0) this.queue.splice(queued, 1);
    const pooled = [...this.workers].find((candidate) => candidate.running === pending);
    if (pooled) void this.discard(pooled);
    this.settle(pending, new OffloadAbortedError(pending.call.label, 'cancelled'));
    this.dispatch();
  }

  private release(pooled: PooledWorker): void {
    if (pooled.gone) return;
    pooled.worker.unref();
    this.idle.push(pooled);
    pooled.idleTimer = setTimeout(() => void this.discard(pooled), this.idleTimeoutMs);
    pooled.idleTimer.unref();
  }

  private async discard(pooled: PooledWorker): Promise<void> {
    if (pooled.gone) return;
    pooled.gone = true;
    pooled.running = undefined;
    clearTimeout(pooled.idleTimer);
    this.workers.delete(pooled);
    const idleAt = this.idle.indexOf(pooled);
    if (idleAt >= 0) this.idle.splice(idleAt, 1);
    try {
      await pooled.worker.terminate();
    } catch (error) {
      this.logger.verbose(`Terminating an offload worker failed: ${messageOf(error)}`);
    }
  }

  private settle(pending: PendingCall, error?: Error, value?: unknown): void {
    clearTimeout(pending.timer);
    if (pending.onAbort) pending.call.signal?.removeEventListener('abort', pending.onAbort);
    if (error) pending.reject(error);
    else pending.resolve(value);
  }
}

function toWorkerTask(task: OffloadTask): WorkerTask {
  if (task.kind === 'resource') {
    return {
      kind: 'resource',
      url: pathToFileURL(task.file).href,
      key: task.key,
      name: task.name,
      uri: task.uri,
      params: task.params,
    };
  }
  const { moduleRef, args } = task;
  if (typeof moduleRef !== 'object' || moduleRef === null) {
    throw new InvalidOffloadCallError('the module reference must be an object: { module, export? }');
  }
  const exportName = moduleRef.export ?? 'default';
  if (typeof exportName !== 'string' || exportName.length === 0) {
    throw new InvalidOffloadCallError('moduleRef.export must name an exported function');
  }
  if (!Array.isArray(args)) throw new InvalidOffloadCallError('the arguments must be an array');
  return { kind: 'function', url: moduleUrl(moduleRef.module), exportName, args };
}

function moduleUrl(module: unknown): string {
  if (module instanceof URL) {
    if (module.protocol !== 'file:')
      throw new InvalidOffloadCallError(`moduleRef.module must be a file: URL (got ${module.href})`);
    return module.href;
  }
  if (typeof module !== 'string' || module.length === 0) {
    throw new InvalidOffloadCallError('moduleRef.module must be an absolute path or a file: URL');
  }
  if (module.startsWith('file:')) return new URL(module).href;
  if (!isAbsolute(module)) {
    throw new InvalidOffloadCallError(
      `moduleRef.module must be an absolute path or a file: URL (got "${module}"): build it with new URL('./x.js', import.meta.url) or path.join(__dirname, 'x.js')`,
    );
  }
  return pathToFileURL(module).href;
}

function targetOf(task: WorkerTask): string {
  return task.kind === 'function' ? `${task.url}#${task.exportName}` : task.key;
}

function fromWorker(serialized: SerializedError): Error {
  const error = serialized.isPublic
    ? publicError(serialized)
    : Object.assign(new Error(serialized.message), serialized.code ? { code: serialized.code } : {});
  error.name = serialized.name;
  if (serialized.stack) error.stack = serialized.stack;
  return error;
}

function publicError({ message, code, statusCode, remedy, jsonRpc }: SerializedError): PublicMcpError {
  const error = new PublicMcpError(message, code, statusCode, undefined, remedy);
  return jsonRpc ? Object.assign(error, { toJsonRpcError: () => jsonRpc }) : error;
}

function pickEnv(names: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function defaultMaxWorkers(): number {
  const { availableParallelism } = require('node:os') as typeof import('node:os');
  return Math.max(1, Math.min(4, availableParallelism() - 1));
}

/** Where a worker registers tsx when the server runs under it: tsx hooks the main thread only. */
export interface TsxApi {
  cjs: string;
  esm: string;
}

export function tsxApiOf(execArgv: readonly string[], cwd: string): TsxApi | undefined {
  for (const arg of execArgv) {
    const value = arg.startsWith('--') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
    const path = value.startsWith('file://') ? filePathOf(value) : value;
    const installed = /^(.*[\\/]tsx[\\/]dist)[\\/][^\\/]+$/.exec(path);
    if (installed) return tsxApiIn(installed[1]);
    if (value === 'tsx' || value.startsWith('tsx/')) return tsxApiFrom(cwd);
  }
  return undefined;
}

function tsxApiIn(dist: string): TsxApi {
  return {
    cjs: pathJoin(dist, 'cjs', 'api', 'index.cjs'),
    esm: pathToFileURL(pathJoin(dist, 'esm', 'api', 'index.mjs')).href,
  };
}

function tsxApiFrom(cwd: string): TsxApi | undefined {
  try {
    const { createRequire } = require('node:module') as typeof import('node:module');
    return tsxApiIn(pathJoin(dirname(createRequire(pathJoin(cwd, 'noop.js')).resolve('tsx/package.json')), 'dist'));
  } catch {
    return undefined;
  }
}

function filePathOf(url: string): string {
  const { fileURLToPath } = require('node:url') as typeof import('node:url');
  return fileURLToPath(url);
}

function messageOf(error: unknown): string {
  const message: unknown = error !== null && typeof error === 'object' ? Reflect.get(error, 'message') : undefined;
  return typeof message === 'string' ? message : String(error);
}
