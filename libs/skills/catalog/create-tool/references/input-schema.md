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

`tools/list` describes what the caller sends: a field with `.default()` is not listed as required, and a field with `.transform()` is listed by its input type.

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

## Undeclared arguments

Parsing drops argument keys `inputSchema` does not declare, at any depth (`timeoutMs` sent to a tool that declares `timeoutSec`, `filter.owner`), so the call runs without them. `input.undeclaredKeys` decides whether anyone hears of it. It cascades **Tool > App > server > default**, like `output.undeclaredKeys`.

| `undeclaredKeys` | Effect                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `'strip'`        | Drop them (the 1.12 default outside development).                                                                                                                                                                  |
| `'warn'`         | Drop them, log a server warning naming each key once per tool, and end the answer with a text line the model reads: `These arguments are not declared and were ignored: 'timeoutMs' (did you mean 'timeoutSec'?).` |
| `'fail'`         | Refuse the call with `INVALID_INPUT`: `Unknown arguments: 'timeoutMs' (did you mean 'timeoutSec'?)`. `execute()` does not run. **Default** since 1.13.                                                             |

```typescript
// Run calls without the arguments the tool does not declare, and tell the model which ones were ignored
@Tool({ name: 'agent_wait', inputSchema: { timeoutSec: z.number().default(45) }, input: { undeclaredKeys: 'warn' } })
class AgentWaitTool extends ToolContext {
  /* … */
}
```

The closest declared key is named for a top-level key close enough to be a slip, compared without case. Below a field whose schema has a transform (`.transform()`, `z.transform()`, `z.preprocess()`, `.pipe()`) or a `.catch()` fallback the parsed value can differ in shape from what was sent, so only the field itself is checked. A message names the first 20 undeclared arguments and counts the rest, and cuts a key longer than 64 characters short. A tool whose input is a JSON Schema (a remote app, the OpenAPI adapter) keeps every argument, so the policy does not apply to it. Up to 1.12.2 undeclared arguments were dropped without a word in every environment; 1.12 dropped them by default (`'warn'` in development), and 1.13 refuses them by default: set `'strip'` or `'warn'` where clients send arguments a tool does not declare.

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
