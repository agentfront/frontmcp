---
name: output-schema
description: Define the tool's output contract — Zod shape, primitives, media, multi-content arrays.
---

# `outputSchema` reference

`outputSchema` is **always required** ([rule](../rules/always-define-output-schema.md)). It declares what `execute()` returns, and the framework strips any fields you didn't declare, which guards against accidental PII / token / debug-trace leaks in the result. In development (`NODE_ENV=development`) it also warns once per tool about the keys it stripped; see [Undeclared keys](#undeclared-keys) to change that. The exception is a `_meta` object on the returned value: it is copied into the response's `_meta` without validation, so never put secrets there. A result that does not match fails the call with `_meta.code: 'INVALID_OUTPUT'`, and nothing from the rejected result is sent. A number field holding `Infinity`, `-Infinity`, or `NaN` fails the same way, unless the server sets `output: { allowNonFinite: true }`. JSON cannot encode those values, so with that setting the client receives `null` in their place.

## Supported shapes

| Shape                 | Use for                                                                     | Returns                                                            |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Zod raw shape**     | Structured JSON                                                             | `{ field: z.string(), count: z.number() }`                         |
| **Zod schema**        | Complex types (unions, discriminated unions, arrays of objects, transforms) | `z.object({…})`, `z.array(…)`, `z.discriminatedUnion('kind', […])` |
| **Primitive literal** | Single value                                                                | `'string'`, `'number'`, `'boolean'`, `'date'`                      |
| **Media literal**     | Binary / link content                                                       | `'image'`, `'audio'`, `'resource'`, `'resource_link'`              |
| **Array of literals** | Multi-content response                                                      | `['string', 'image']` — text + image in one response               |

Two runtime facts that follow from the shape:

- Without an `outputSchema`, a plain value is wrapped: `return 'hello'` sends `{"value":"hello"}` as text and `structuredContent: { value: 'hello' }` (numbers likewise, `{ value: 8 }`). Declare `outputSchema: 'string'` (or `'number'`) to send the bare value as text.
- `execute()` must return something. Returning `undefined` fails the call with `_meta.code: 'FLOW_EXITED_WITHOUT_OUTPUT'`; return an explicit result such as `{ ok: true }` from side-effect-only tools.

## Zod raw shape (most common)

```typescript
const outputSchema = {
  temperatureF: z.number(),
  conditions: z.string(),
  humidityPct: z.number().int().min(0).max(100),
};

@Tool({ name: 'get_weather', inputSchema, outputSchema })
class GetWeatherTool extends ToolContext {
  async execute(input: GetWeatherInput): Promise<GetWeatherOutput> {
    const data = await this.fetch(`https://api.weather.example/${input.city}`).then((r) => r.json());
    // Even if `data` contains { temperatureF, conditions, internalApiKey, debugTrace, … }
    // only temperatureF / conditions / humidityPct flow through.
    return data;
  }
}
```

## Zod schema (full Zod)

Use a full Zod schema when the output is a union, discriminated union, or array of objects. `z.union([...])` and `z.discriminatedUnion(...)` type-check as `outputSchema` with no cast:

```typescript
const outputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string(), name: z.string() }),
  z.object({ kind: z.literal('group'), id: z.string(), members: z.array(z.string()) }),
]);

@Tool({ name: 'resolve_principal', inputSchema, outputSchema })
class ResolvePrincipalTool extends ToolContext {
  async execute(input: { handle: string }) {
    return { kind: 'user' as const, id: 'u_1', name: 'Ada' };
  }
}
```

`z.object()` is fine here — it's only the **top-level `inputSchema`** that must be a raw shape, not `outputSchema`.

## Primitive literals

For single-value outputs:

```typescript
@Tool({ name: 'add', inputSchema: { a: z.number(), b: z.number() }, outputSchema: 'number' })
class AddTool extends ToolContext {
  execute(input: { a: number; b: number }): number {
    return input.a + input.b;
  }
}

@Tool({ name: 'now', inputSchema: {}, outputSchema: 'date' })
class NowTool extends ToolContext {
  execute(): Date {
    return new Date();
  }
}
```

## Media literals

Binary content or links to MCP resources:

```typescript
@Tool({ name: 'render_chart', inputSchema, outputSchema: 'image' })
class RenderChartTool extends ToolContext {
  async execute(input: ChartInput): Promise<{ type: 'image'; data: string; mimeType: string }> {
    return {
      type: 'image' as const, // required — without it the content block is dropped
      data: 'iVBORw0KGgoAAAANSU…', // base64
      mimeType: 'image/png',
    };
  }
}
```

Each return object must carry the matching `type` discriminator (`'image'`, `'audio'`, `'resource'`, `'resource_link'`) — without it the content block is silently dropped:

| Literal           | Return shape                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `'image'`         | `{ type: 'image', data: base64String, mimeType: 'image/png' \| 'image/jpeg' \| … }`            |
| `'audio'`         | `{ type: 'audio', data: base64String, mimeType: 'audio/wav' \| 'audio/mpeg' \| … }`            |
| `'resource'`      | `{ type: 'resource', resource: { uri: 'custom://…', mimeType?, text? \| blob? } }`             |
| `'resource_link'` | `{ type: 'resource_link', uri: 'custom://…' }` (link only — host fetches via `resources/read`) |

See [`26-tool-with-resource-link-output`](../examples/26-tool-with-resource-link-output.md) for the resource-link pattern.

## Multi-content arrays

Some tools return more than one block — e.g. a text summary plus an image:

```typescript
@Tool({ name: 'analyze_image', inputSchema, outputSchema: ['string', 'image'] })
class AnalyzeImageTool extends ToolContext {
  async execute(input: { imageUrl: string }): Promise<[string, { type: 'image'; data: string; mimeType: string }]> {
    const summary = 'Detected: 2 people, 1 cat.';
    const annotated = await this.annotate(input.imageUrl);
    return [summary, { type: 'image' as const, data: annotated, mimeType: 'image/png' }];
  }
}
```

## Advertisement in `tools/list`

Structured object outputs are converted to JSON Schema and advertised on the tool's `outputSchema` in `tools/list` — symmetric with how `inputSchema` is advertised:

- **Advertised:** a Zod raw shape (`{ field: z.string() }`) or a top-level `z.object({...})` — these serialize to a `type: 'object'` JSON Schema. A `z.union([...])` or `z.discriminatedUnion(...)` whose members are all objects is advertised too, as `{ type: 'object', anyOf: [...] }` (or `oneOf` for a discriminated union), since MCP requires a top-level `type: 'object'`. A member registered with an id (`.meta({ id })`) serializes to a `$ref` into `$defs` and counts as an object too.
- **Not advertised, by design:** primitives (`'string'` / `'number'` / `'boolean'` / `'date'`, `z.string()`, …), media (`'image'` / `'audio'` / `'resource'` / `'resource_link'`), and multi-content arrays (`['string', 'image']`). These flow through `content` rather than `structuredContent`.
- **Not advertised, with a startup warning:** any other Zod schema — an array (`z.array(...)`), a nullable object, a union with a non-object member, or a schema that has no JSON Schema form (a `z.date()` field). The server logs `Tool "<name>": tools/list leaves out its outputSchema because …` once at startup, naming the tool, unless the tool's `schemaMode` resolves to `'none'`. Wrap the value in a `z.object({...})` to advertise it.

Runtime output validation still applies to every form. If a client reports _"Output schema recommended,"_ declare a structured object `outputSchema` (a raw shape, a `z.object`, or a union of `z.object`s) — that's the form that gets advertised.

### Exposure mode

A cascading `output` policy controls _how_ the (object-shaped) schema reaches clients in `tools/list`. Declare it on `@FrontMcp`, `@App`, or `@Tool`:

```typescript
output?: {
  schemaMode?: 'definition' | 'description' | 'both' | 'none'; // default 'definition'
  schemaDescriptionFormat?: 'summary' | 'jsonSchema';          // default 'summary'
  undeclaredKeys?: 'strip' | 'warn' | 'keep' | 'fail';         // see Undeclared keys
};
```

| `schemaMode`    | Effect                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| `'definition'`  | **Default.** Advertise the schema as the tool's `outputSchema` (JSON Schema).           |
| `'description'` | Fold a readable rendering of the schema into the tool description; omit `outputSchema`. |
| `'both'`        | Advertise as `outputSchema` **and** fold it into the description.                       |
| `'none'`        | Expose nothing — no `outputSchema`, no description suffix.                              |

`schemaDescriptionFormat` controls the rendering for `'description'` / `'both'`: `'summary'` (default) is a compact property list; `'jsonSchema'` is a fenced JSON Schema block.

The effective value resolves with a **Tool > App > server > default** cascade — set a server-wide default on `@FrontMcp` and override per tool. A tool that a plugin or an adapter of an app contributes follows that app's `output`. This mirrors the OpenAPI adapter's `outputSchema.mode`.

```typescript
// This tool folds its schema into the description instead of advertising `outputSchema`
@Tool({ name: 'get_status', inputSchema, outputSchema, output: { schemaMode: 'description' } })
class GetStatusTool extends ToolContext {
  /* … */
}
```

The default (`'definition'`) preserves the current behavior described above — omit `output` entirely and nothing changes.

## Undeclared keys

`output.undeclaredKeys` decides what `tools/call` does with keys an answer carries that `outputSchema` does not declare, at any depth (`costCenter`, `lines[].margin`). It cascades **Tool > App > server > default**, like `schemaMode`.

| `undeclaredKeys` | Effect                                                                                                                                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'strip'`        | Drop them. **Default** outside development.                                                                                                                                                                                                                                                                          |
| `'warn'`         | Drop them and log a warning naming each key once per tool (up to 100 keys per tool). **Default** when `NODE_ENV=development`.                                                                                                                                                                                        |
| `'keep'`         | Send them in `structuredContent` and the text content. `tools/list` lists the schema's objects without `additionalProperties: false`, so clients accept them. A key it cannot put back, because the schema turned the object holding it into a primitive (`z.coerce.string()`), refuses the answer as `'fail'` does. |
| `'fail'`         | Refuse the answer with `_meta.code: 'INVALID_OUTPUT'`; the error message in the server log names the keys. Nothing from the answer is sent.                                                                                                                                                                          |

```typescript
// Fail loudly when an upstream API starts returning fields the tool never declared
@Tool({ name: 'get_invoice', inputSchema, outputSchema, output: { undeclaredKeys: 'fail' } })
class GetInvoiceTool extends ToolContext {
  /* … */
}
```

A call that renders the tool's UI (`@Tool({ ui })`) sends declared keys only, whatever the policy: the widget, the text content and `structuredContent` are built from the declared fields. An `outputSchema` with a transform anywhere (`.transform()`, `z.preprocess()`, `.pipe()`) is always stripped too: its output cannot be compared with the answer key by key, so `'warn'`, `'keep'` and `'fail'` do not apply to it. A JSON Schema output (the OpenAPI adapter, a remote app) is not parsed, so its answer is sent as the upstream returned it, whatever the policy. An object schema that sets its own unknown-key handling also wins over the policy: `z.strictObject()` (`.strict()`) refuses an answer with undeclared keys (`INVALID_OUTPUT`), even under `'keep'`, and `z.looseObject()` (`.passthrough()`) keeps them, even under `'strip'` or `'fail'`.

A `z.union([...])` keeps the first member that matches, so a key that only a later member declares is stripped, and `'warn'` and `'fail'` report it. Put the widest member first, or use `z.discriminatedUnion(...)`, which picks the member by its discriminator.

To check in a test that an answer has no undeclared keys, use the `@frontmcp/testing` matcher:

```typescript
import { expect } from '@frontmcp/testing';

expect(await tool.execute({ id: 'INV-1' })).toPassOutputSchemaWhole(outputSchema);
// fails with: … parsing drops keys it does not declare: costCenter, lines[].margin
```

The matcher fails for a schema with a transform, for the same reason; assert on the parsed answer there.

## Why this matters

- **Data leak prevention** — without `outputSchema`, accidentally returning `{ result, internalApiKey }` leaks the key. With it, only `result` flows (unless `output.undeclaredKeys` is `'keep'`).
- **CodeCall compatibility** — the CodeCall plugin uses `outputSchema` to chain tool calls in its VM. Tools without it degrade chain-ability.
- **Compile-time type safety** — `ToolContext` infers `execute()`'s return type from `outputSchema` (when `ToolOutputOf<>` is used). The compiler catches divergence at build time.
- **Self-documenting** — a structured object `outputSchema` is converted to JSON Schema and exposed in `tools/list` (see [Advertisement in `tools/list`](#advertisement-in-toolslist)); AI clients pick tools partly based on what they return.

## See also

- [`input-schema.md`](./input-schema.md)
- [`derived-types.md`](./derived-types.md)
- [`rules/always-define-output-schema.md`](../rules/always-define-output-schema.md)
