/** Set on a worker thread's global scope before it imports a module for offloaded work. */
export const OFFLOAD_WORKER_MARKER = Symbol.for('@frontmcp/sdk:offload-worker');

/** Where a worker finds the readers of the `worker: true` resources its imports registered. */
export const WORKER_RESOURCES_KEY = Symbol.for('@frontmcp/sdk:worker-resources');

export type WorkerLogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error';

export type WorkerLog = (level: WorkerLogLevel, text: string) => void;

export interface WorkerResourceReader {
  read(uri: string, params: Record<string, string>, log: WorkerLog): Promise<unknown>;
}

/** True inside a worker thread of the offload pool, where `@FrontMcp` records its metadata but serves nothing. */
export function isOffloadWorker(): boolean {
  return Reflect.get(globalThis, OFFLOAD_WORKER_MARKER) === true;
}

export function workerResourceReaders(): Map<string, WorkerResourceReader> {
  const existing: unknown = Reflect.get(globalThis, WORKER_RESOURCES_KEY);
  if (existing instanceof Map) return existing;
  const readers = new Map<string, WorkerResourceReader>();
  Reflect.set(globalThis, WORKER_RESOURCES_KEY, readers);
  return readers;
}

export function workerResourceKey(file: string, name: string): string {
  return `${file}#${name}`;
}
