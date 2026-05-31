---
name: input-schema
description: Define the tool's input contract — raw Zod shapes, refinements, defaults, optional fields.
---

# `inputSchema` reference

The `inputSchema` field on `@Tool({...})` accepts a **Zod raw shape** — a plain object mapping field names to Zod types. The framework wraps it in `z.object(...)` internally and validates every call.

## The raw-shape rule

```typescript
// ✅ Raw shape
@Tool({
  name: 'search',
  inputSchema: {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(10),
  },
})

// ❌ z.object() at the top level
@Tool({
  name: 'search',
  inputSchema: z.object({
    query: z.string(),
  }),
})
```

See [`rules/input-schema-is-raw-shape.md`](../rules/input-schema-is-raw-shape.md). The wrapper is the framework's job — wrapping it yourself confuses the type inference and breaks `ToolInputOf<>`.

## Field types

| Want                | Zod                                                                      |
| ------------------- | ------------------------------------------------------------------------ |
| Required string     | `z.string()`                                                             |
| Optional string     | `z.string().optional()`                                                  |
| String with default | `z.string().default('hello')`                                            |
| Bounded number      | `z.number().int().min(1).max(100)`                                       |
| Number with default | `z.number().default(10)`                                                 |
| Enum                | `z.enum(['a', 'b', 'c'])`                                                |
| Array               | `z.array(z.string())`                                                    |
| Nested object       | `z.object({ city: z.string() })` (Zod object **inside** a field is fine) |
| Discriminated union | `z.discriminatedUnion('kind', […])`                                      |
| Date                | `z.string().datetime()` (ISO 8601) or `z.date()`                         |
| URL                 | `z.string().url()`                                                       |
| Email               | `z.string().email()`                                                     |
| Refined             | `z.string().refine((v) => v.length % 2 === 0, 'must be even length')`    |
| Branded             | `z.string().brand<'UserId'>()`                                           |

> Only the **top-level** `inputSchema` must be a raw shape. Nested objects use `z.object({...})` normally.

## Descriptions

Every field should carry `.describe('…')` — it's shown to AI clients in `tools/list`, helping them choose argument values:

```typescript
inputSchema: {
  city: z.string().describe('City name, e.g. "Seattle" or "Tel Aviv"'),
  units: z.enum(['celsius', 'fahrenheit']).default('celsius').describe('Temperature units'),
}
```

## Optional vs default

```typescript
inputSchema: {
  // Required — caller must provide
  query: z.string(),

  // Optional — execute() sees `string | undefined`
  category: z.string().optional(),

  // Optional with default — execute() sees `string` (the default fills in)
  limit: z.number().default(10),
}
```

## Refinements

For cross-field validation, wrap individual fields:

```typescript
inputSchema: {
  start: z.string().datetime(),
  end: z.string().datetime(),
  // single-field refinements:
  email: z.string().email().refine((v) => v.endsWith('@example.com'), 'must be a corporate email'),
}
```

For cross-field refinements (`start < end`), keep `inputSchema` simple and validate in `execute()`:

```typescript
async execute(input: { start: string; end: string }) {
  if (input.start >= input.end) {
    this.fail(new InvalidInputError('start must be before end'));
  }
  // …
}
```

(Or use a custom `.transform` / `.refine` on a wrapped `z.object({...})` _outside_ `inputSchema` and pass `.shape` — but that's usually overkill.)

## Empty input

A no-input tool declares an empty shape:

```typescript
@Tool({
  name: 'ping',
  inputSchema: {},
  outputSchema: 'string',
})
class PingTool extends ToolContext {
  execute(): string {
    return 'pong';
  }
}
```

## Where the validated input lives

After validation, `execute(input)` receives the typed/defaulted input. It's also available via `this.input` if you'd rather:

```typescript
async execute(_input: SearchInput) {
  // these are equivalent:
  const fromArg = _input.query;
  const fromCtx = this.input.query;
}
```

Prefer the parameter — it's typed without needing the `ToolInputOf<>` annotation on `this.input`.

## See also

- [`output-schema.md`](./output-schema.md)
- [`derived-types.md`](./derived-types.md)
- [`rules/input-schema-is-raw-shape.md`](../rules/input-schema-is-raw-shape.md)
