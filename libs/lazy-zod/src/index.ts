/**
 * @frontmcp/lazy-zod — Drop-in zod replacement with lazy compound-schema
 * construction.
 *
 *  - `z`: lazy-by-default. Import anywhere you'd import zod's `z`.
 *  - `eagerZ`: straight real zod, zero proxy overhead.
 *  - `lazyZ(factory)`: explicit factory-style lazy wrapper.
 *  - `isLazy`, `forceMaterialize`: runtime escape hatches.
 */

import { toJSONSchema as zodToJSONSchema, type ZodType } from 'zod';

import { forceMaterialize } from './utils';

export { z } from './lazy-z';
// Default export mirrors zod's own `export default z` so existing code
// like `import type z from 'zod'` (namespace-default import) keeps working
// when the source is flipped to `'@frontmcp/lazy-zod'` / `'@frontmcp/sdk'`.
// Without this, consumers who use the default import get `any`, which
// cascades into `any.ZodObject<T>` etc. and breaks decorator inference.
export { z as default } from './lazy-z';
export { eagerZ } from './eager-z';
export { lazyZ, LazyZodSchema, LAZY_BRAND, LAZY_TARGET, type InferLazy } from './lazy-schema';
export { isLazy, forceMaterialize } from './utils';

// JSON-Schema conversion. Kept here so consumer code never reaches past the
// `@frontmcp/lazy-zod` boundary into `zod/v4` directly — one place to swap the
// upstream package if we ever fork.
//
// IMPORTANT: zod's `toJSONSchema` walks and MUTATES the schema tree via internal
// `_def` nodes (it writes a `ref` onto each visited node). A lazy-zod Proxy
// sitting anywhere in that tree — e.g. a `z.union([...])` option or an
// `.optional()` inner type — intercepts `_def` in a way that breaks those
// writes, surfacing as `TypeError: Cannot set properties of undefined (setting
// 'ref')`. We `forceMaterialize` first so the converter always sees real zod
// nodes. Doing it HERE keeps the lazy Proxy fully transparent to every consumer
// (tool/job/agent/elicitation schema conversion) instead of relying on each
// call site remembering to materialize.
export const toJSONSchema = ((schema: ZodType, params?: unknown) =>
  (zodToJSONSchema as (s: ZodType, p?: unknown) => unknown)(
    forceMaterialize(schema),
    params,
  )) as typeof zodToJSONSchema;
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
