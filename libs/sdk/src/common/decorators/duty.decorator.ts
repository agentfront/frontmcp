import 'reflect-metadata';

import { InvalidDecoratorMetadataError } from '../../errors/decorator.errors';
import { type DutyInterface } from '../interfaces/duty.interface';
import { dutyMetadataSchema, type DutyMetadata } from '../metadata/duty.metadata';
import { defineDutyMetadata } from '../metadata/duty.resolved';
import { FrontMcpProviderTokens } from '../tokens';

type DutyClass = abstract new (...args: never[]) => DutyInterface;

/**
 * Marks a provider class as a duty: once the server serves, `run()` is called every `every`, or at the times of
 * `cron`, in exactly one process of the machine, the project or the cluster (`scope`), the one that holds the duty's
 * lease. Register it in `providers`.
 */
export function Duty(metadata: DutyMetadata): (target: DutyClass) => void {
  return (target) => {
    const result = dutyMetadataSchema.safeParse(metadata);
    if (!result.success) {
      const [issue] = result.error.issues;
      throw new InvalidDecoratorMetadataError('Duty', issue.path.join('.'), issue.message);
    }
    if (typeof target.prototype?.run !== 'function') {
      throw new InvalidDecoratorMetadataError('Duty', 'run', `${target.name} has no run() method`);
    }
    Reflect.defineMetadata(FrontMcpProviderTokens.type, true, target);
    defineDutyMetadata(target, { ...result.data, name: result.data.name ?? target.name });
  };
}
