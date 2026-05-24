---
name: basic-class-tool
reference: create-tool
level: basic
description: 'A minimal tool using the class-based pattern with Zod input validation, output schema, and types derived from the schemas.'
tags: [development, tool, class]
features:
  - 'Extending `ToolContext` and implementing the `execute()` method'
  - 'Using a Zod raw shape for `inputSchema` (not wrapped in `z.object()`)'
  - 'Defining `outputSchema` to validate and restrict output fields'
  - 'Deriving `execute()` input/output types from the schemas via `ToolInputOf<>` / `ToolOutputOf<>` (no duplicated annotation)'
  - 'Co-locating schema and tool in sibling files (`<name>.schema.ts` / `<name>.tool.ts`)'
  - 'Registering the tool in an `@App` via the `tools` array'
---

# Basic Class-Based Tool

A minimal tool using the class-based pattern with Zod input validation, output schema, and types derived from the schemas.

## Code

```typescript
// src/apps/main/tools/greet-user.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

// Hoist only the schemas — keep `@Tool({…})` self-contained in the tool file.
export const inputSchema = {
  name: z.string().describe('The name of the user to greet'),
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
class GreetUserTool extends ToolContext {
  async execute(input: GreetUserInput): Promise<GreetUserOutput> {
    return { greeting: `Hello, ${input.name}!` };
  }
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'main',
  tools: [GreetUserTool],
})
class MainApp {}
```

## What This Demonstrates

- Extending `ToolContext` and implementing the `execute()` method
- Using a Zod raw shape for `inputSchema` (not wrapped in `z.object()`)
- Defining `outputSchema` to validate and restrict output fields
- Deriving `execute()` input/output types from the schemas via `ToolInputOf<>` / `ToolOutputOf<>` (no duplicated annotation)
- Co-locating schema and tool in sibling files (`<name>.schema.ts` / `<name>.tool.ts`)
- Registering the tool in an `@App` via the `tools` array

## Related

- See `create-tool` for the full API reference including the derive-types pattern, file layouts, annotations, rate limiting, and elicitation
