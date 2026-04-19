import { z as realZ } from 'zod';

import { HEAVY_FACTORIES } from './factories';
import { LazyZodSchema, wrapLazy } from './lazy-schema';

/**
 * Lazy-by-default `z`. Proxy over real zod's `z`:
 *  - Heavy compound factories (`object`, `union`, `discriminatedUnion`,
 *    `intersection`, `record`, `tuple`) return a `LazyZodSchema` Proxy —
 *    construction deferred until first `.parse()`.
 *  - Everything else (`string`, `number`, `boolean`, `enum`, `literal`,
 *    `lazy`, `custom`, etc.) passes through unchanged. Primitives are
 *    already cheap; the type constructors are phantom at runtime.
 *
 * Typed as `typeof realZ` so every zod value helper works identically,
 * and a declaration-merged `namespace z` below re-exports zod's type
 * namespace so `z.infer<T>`, `z.ZodObject<Shape>`, `z.ZodRawShape`, etc.
 * resolve at the TYPE level (a const alone doesn't expose the namespace).
 */
const lazyProxy: typeof realZ = new Proxy(realZ, {
  get(target, key, receiver) {
    if (typeof key === 'string' && HEAVY_FACTORIES.has(key)) {
      const realFactory = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[key];
      return (...args: unknown[]) =>
        wrapLazy(new LazyZodSchema(() => realFactory.call(target, ...args) as ReturnType<typeof realFactory> as never));
    }
    return Reflect.get(target, key, receiver);
  },
}) as typeof realZ;

export const z: typeof realZ = lazyProxy;

/* eslint-disable @typescript-eslint/no-namespace */
// Type-only namespace merged with the `const z` above so consumers can write
// `z.infer<T>`, `z.ZodType`, `z.ZodObject<Shape>`, etc. Each alias delegates
// unconstrained to the zod native type — no constraint narrowing that would
// cause silent inference drift.
export namespace z {
  export type infer<T> = realZ.infer<T>;
  export type output<T> = realZ.output<T>;
  export type input<T> = realZ.input<T>;

  // MUST match zod v4's exact generic defaults (unknown/unknown). My earlier
  // signature (Input = Output) produced stricter typing that broke
  // `ZodType<T>` assignability from schemas whose INPUT differs from OUTPUT
  // (e.g. anything using `.default(...)` / `.optional()`).
  export type ZodType<Output = unknown, Input = unknown> = realZ.ZodType<Output, Input>;
  export type ZodTypeAny = realZ.ZodTypeAny;
  export type ZodRawShape = realZ.ZodRawShape;

  export type ZodObject<T extends realZ.ZodRawShape = realZ.ZodRawShape> = realZ.ZodObject<T>;
  export type ZodArray<T extends realZ.ZodTypeAny = realZ.ZodTypeAny> = realZ.ZodArray<T>;
  export type ZodUnion<T extends readonly realZ.ZodTypeAny[] = readonly realZ.ZodTypeAny[]> = realZ.ZodUnion<T>;
  export type ZodDiscriminatedUnion<O = any, D = any> = realZ.ZodDiscriminatedUnion<
    O extends readonly realZ.core.SomeType[] ? O : never,
    D extends string ? D : never
  >;
  export type ZodIntersection<
    L extends realZ.ZodTypeAny = realZ.ZodTypeAny,
    R extends realZ.ZodTypeAny = realZ.ZodTypeAny,
  > = realZ.ZodIntersection<L, R>;
  export type ZodTuple<T extends readonly realZ.ZodTypeAny[] = readonly realZ.ZodTypeAny[]> = realZ.ZodTuple<T>;
  export type ZodRecord<K = any, V = any> = realZ.ZodRecord<
    K extends realZ.core.$ZodRecordKey ? K : never,
    V extends realZ.core.SomeType ? V : never
  >;

  export type ZodString = realZ.ZodString;
  export type ZodNumber = realZ.ZodNumber;
  export type ZodBoolean = realZ.ZodBoolean;
  export type ZodBigInt = realZ.ZodBigInt;
  export type ZodDate = realZ.ZodDate;
  export type ZodSymbol = realZ.ZodSymbol;
  export type ZodEnum<T = any> = realZ.ZodEnum<
    T extends Readonly<Record<string, realZ.core.util.EnumValue>> ? T : never
  >;
  export type ZodLiteral<T = any> = realZ.ZodLiteral<T extends realZ.core.util.Literal ? T : never>;
  export type ZodNull = realZ.ZodNull;
  export type ZodUndefined = realZ.ZodUndefined;
  export type ZodVoid = realZ.ZodVoid;
  export type ZodAny = realZ.ZodAny;
  export type ZodUnknown = realZ.ZodUnknown;
  export type ZodNever = realZ.ZodNever;

  export type ZodOptional<T extends realZ.ZodTypeAny = realZ.ZodTypeAny> = realZ.ZodOptional<T>;
  export type ZodNullable<T extends realZ.ZodTypeAny = realZ.ZodTypeAny> = realZ.ZodNullable<T>;
  export type ZodDefault<T extends realZ.ZodTypeAny = realZ.ZodTypeAny> = realZ.ZodDefault<T>;

  export type ZodError = realZ.ZodError;
}
/* eslint-enable @typescript-eslint/no-namespace */
