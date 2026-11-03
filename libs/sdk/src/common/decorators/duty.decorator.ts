import 'reflect-metadata';

import { InvalidDecoratorMetadataError } from '../../errors/decorator.errors';
import { type DutyInterface } from '../interfaces/duty.interface';
import { defineDutyMetadata, dutyMetadataSchema, type DutyMetadata } from '../metadata/duty.metadata';
import { FrontMcpProviderTokens } from '../tokens';

type DutyClass = abstract new (...args: never[]) => DutyInterface;

/**
 * Marks a provider class as a duty: once the server serves, `run()` is called every `every` in exactly one process
 * of the machine or project (`scope`), the one that holds the duty's lease. Register it in `providers`.
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
    const { name = target.name, every: everyMs, scope, leaseMs } = result.data;
    const defaultLeaseMs = Math.min(Math.max(3 * everyMs, 3_000), 60_000);
    Reflect.defineMetadata(FrontMcpProviderTokens.type, true, target);
    defineDutyMetadata(target, { name, everyMs, scope, leaseMs: leaseMs ?? defaultLeaseMs });
  };
}
