import type { ResourceContext, ResourceCtorArgs } from '../common/interfaces/resource.interface';
import type { ResourceMetadata, ResourceTemplateMetadata } from '../common/metadata';
import { workerResourceKey, workerResourceReaders, type WorkerResourceReader } from './offload-worker.globals';

export type AnyResourceMetadata = ResourceMetadata | ResourceTemplateMetadata;
export type WorkerResourceClass = new (args: ResourceCtorArgs) => ResourceContext;
export type WorkerResourceHandler = (uri: string, params: Record<string, string>, context: ResourceContext) => unknown;

export type WorkerResourceTarget =
  | { kind: 'class'; cls: WorkerResourceClass }
  | { kind: 'function'; handler: WorkerResourceHandler };

/** The module a worker imports to read a `worker: true` resource, and the resource's name. */
export interface WorkerResourceSource {
  file: string | undefined;
  name: string;
}

const sources = new WeakMap<object, WorkerResourceSource>();

/** Record where a `worker: true` resource class is declared, and how a worker that imported that module reads it. */
export function registerWorkerResourceClass(
  cls: WorkerResourceClass,
  metadata: AnyResourceMetadata,
  file: string | undefined,
): void {
  register(cls, { kind: 'class', cls }, metadata, file);
}

/** The same for a function-style resource, by its handler. */
export function registerWorkerResourceHandler(
  handler: WorkerResourceHandler,
  metadata: AnyResourceMetadata,
  file: string | undefined,
): void {
  register(handler, { kind: 'function', handler }, metadata, file);
}

export function workerResourceSourceOf(target: unknown): WorkerResourceSource | undefined {
  return typeof target === 'function' ? sources.get(target) : undefined;
}

function register(
  key: object,
  target: WorkerResourceTarget,
  metadata: AnyResourceMetadata,
  file: string | undefined,
): void {
  sources.set(key, { file, name: metadata.name });
  if (!file) return;
  const reader: WorkerResourceReader = {
    read: async (uri, params, log) => {
      const { readWorkerResource } = await import('./worker-resource.reader.js');
      return readWorkerResource(target, metadata, uri, params, log);
    },
  };
  workerResourceReaders().set(workerResourceKey(file, metadata.name), reader);
}
