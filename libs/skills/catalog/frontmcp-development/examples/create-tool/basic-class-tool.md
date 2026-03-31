---
name: basic-class-tool
reference: create-tool
level: basic
description: 'A minimal tool using the class-based pattern with Zod input validation and output schema.'
tags: [development, tool, class]
features:
  - 'Extending `ToolContext` and implementing the `execute()` method'
  - 'Using a Zod raw shape for `inputSchema` (not wrapped in `z.object()`)'
  - 'Defining `outputSchema` to validate and restrict output fields'
  - 'Registering the tool in an `@App` via the `tools` array'
---

# Basic Class-Based Tool

A minimal tool using the class-based pattern with Zod input validation and output schema.

## Code

```typescript
// src/apps/main/tools/greet-user.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'greet_user',
  description: 'Greet a user by name',
  inputSchema: {
    name: z.string().describe('The name of the user to greet'),
  },
  outputSchema: {
    greeting: z.string(),
  },
})
class GreetUserTool extends ToolContext {
  async execute(input: { name: string }): Promise<{ greeting: string }> {
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
- Registering the tool in an `@App` via the `tools` array

## Related

- See `create-tool` for the full API reference including annotations, rate limiting, and elicitation
