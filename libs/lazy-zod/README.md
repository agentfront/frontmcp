# @frontmcp/lazy-zod

Drop-in Zod replacement that lazily constructs compound schemas. On bundled
CLI binaries and edge workers, this cuts module-init cold-start by ~50× on
schema-heavy entries with effectively zero steady-state parse overhead.

## Why

In a benchmark of 1,515 realistic schemas (see `apps/poc-lazy-zod/`):

| Metric              | Eager zod | Lazy zod | Delta    |
| ------------------- | --------- | -------- | -------- |
| Cold-start (median) | 387 ms    | 7.1 ms   | **−98%** |
| First-parse         | 0.45 ms   | 1.47 ms  | +1 ms    |
| Parse-all (steady)  | 31 ms     | 31 ms    | +0.2%    |
| Bundle size         | 1.69 MB   | 1.70 MB  | +0.64%   |

The win comes from deferring `z.object({…})` / `z.union([…])` construction
until the first `.parse()` call — and self-patching the schema instance on
that first call so all subsequent parses bypass the wrapper entirely.

## Install

```sh
npm install @frontmcp/lazy-zod zod
```

`zod` is a peer dependency (v4).

## Usage

```ts
// Preferred — lazy by default, full drop-in for zod's `z`.
import { z } from '@frontmcp/lazy-zod';

const schema = z.object({
  name: z.string(),
  age: z.number().optional(),
});

type User = z.infer<typeof schema>; // { name: string; age?: number }
schema.parse({ name: 'Ada', age: 36 });
```

```ts
// Escape hatch — real zod, zero proxy overhead.
// Use when you need a schema to be fully-constructed at module load
// (e.g. a library will immediately introspect it via toJSONSchema).
import { eagerZ } from '@frontmcp/lazy-zod';

const eager = eagerZ.object({ foo: eagerZ.string() });
```

```ts
// Explicit factory-style wrapper — when you already have a real zod schema
// and want to defer it.
import { eagerZ, lazyZ } from '@frontmcp/lazy-zod';

const deferred = lazyZ(() => eagerZ.object({ foo: eagerZ.string() }));
deferred.parse({ foo: 'bar' }); // materializes on first call
```

When used inside FrontMCP, you don't need to depend on this package
directly — it's re-exported as `z` from `@frontmcp/sdk`.

## Status

Implemented. `z` is lazy by default — heavy compound factories (`z.object`,
`z.union`, `z.discriminatedUnion`, `z.intersection`, `z.record`, `z.tuple`,
plus `z.strictObject` / `z.looseObject`) return a `Proxy` over a
`LazyZodSchema` that materializes the real zod schema on first
`.parse()` / `.safeParse()` / `.parseAsync()` / `.safeParseAsync()` call
and self-patches the hot-path methods onto the instance so subsequent
parses run at native zod speed (measured at +0.2% steady-state overhead
in the POC). Light factories (`z.string`, `z.number`, `z.enum`,
`z.literal`, `z.lazy`, etc.) pass straight through to real zod. See
`src/lazy-z.ts` for the Proxy and `src/lazy-schema.ts` for the wrapper.
Use `eagerZ` when a consumer needs a fully-constructed schema at
import time (e.g. immediate introspection).

## License

Apache-2.0
