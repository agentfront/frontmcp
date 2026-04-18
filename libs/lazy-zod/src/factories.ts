/**
 * Classification of zod APIs for lazy-zod.
 *
 * HEAVY_FACTORIES: compound-schema factories whose construction dominates
 * cold-start cost. Calls to these on the lazy `z` return a `LazyZodSchema`.
 *
 * CHAIN_METHODS: methods called on a zod schema that return another zod
 * schema. When called on a lazy wrapper they produce a new lazy wrapper
 * whose factory is `() => parent.materialize()[method](...args)`. The
 * list is exhaustive for zod v4 to stay drop-in — any method not on the
 * list forces materialization on first access.
 */

export const HEAVY_FACTORIES: ReadonlySet<string> = new Set([
  'object',
  'union',
  'discriminatedUnion',
  'intersection',
  'record',
  'tuple',
]);

export const CHAIN_METHODS: ReadonlySet<string> = new Set([
  // ZodType generic
  'optional',
  'nullable',
  'nullish',
  'default',
  'describe',
  'refine',
  'superRefine',
  'transform',
  'pipe',
  'or',
  'and',
  'readonly',
  'brand',
  'catch',
  'array',
  'promise',
  // ZodString
  'email',
  'url',
  'uuid',
  'cuid',
  'cuid2',
  'ulid',
  'regex',
  'startsWith',
  'endsWith',
  'trim',
  'toLowerCase',
  'toUpperCase',
  'datetime',
  'date',
  'time',
  'ip',
  'cidr',
  'base64',
  'base64url',
  'jwt',
  'nanoid',
  'emoji',
  'includes',
  'normalize',
  // ZodString / ZodNumber / ZodArray — shared (`Set` dedupes)
  'min',
  'max',
  'length',
  'gt',
  'gte',
  'lt',
  'lte',
  // ZodNumber
  'int',
  'positive',
  'negative',
  'nonnegative',
  'nonpositive',
  'finite',
  'safe',
  'multipleOf',
  'step',
  // ZodObject
  'extend',
  'merge',
  'pick',
  'omit',
  'partial',
  'deepPartial',
  'required',
  'passthrough',
  'strict',
  'strip',
  'catchall',
  'keyof',
  // ZodArray
  'nonempty',
  'element',
  // ZodEnum
  'extract',
  'exclude',
]);
