/**
 * @frontmcp/lazy-zod — Drop-in zod replacement with lazy compound-schema
 * construction.
 *
 *  - `z`: lazy-by-default. Import anywhere you'd import zod's `z`.
 *  - `eagerZ`: straight real zod, zero proxy overhead.
 *  - `lazyZ(factory)`: explicit factory-style lazy wrapper.
 *  - `isLazy`, `forceMaterialize`: runtime escape hatches.
 */

export { z } from './lazy-z';
export { eagerZ } from './eager-z';
export { lazyZ, LazyZodSchema, LAZY_BRAND, LAZY_TARGET, type InferLazy } from './lazy-schema';
export { isLazy, forceMaterialize } from './utils';

// JSON-Schema conversion helpers from zod itself. Kept here so consumer
// code never reaches past the `@frontmcp/lazy-zod` boundary into `zod/v4`
// directly — one place to swap the upstream package if we ever fork.
export { toJSONSchema } from 'zod';
export type { JSONSchema } from 'zod/v4/core';

// Class values — Zod v4 exports these as classes (callable + `instanceof`).
// SDK tool.utils uses `schema instanceof ZodString` etc., so they must be
// exported as VALUES, not type-only (the `instanceof` RHS is a value).
export {
  NEVER,
  ZodAny,
  ZodArray,
  ZodBigInt,
  ZodBoolean,
  ZodDate,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEnum,
  ZodError,
  ZodIntersection,
  ZodLiteral,
  ZodNever,
  ZodNull,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodRecord,
  ZodString,
  ZodSymbol,
  ZodTuple,
  ZodType,
  ZodUndefined,
  ZodUnion,
  ZodUnknown,
  ZodVoid,
} from 'zod';

// Type-only re-exports (no runtime class).
export type { ZodTypeAny, ZodRawShape, infer, input, output } from 'zod';
