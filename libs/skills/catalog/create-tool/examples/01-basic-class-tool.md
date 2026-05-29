---
name: 01-basic-class-tool
level: basic
description: Minimal class-based tool with Zod input/output schemas and types derived from the schemas. The foundation every other example builds on.
tags: [foundation, class-tool, output-schema, derived-types]
features:
  - 'Extending `ToolContext` (no generics) and implementing `execute()`'
  - 'Hoisting `inputSchema` / `outputSchema` to a sibling `.schema.ts` file'
  - 'Deriving the `execute()` parameter and return types via `ToolInputOf<>` / `ToolOutputOf<>`'
  - 'Using a Zod raw shape for `inputSchema` (not `z.object(...)`)'
  - "Always defining `outputSchema` so the tool can't accidentally leak extra fields"
  - 'Registering the tool in an `@App({ tools })`'
---

# Basic Class Tool

Minimal class-based tool with Zod input/output schemas and types derived from the schemas. The foundation every other example builds on.

The foundation. Two files (schema + tool), schemas as the single source of truth, derived `execute()` types, full output validation. Every other example in this skill builds on this shape.

## Files

```
src/apps/main/tools/
├── greet-user.schema.ts      # input/output schemas + derived types
├── greet-user.tool.ts        # @Tool class, execute()
└── greet-user.tool.spec.ts   # unit test
```

## Code

```typescript
// src/apps/main/tools/greet-user.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = {
  name: z.string().min(1).describe('The name of the user to greet'),
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

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { GreetUserTool } from './tools/greet-user.tool';

@App({
  name: 'main',
  tools: [GreetUserTool],
})
export class MainApp {}
```

> **Testing.** Per-tool tests use the `@frontmcp/testing` surface — `TestServer` + Playwright-style `test` / `expect` fixtures, with `mcpMatchers` for response assertions. The full pattern lives in the dedicated `testing` skill; this skill stays focused on building the tool itself.

## What This Demonstrates

- Extending `ToolContext` (no generics) and implementing `execute()`
- Hoisting `inputSchema` / `outputSchema` to a sibling `.schema.ts` file
- Deriving the `execute()` parameter and return types via `ToolInputOf<>` / `ToolOutputOf<>`
- Using a Zod raw shape for `inputSchema` (not `z.object(...)`)
- Always defining `outputSchema` so the tool can't accidentally leak extra fields
- Registering the tool in an `@App({ tools })`

## Why each choice matters

- **No `ToolContext<typeof inputSchema>` generic** — input/output types are auto-inferred from the `@Tool` decorator at the class level. Adding the generic is a smell (see `rules/no-toolcontext-generics.md`).
- **Hoist only the schemas** (not the decorator config) to `<name>.schema.ts` — specs, sibling tools, and generated clients can `import { inputSchema, GreetUserInput }` without dragging the `@Tool` class along.
- **Use `ToolInputOf<>` / `ToolOutputOf<>`** instead of inline annotations like `execute(input: { name: string })`, which silently drift when the schema changes.
- **Raw Zod shape** for `inputSchema` — `{ name: z.string() }`, not `z.object({ name: z.string() })`. The framework wraps it internally.
- **`outputSchema` always present** — without it, returning `{ greeting, leakedSecret }` would expose `leakedSecret` to the client; with it, the field is stripped before the response leaves.
- **Register in `@App({ tools })`** (not directly in `@FrontMcp({ tools })`) — apps provide per-app lifecycle, auth, and hooks; top-level registration is the simple-server escape hatch.

## When to pick this shape over alternatives

- **Class** (this example) vs **function** (`tool({...})(handler)`) — pick class for anything with DI (`this.get`), lifecycle, hooks, or UI widgets. Pick function only for trivial pure-input tools. See [`02-basic-function-tool`](./02-basic-function-tool.md).
- **Sibling files** (this example) vs **folder-per-tool** — pick siblings for apps with ≤3 tools each. Promote to a folder once the tool has local helpers, fixtures, or its own error types. See [`references/file-layout.md`](../references/file-layout.md).

## Related rules

- [`rules/input-schema-is-raw-shape.md`](../rules/input-schema-is-raw-shape.md)
- [`rules/always-define-output-schema.md`](../rules/always-define-output-schema.md)
- [`rules/derive-execute-types.md`](../rules/derive-execute-types.md)
- [`rules/no-toolcontext-generics.md`](../rules/no-toolcontext-generics.md)
- [`rules/snake-case-tool-names.md`](../rules/snake-case-tool-names.md)
- [`rules/register-in-app.md`](../rules/register-in-app.md)
