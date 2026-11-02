import { z as realZ, type ZodTypeAny } from 'zod';
import type { $ZodMemoizer } from 'zod/v4/core';

import { HEAVY_FACTORIES, LEAF_FACTORIES } from './factories';
import { LAZY_TARGET, LazyZodSchema, wrapLazy } from './lazy-schema';
import { createLazyZ, type StandInFactory, type z } from './lazy-z';
import { isLazy } from './utils';

const BUILT_WITH_PARENT: unique symbol = Symbol('builtWithParent');

const zodConfig = realZ.config();
const defaultMemoizer = (realZ as { memoizer?: () => $ZodMemoizer }).memoizer;
const walklessMemoizers = new WeakMap<$ZodMemoizer, $ZodMemoizer>();

/** Zod's memoizer walks a container's whole subtree on its first parse, which would build every stand-in in it. */
function withoutRecursionWalk<T>(build: () => T): T {
  const saved = zodConfig.memoizer;
  const memoizer = saved ?? defaultMemoizer?.();
  if (!memoizer) return build();
  let walkless = walklessMemoizers.get(memoizer);
  if (!walkless) {
    walkless = Object.create(memoizer, { attach: { value: () => undefined } }) as $ZodMemoizer;
    walklessMemoizers.set(memoizer, walkless);
  }
  zodConfig.memoizer = walkless;
  try {
    return build();
  } finally {
    zodConfig.memoizer = saved;
  }
}

class InternalLazySchema extends LazyZodSchema {
  readonly [BUILT_WITH_PARENT]: boolean;

  constructor(factory: () => ZodTypeAny, builtWithParent: boolean) {
    super(factory);
    this[BUILT_WITH_PARENT] = builtWithParent;
  }

  protected override build(factory: () => ZodTypeAny): ZodTypeAny {
    return withoutRecursionWalk(factory);
  }

  override chain(method: string, args: unknown[]): unknown {
    return internalStandIn(
      () => {
        const real = this.materialize() as unknown as Record<string, (...a: unknown[]) => ZodTypeAny>;
        return real[method](...args.map(withBuiltChildren));
      },
      this[BUILT_WITH_PARENT] && args.every(holdsOnlyLeaves),
    );
  }
}

function internalStandIn(build: () => ZodTypeAny, builtWithParent: boolean): unknown {
  return wrapLazy(new InternalLazySchema(build, builtWithParent));
}

function targetOf(value: unknown): LazyZodSchema | undefined {
  return isLazy(value) ? (value as Record<symbol, LazyZodSchema>)[LAZY_TARGET] : undefined;
}

function isLeaf(value: unknown): boolean {
  const target = targetOf(value);
  return target === undefined || (target instanceof InternalLazySchema && target[BUILT_WITH_PARENT]);
}

function builtChild(value: unknown): unknown {
  const target = targetOf(value);
  return target && (target.isMaterialized || isLeaf(value)) ? target.materialize() : value;
}

/** A plain object of data properties: a getter can be a recursive reference, so it is never read. */
function isShape(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || isLazy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => 'value' in descriptor);
}

function childrenOf(arg: unknown): unknown[] {
  if (Array.isArray(arg)) return arg;
  if (isShape(arg)) return Reflect.ownKeys(arg).map((key) => (arg as Record<PropertyKey, unknown>)[key]);
  return [arg];
}

function holdsOnlyLeaves(arg: unknown): boolean {
  return childrenOf(arg).every(isLeaf);
}

function withBuiltChildren(arg: unknown): unknown {
  if (Array.isArray(arg)) {
    const built = arg.map(builtChild);
    return built.some((child, index) => child !== arg[index]) ? built : arg;
  }
  if (!isShape(arg)) return builtChild(arg);
  const descriptors = Object.getOwnPropertyDescriptors(arg) as Record<PropertyKey, PropertyDescriptor>;
  let changed = false;
  for (const key of Reflect.ownKeys(descriptors)) {
    const built = builtChild(descriptors[key].value);
    if (built !== descriptors[key].value) {
      descriptors[key] = { ...descriptors[key], value: built };
      changed = true;
    }
  }
  return changed ? Object.create(Object.getPrototypeOf(arg), descriptors) : arg;
}

const deferEveryFactory: StandInFactory = (name, args, build) =>
  internalStandIn(() => build(args.map(withBuiltChildren)), LEAF_FACTORIES.has(name) && args.every(holdsOnlyLeaves));

/** FrontMCP's own `z`: every factory returns a stand-in that builds its leaf children with it. Not public API. */
export const internalZ: typeof realZ = createLazyZ(
  realZ,
  new Set([...HEAVY_FACTORIES, ...LEAF_FACTORIES]),
  deferEveryFactory,
);

/* eslint-disable @typescript-eslint/no-namespace -- the same aliases as z's */
export namespace internalZ {
  export type infer<T> = z.infer<T>;
  export type output<T> = z.output<T>;
  export type input<T> = z.input<T>;
  export type ZodType<Output = unknown, Input = unknown> = z.ZodType<Output, Input>;
  export type ZodTypeAny = z.ZodTypeAny;
  export type ZodRawShape = z.ZodRawShape;
  export type ZodObject<T extends realZ.ZodRawShape = realZ.ZodRawShape> = z.ZodObject<T>;
  export type ZodArray<T extends realZ.ZodTypeAny = realZ.ZodTypeAny> = z.ZodArray<T>;
  export type ZodUnion<T extends readonly realZ.ZodTypeAny[] = readonly realZ.ZodTypeAny[]> = z.ZodUnion<T>;
  export type ZodDiscriminatedUnion<O = any, D = any> = z.ZodDiscriminatedUnion<O, D>;
  export type ZodIntersection<
    L extends realZ.ZodTypeAny = realZ.ZodTypeAny,
    R extends realZ.ZodTypeAny = realZ.ZodTypeAny,
  > = z.ZodIntersection<L, R>;
  export type ZodTuple<T extends readonly realZ.ZodTypeAny[] = readonly realZ.ZodTypeAny[]> = z.ZodTuple<T>;
  export type ZodRecord<K = any, V = any> = z.ZodRecord<K, V>;
  export type ZodString = z.ZodString;
  export type ZodNumber = z.ZodNumber;
  export type ZodBoolean = z.ZodBoolean;
  export type ZodBigInt = z.ZodBigInt;
  export type ZodDate = z.ZodDate;
  export type ZodSymbol = z.ZodSymbol;
  export type ZodEnum<T = any> = z.ZodEnum<T>;
  export type ZodLiteral<T = any> = z.ZodLiteral<T>;
  export type ZodNull = z.ZodNull;
  export type ZodUndefined = z.ZodUndefined;
  export type ZodVoid = z.ZodVoid;
  export type ZodAny = z.ZodAny;
  export type ZodUnknown = z.ZodUnknown;
  export type ZodNever = z.ZodNever;
  export type ZodOptional<T extends realZ.ZodTypeAny = realZ.ZodTypeAny> = z.ZodOptional<T>;
  export type ZodNullable<T extends realZ.ZodTypeAny = realZ.ZodTypeAny> = z.ZodNullable<T>;
  export type ZodDefault<T extends realZ.ZodTypeAny = realZ.ZodTypeAny> = z.ZodDefault<T>;
  export type ZodError = z.ZodError;
}
/* eslint-enable @typescript-eslint/no-namespace */
