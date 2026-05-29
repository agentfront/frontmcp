---
name: output-schema
description: Define the tool's output contract — Zod shape, primitives, media, multi-content arrays.
---

# `outputSchema` reference

`outputSchema` is **always required** ([rule](../rules/always-define-output-schema.md)). It declares what `execute()` returns and gives the framework permission to strip any fields you didn't declare — the safety net against accidental PII / token / debug-trace leaks.

## Supported shapes

| Shape                 | Use for                                                                     | Returns                                                            |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Zod raw shape**     | Structured JSON                                                             | `{ field: z.string(), count: z.number() }`                         |
| **Zod schema**        | Complex types (unions, discriminated unions, arrays of objects, transforms) | `z.object({…})`, `z.array(…)`, `z.discriminatedUnion('kind', […])` |
| **Primitive literal** | Single value                                                                | `'string'`, `'number'`, `'boolean'`, `'date'`                      |
| **Media literal**     | Binary / link content                                                       | `'image'`, `'audio'`, `'resource'`, `'resource_link'`              |
| **Array of literals** | Multi-content response                                                      | `['string', 'image']` — text + image in one response               |

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

When the output is a union, discriminated union, or array of objects:

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
  async execute(input: ChartInput): Promise<{ data: string; mimeType: string }> {
    return {
      data: 'iVBORw0KGgoAAAANSU…', // base64
      mimeType: 'image/png',
    };
  }
}
```

| Literal           | Return shape                                                            |
| ----------------- | ----------------------------------------------------------------------- |
| `'image'`         | `{ data: base64String, mimeType: 'image/png' \| 'image/jpeg' \| … }`    |
| `'audio'`         | `{ data: base64String, mimeType: 'audio/wav' \| 'audio/mpeg' \| … }`    |
| `'resource'`      | `{ uri: 'custom://…', mimeType?, text? \| blob? }` (inline resource)    |
| `'resource_link'` | `{ uri: 'custom://…' }` (link only — host fetches via `resources/read`) |

See [`26-tool-with-resource-link-output`](../examples/26-tool-with-resource-link-output.md) for the resource-link pattern.

## Multi-content arrays

Some tools return more than one block — e.g. a text summary plus an image:

```typescript
@Tool({ name: 'analyze_image', inputSchema, outputSchema: ['string', 'image'] })
class AnalyzeImageTool extends ToolContext {
  async execute(input: { imageUrl: string }): Promise<[string, { data: string; mimeType: string }]> {
    const summary = 'Detected: 2 people, 1 cat.';
    const annotated = await this.annotate(input.imageUrl);
    return [summary, { data: annotated, mimeType: 'image/png' }];
  }
}
```

## Why this matters

- **Data leak prevention** — without `outputSchema`, accidentally returning `{ result, internalApiKey }` leaks the key. With it, only `result` flows.
- **CodeCall compatibility** — the CodeCall plugin uses `outputSchema` to chain tool calls in its VM. Tools without it degrade chain-ability.
- **Compile-time type safety** — `ToolContext` infers `execute()`'s return type from `outputSchema` (when `ToolOutputOf<>` is used). The compiler catches divergence at build time.
- **Self-documenting** — `tools/list` exposes the output structure; AI clients pick tools partly based on what they return.

## See also

- [`input-schema.md`](./input-schema.md)
- [`derived-types.md`](./derived-types.md)
- [`rules/always-define-output-schema.md`](../rules/always-define-output-schema.md)
