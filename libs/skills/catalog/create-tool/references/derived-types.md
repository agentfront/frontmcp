---
name: derived-types
description: Derive execute() parameter and return types from the schemas via ToolInputOf / ToolOutputOf.
---

# Derived `execute()` types

The schema is the single source of truth. Hand-typing `execute(input: { name: string })` next to a schema declaring `name: z.string()` is a second declaration of the same shape — change the schema without touching the annotation and TypeScript happily compiles while runtime validation silently rejects.

Derive types from the schemas with `ToolInputOf<>` / `ToolOutputOf<>`. The compiler catches divergence at build time.

## Pattern

```typescript
// src/apps/main/tools/greet-user.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = {
  name: z.string().describe('The name to greet'),
};

export const outputSchema = {
  greeting: z.string(),
};

export type GreetUserInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type GreetUserOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

```typescript
// src/apps/main/tools/greet-user.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';

import { inputSchema, outputSchema, type GreetUserInput, type GreetUserOutput } from './greet-user.schema';

@Tool({
  name: 'greet_user',
  description: 'Greet a user by name',
  inputSchema,
  outputSchema,
})
export class GreetUserTool extends ToolContext {
  async execute(input: GreetUserInput): Promise<GreetUserOutput> {
    return { greeting: `Hello, ${input.name}!` };
  }
}
```

## Two equivalent forms

```typescript
// Form 1 — SDK helpers (preferred — survives any future shape changes to ToolContext)
type GreetUserInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
type GreetUserOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;

// Form 2 — raw zod (terser if you don't mind a direct z dependency)
type GreetUserInput = z.infer<z.ZodObject<typeof inputSchema>>;
type GreetUserOutput = z.infer<z.ZodObject<typeof outputSchema>>;
```

Both produce identical types. Pick whichever fits the surrounding code. Form 1 is recommended because `ToolInputOf` / `ToolOutputOf` track any future shape changes to `ToolContext` (e.g., if metadata wrapping changes).

## What to hoist, what to leave inline

Hoist **only the schemas** to `<name>.schema.ts`. The decorator config (`name`, `description`, `annotations`, `rateLimit`, `authProviders`, …) stays inside `@Tool({…})` where it belongs.

```typescript
// ✅ schemas only — re-importable by specs, sibling tools, generated clients
export const inputSchema = { … };
export const outputSchema = { … };

// ❌ don't hoist the @Tool config — it's tool-specific metadata, not a shape contract
export const toolConfig = { name: 'greet_user', description: '…', inputSchema, outputSchema };
```

## Don't add generics to ToolContext

```typescript
// ❌ ToolContext<typeof inputSchema> — redundant; @Tool decorator already infers them
class GreetUserTool extends ToolContext<typeof inputSchema> { … }

// ✅ Plain ToolContext — @Tool's inference flows in automatically
class GreetUserTool extends ToolContext { … }
```

See [`rules/no-toolcontext-generics.md`](../rules/no-toolcontext-generics.md).

## Why derive?

| Without derived types                                                                                                                    | With derived types                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Change `inputSchema` → execute()'s `input:` annotation silently goes stale → runtime validation rejects calls that the compiler accepted | Change `inputSchema` → execute() signature follows → compiler catches drift at the call site |
| Specs and helpers hand-type their own shapes (third source of truth)                                                                     | Specs import `GreetUserInput` from the schema file (one source of truth)                     |
| Generated clients drift from server contract                                                                                             | Generated clients import the same exported types                                             |

## See also

- [`input-schema.md`](./input-schema.md)
- [`output-schema.md`](./output-schema.md)
- [`file-layout.md`](./file-layout.md)
- [`rules/derive-execute-types.md`](../rules/derive-execute-types.md)
- [`rules/no-toolcontext-generics.md`](../rules/no-toolcontext-generics.md)
