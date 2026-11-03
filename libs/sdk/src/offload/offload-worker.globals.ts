/** Set on a worker thread's global scope before it imports a module for offloaded work. */
export const OFFLOAD_WORKER_MARKER = Symbol.for('@frontmcp/sdk:offload-worker');

/** Where a worker finds the readers of the `worker: true` resources its imports registered. */
export const WORKER_RESOURCES_KEY = Symbol.for('@frontmcp/sdk:worker-resources');

/** Where a worker finds the runners of the jobs its imports registered, for `runner: 'worker'`. */
export const WORKER_JOBS_KEY = Symbol.for('@frontmcp/sdk:worker-jobs');

export type WorkerLogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error';

export type WorkerLog = (level: WorkerLogLevel, text: string) => void;

export interface WorkerResourceReader {
  read(uri: string, params: Record<string, string>, log: WorkerLog): Promise<unknown>;
}

/** What a job's `this.progress()` reports from its worker. */
export interface WorkerJobProgress {
  progress: number;
  total?: number;
  message?: string;
}

/** What a job's `execute()` answered in its worker, with what it logged with `this.log()`. */
export interface WorkerJobAnswer {
  output: unknown;
  logs: string[];
}

export interface WorkerJobRunner {
  run(
    input: unknown,
    attempt: number,
    log: WorkerLog,
    progress: (progress: WorkerJobProgress) => void,
  ): Promise<WorkerJobAnswer>;
}

/** True inside a worker thread of the offload pool, where `@FrontMcp` records its metadata but serves nothing. */
export function isOffloadWorker(): boolean {
  return Reflect.get(globalThis, OFFLOAD_WORKER_MARKER) === true;
}

export function workerResourceReaders(): Map<string, WorkerResourceReader> {
  return globalMap<WorkerResourceReader>(WORKER_RESOURCES_KEY);
}

export function workerJobRunners(): Map<string, WorkerJobRunner> {
  return globalMap<WorkerJobRunner>(WORKER_JOBS_KEY);
}

function globalMap<T>(key: symbol): Map<string, T> {
  const existing: unknown = Reflect.get(globalThis, key);
  if (existing instanceof Map) return existing;
  const map = new Map<string, T>();
  Reflect.set(globalThis, key, map);
  return map;
}

/** A worker resource by its module, name and URI (or URI template), so two of one module that share a name differ. */
export function workerResourceKey(file: string, name: string, uri: string): string {
  return `${file}#${name}#${uri}`;
}

/** A worker job by its module and name. */
export function workerJobKey(file: string, name: string): string {
  return `${file}#${name}`;
}
