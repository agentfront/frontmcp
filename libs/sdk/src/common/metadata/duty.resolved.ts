import type { ResolvedDutyMetadata } from './duty.metadata';

const DUTY_METADATA = Symbol.for('frontmcp:duty');

/** @internal Records what `@Duty` resolved on the class. */
export function defineDutyMetadata(target: object, metadata: ResolvedDutyMetadata): void {
  Reflect.defineMetadata(DUTY_METADATA, metadata, target);
}

/** The `@Duty` metadata of an instance's class, when it has some. */
export function dutyMetadataOf(value: unknown): ResolvedDutyMetadata | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.getMetadata(DUTY_METADATA, value.constructor);
}
