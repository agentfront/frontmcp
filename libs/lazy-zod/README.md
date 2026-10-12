# @frontmcp/lazy-zod

Zod 4's `z`, with compound schemas like `z.object()` built the first time they're used instead of when the module loads. A process that defines many schemas but uses few of them per run, like a CLI, a serverless function or an edge worker, starts faster. This is an internal package: `@frontmcp/sdk` re-exports all of it, so in a FrontMCP server import `z`, `eagerZ` and `lazyZ` from `@frontmcp/sdk`. It doesn't depend on the rest of FrontMCP, so you can also use it on its own.

[![npm](https://img.shields.io/npm/v/@frontmcp/lazy-zod.svg)](https://www.npmjs.com/package/@frontmcp/lazy-zod) [![License](https://img.shields.io/npm/l/@frontmcp/lazy-zod.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/lazy-zod zod
```

`zod` `^4.0.0` is a peer dependency: the package wraps the Zod you install. Zod 3 isn't supported. It needs Node.js 24 or later.

## Usage

Import `z` from here instead of from `zod`:

```ts
import { eagerZ, lazyZ, toJSONSchema, z } from '@frontmcp/lazy-zod';

const Ticket = z.object({
  title: z.string().min(5),
  customer: z.object({ email: z.string().email() }).optional(),
});

type Ticket = z.infer<typeof Ticket>;

const ticket: Ticket = Ticket.parse({ title: 'Cannot log in' });

const jsonSchema = toJSONSchema(Ticket);

const Built = eagerZ.object({ id: eagerZ.string() });

const Deferred = lazyZ(() => eagerZ.object({ id: eagerZ.string() }));
```

`z.object()`, `z.strictObject()`, `z.looseObject()`, `z.union()`, `z.discriminatedUnion()`, `z.intersection()`, `z.record()` and `z.tuple()` return a stand-in. The real Zod schema is built the first time the stand-in is used, by a parse or by reading a property like `.shape`, and methods you chain on it, like `.optional()`, return stand-ins too. After the first parse, `parse`, `safeParse`, `parseAsync` and `safeParseAsync` call Zod directly. The other factories, like `z.string()` and `z.enum()`, are Zod's own.

A stand-in behaves like the schema it stands for: it parses the same, `instanceof ZodObject` is `true`, and `z.infer` gives the same type.

| Export                        | What it is                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `z` (also the default export) | Zod 4's `z`, with the factories above deferred.                                                                                                                                                                                                                            |
| `eagerZ`                      | Zod's own `z`. Use it for a schema that something reads as soon as it's defined.                                                                                                                                                                                           |
| `lazyZ(build)`                | A schema that calls `build()` the first time it's used, and only then.                                                                                                                                                                                                     |
| `isLazy(schema)`              | `true` for a stand-in, from `z` or from `lazyZ()`.                                                                                                                                                                                                                         |
| `forceMaterialize(schema)`    | The real Zod schema, with every stand-in inside it built.                                                                                                                                                                                                                  |
| `toJSONSchema(schema)`        | Zod's JSON Schema converter, run on `forceMaterialize(schema)`. Use it instead of Zod's own `z.toJSONSchema()`, which throws `TypeError: Cannot set properties of undefined (setting 'ref')` when an object or union in the schema is `.optional()` or has a `.default()`. |
| `ZodObject`, `ZodError`, …    | Zod's classes and types (`ZodTypeAny`, `infer`, `input`, `output`), so your code needs no import from `zod`.                                                                                                                                                               |

## Performance

The prototype this package grew from was measured on 1,515 generated schemas, bundled into one file, on Node.js 24 (medians of 30 runs):

| Metric                       | Zod's `z` | Lazy `z` |
| ---------------------------- | --------- | -------- |
| Start-up                     | 387 ms    | 7.1 ms   |
| First parse of one schema    | 0.45 ms   | 1.47 ms  |
| First parse of every schema  | 235 ms    | 616 ms   |
| Second parse of every schema | 31.0 ms   | 31.0 ms  |
| Bundle size                  | 1.69 MB   | 1.70 MB  |

The work isn't removed, it's moved: each schema costs more the first time it's parsed. Lazy schemas pay off when a process starts often and uses only some of its schemas. The benchmark, with its method and full results, is in [`apps/poc-lazy-zod`](https://github.com/agentfront/frontmcp/blob/main/apps/poc-lazy-zod/results/README.md).

## Docs

- [`z`, `eagerZ` and `lazyZ`](https://frontmcp.dev/reference/sdk#z-eagerz-and-lazyz): how FrontMCP uses this package
- [Schemas are contracts](https://frontmcp.dev/learn/schemas-are-contracts): writing input schemas for tools

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): re-exports this package. Use it in a FrontMCP server.
- [`zod`](https://www.npmjs.com/package/zod): the schema library this package wraps.

## Contributing

Source: [`libs/lazy-zod`](https://github.com/agentfront/frontmcp/tree/main/libs/lazy-zod). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
