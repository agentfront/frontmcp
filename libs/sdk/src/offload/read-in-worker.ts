import type { ResourceContext } from '../common/interfaces/resource.interface';
import type { ResourceWorkerOption } from '../common/metadata';
import { InvalidOffloadCallError } from '../errors/offload.errors';
import { OffloadService } from './offload.service';
import { workerResourceSourceOf } from './worker-resources';

/** Run the read of a `worker: true` resource in the scope's offload pool, for the read-resource flow. */
export function readInWorker(
  context: ResourceContext,
  provide: unknown,
  worker: ResourceWorkerOption,
  uri: string,
  params: Record<string, string>,
): Promise<unknown> {
  const name = context.metadata.name;
  const source = workerResourceSourceOf(provide);
  if (!source?.file) {
    throw new InvalidOffloadCallError(
      `resource "${name}" sets worker, but the module that declares it was not found on the call stack, so no worker can import it (a bundle that inlines @frontmcp/sdk has no separate module to import)`,
    );
  }
  return context.get(OffloadService).run(
    { kind: 'resource', file: source.file, key: source.key, name: source.name, uri, params },
    {
      label: name,
      budgetMs: typeof worker === 'object' ? worker.budgetMs : undefined,
      signal: context.signal,
      logger: context.scope.logger.child(`resource:${name}`),
    },
  );
}
