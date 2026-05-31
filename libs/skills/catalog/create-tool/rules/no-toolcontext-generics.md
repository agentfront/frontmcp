---
name: no-toolcontext-generics
constraint: '`class MyTool extends ToolContext` — never `extends ToolContext<typeof inputSchema>`.'
severity: required
---

# Rule: don't parameterize `ToolContext` with explicit generics

## The rule

`ToolContext` infers input / output types from the `@Tool({...})` decorator at the **class** level automatically. Adding explicit generics is redundant — and prevents the inference from flowing correctly when the decorator's shape changes.

## Good

```typescript
@Tool({ name: 'greet', inputSchema, outputSchema })
class GreetTool extends ToolContext {
  async execute(input: GreetInput): Promise<GreetOutput> {
    return { greeting: `Hello, ${input.name}!` };
  }
}
```

## Bad

```typescript
// ❌ explicit generics — redundant and brittle
@Tool({ name: 'greet', inputSchema, outputSchema })
class GreetTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  // …
}

// ❌ partial generics — even worse, hides which way drift goes
class GreetTool extends ToolContext<typeof inputSchema> {
  // …
}
```

## Why

- **The decorator already infers.** `@Tool` carries the input/output schemas in its options; the SDK's decorator hooks the inferred types into the class. Explicit generics either match (redundant) or mismatch (silently break the inferred type).
- **Schema changes flow automatically.** With plain `extends ToolContext`, changing a Zod field in `<name>.schema.ts` updates everything that uses `ToolInputOf` / `ToolOutputOf` — including the `execute()` annotation. With explicit generics, you have to remember to update them.
- **Consistency** — every tool in the codebase uses plain `extends ToolContext`. Explicit generics are an outlier that flag a misunderstanding of how the decorator works.

## Verification

```bash
# Any `extends ToolContext<` is a violation
grep -rn 'extends ToolContext<' src/**/*.tool.ts
```
