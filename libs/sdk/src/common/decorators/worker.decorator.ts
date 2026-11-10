import 'reflect-metadata';

import { InvalidDecoratorMetadataError } from '../../errors/decorator.errors';
import { type WorkerInterface } from '../interfaces/worker.interface';
import { workerMetadataSchema, type WorkerMetadata } from '../metadata/worker.metadata';
import { defineWorkerMetadata } from '../metadata/worker.resolved';
import { FrontMcpProviderTokens } from '../tokens';

type WorkerClass = abstract new (...args: never[]) => WorkerInterface;

/**
 * Marks a provider class as a worker: once the server serves, `run()` is started and kept running, restarted after a
 * wait when it returns or throws, until the server shuts down. With a `scope` other than `'process'`, it runs in
 * exactly one process of the machine, the project or the cluster, the one that holds the worker's lease. Register it
 * in `providers`.
 */
export function Worker(metadata: WorkerMetadata): (target: WorkerClass) => void {
  return (target) => {
    const result = workerMetadataSchema.safeParse(metadata);
    if (!result.success) {
      const [issue] = result.error.issues;
      throw new InvalidDecoratorMetadataError('Worker', issue.path.join('.'), issue.message);
    }
    if (typeof target.prototype?.run !== 'function') {
      throw new InvalidDecoratorMetadataError('Worker', 'run', `${target.name} has no run() method`);
    }
    Reflect.defineMetadata(FrontMcpProviderTokens.type, true, target);
    defineWorkerMetadata(target, { ...result.data, name: result.data.name ?? target.name });
  };
}
