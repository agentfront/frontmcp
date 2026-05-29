---
name: derive-execute-types
constraint: '`execute()` parameter and return types come from `ToolInputOf<>` / `ToolOutputOf<>` — never duplicated inline.'
severity: required
---

# Rule: derive `execute()` types from the schemas

## The rule

`execute()`'s parameter and return types are derived from the hoisted schemas via `ToolInputOf<>` / `ToolOutputOf<>`. Hand-typing the shape inline next to the schema is a second declaration of the same contract.

## Good

```typescript
// <name>.schema.ts
export const inputSchema = { city: z.string() };
export const outputSchema = { temperatureF: z.number() };
export type GetWeatherInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type GetWeatherOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;

// <name>.tool.ts
async execute(input: GetWeatherInput): Promise<GetWeatherOutput> {
  return { temperatureF: 72 };
}
```

## Bad

```typescript
// ❌ inline annotation duplicates the schema's shape
async execute(input: { city: string }): Promise<{ temperatureF: number }> {
  return { temperatureF: 72 };
}
```

Why it's bad: change the schema (`city` → `location`, add `units`) without touching the annotation and TypeScript happily compiles. Runtime Zod validation rejects the request that the compiler accepted.

## Why

- **Single source of truth** — the schema defines the contract. Types derived from it can't drift. Hand-typed shapes silently rot when the schema changes.
- **Re-importable** — specs, sibling tools, and generated clients all `import { GetWeatherInput }` from the same `.schema.ts` file. They get one canonical type.
- **Compiler catches drift** — change a schema field, and the compiler flags every place that reads the old shape. Inline annotations defeat this.

## How to apply

- Always hoist `inputSchema` / `outputSchema` to `<name>.schema.ts`.
- Always export `type <X>Input = ToolInputOf<{ inputSchema: typeof inputSchema }>;` and `type <X>Output = ToolOutputOf<{ outputSchema: typeof outputSchema }>;` next to them.
- Import the derived types into the tool file and use them on `execute()`.
- Form 2 (`z.infer<z.ZodObject<typeof inputSchema>>`) produces an identical type — pick whichever fits the surrounding code.

## Verification

```bash
# Find tool files where execute() uses an inline object literal type — likely a violation
grep -rE 'execute\(input:\s*\{' src/**/*.tool.ts
```
