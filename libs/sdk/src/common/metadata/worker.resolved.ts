import type { ResolvedWorkerMetadata } from './worker.metadata';

const WORKER_METADATA = Symbol.for('frontmcp:worker');

/** @internal Records what `@Worker` resolved on the class. */
export function defineWorkerMetadata(target: object, metadata: ResolvedWorkerMetadata): void {
  Reflect.defineMetadata(WORKER_METADATA, metadata, target);
}

/** The `@Worker` metadata of an instance's class, when it has some. */
export function workerMetadataOf(value: unknown): ResolvedWorkerMetadata | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.getMetadata(WORKER_METADATA, value.constructor);
}
