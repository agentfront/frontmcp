---
name: always-define-output-schema
constraint: Every `@Tool` defines `outputSchema`.
severity: required
---

# Rule: every tool defines `outputSchema`

## The rule

Every `@Tool({...})` block declares `outputSchema`. There is no acceptable case for omitting it on a production tool.

## Good

```typescript
@Tool({
  name: 'get_weather',
  description: 'Current weather for a city',
  inputSchema: { city: z.string() },
  outputSchema: {
    temperatureF: z.number(),
    conditions: z.string(),
  },
})
class GetWeatherTool extends ToolContext {
  async execute(input: { city: string }) {
    const apiResponse = await this.fetch(`https://api.example.com/weather?city=${input.city}`);
    const data = await apiResponse.json();
    // Even though `data` contains { temperatureF, conditions, internalApiKey, debugTrace, … }
    // — the outputSchema strips everything except `temperatureF` and `conditions`.
    return data;
  }
}
```

## Bad

```typescript
// ❌ no outputSchema — every field in `data` flows through to the client
@Tool({
  name: 'get_weather',
  description: 'Current weather for a city',
  inputSchema: { city: z.string() },
})
class GetWeatherTool extends ToolContext {
  async execute(input: { city: string }) {
    const apiResponse = await this.fetch(`https://api.example.com/weather?city=${input.city}`);
    return apiResponse.json(); // ← internalApiKey, debugTrace, PII … all leak
  }
}
```

## Why

1. **Output validation prevents data leaks.** Without `outputSchema`, every field your code accidentally includes (or that an upstream API drops in unsolicited — auth tokens, internal IDs, debug traces, PII) reaches the MCP client. With it, only declared fields pass through; everything else is stripped.
2. **CodeCall plugin compatibility.** The CodeCall plugin uses `outputSchema` to understand what a tool returns, enabling correct VM-based orchestration and pass-by-reference. Tools without `outputSchema` degrade CodeCall's ability to chain calls.
3. **Type safety on `execute()`'s return type.** With `outputSchema` declared, `ToolContext` infers the expected return type from it. The compiler tells you when your return value diverges from the declared shape.
4. **Self-documenting tools.** `tools/list` exposes the output structure to AI clients; they can choose the right tool based on what it returns.

## How to apply

- For structured data: **Zod raw shape** is the recommended form — `{ field: z.string(), count: z.number() }`. Strict, validated, JSON-serializable.
- For a single primitive: use the literal — `outputSchema: 'string' | 'number' | 'boolean' | 'date'`.
- For media: `'image'`, `'audio'`, `'resource'`, `'resource_link'`.
- For multi-content: an array — `outputSchema: ['string', 'image']`.
- For complex types not expressible as a raw shape: full Zod schemas — `z.object(...)`, `z.discriminatedUnion([...])`, etc. (Note: this is the one place `z.object()` is allowed — it's _not_ allowed for `inputSchema`.)

See [`output-schema.md`](../references/output-schema.md) for the full taxonomy.

## Verification

```bash
# Grep for tools without outputSchema — should return 0 hits
grep -L 'outputSchema:' $(grep -rl '@Tool' --include='*.tool.ts' src/)
```

A failing CI step that runs this grep is the cheapest way to enforce the rule across a codebase.
