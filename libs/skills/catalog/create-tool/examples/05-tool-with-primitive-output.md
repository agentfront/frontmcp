---
name: 05-tool-with-primitive-output
level: basic
description: "Tool returning a single primitive — `outputSchema: 'string' | 'number' | 'boolean' | 'date'` for single-value outputs."
tags: [output-schema, primitive-output]
features:
  - "Using a primitive literal (`'string'`, `'number'`, `'boolean'`, `'date'`) for `outputSchema`"
  - 'Returning the bare value directly from `execute()` instead of wrapping it'
  - Picking primitive literals over a one-field Zod shape for ergonomic clarity
  - 'Four concrete tools in one file (`fmt_currency`, `add`, `is_palindrome`, `now`) demonstrating each primitive form'
---

# Tool With Primitive Output

Tool returning a single primitive — `outputSchema: 'string' | 'number' | 'boolean' | 'date'` for single-value outputs.

For tools that return a single value, declare `outputSchema` as a primitive literal. The framework wraps the bare return in the right MCP content block.

## Code

```typescript
// src/apps/main/tools/primitives.tool.ts
import { Tool, tool, ToolContext, z } from '@frontmcp/sdk';

// 1. string output
@Tool({
  name: 'fmt_currency',
  description: 'Format a number as USD',
  inputSchema: { amount: z.number() },
  outputSchema: 'string',
})
export class FmtCurrencyTool extends ToolContext {
  execute(input: { amount: number }): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(input.amount);
  }
}

// 2. number output (function-style)
export const Add = tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: 'number',
})((input) => input.a + input.b);

// 3. boolean output
@Tool({
  name: 'is_palindrome',
  description: 'Check whether a string reads the same forward and backward',
  inputSchema: { text: z.string() },
  outputSchema: 'boolean',
})
export class IsPalindromeTool extends ToolContext {
  execute(input: { text: string }): boolean {
    const t = input.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    return t === t.split('').reverse().join('');
  }
}

// 4. date output
@Tool({
  name: 'now',
  description: 'Current server time',
  inputSchema: {},
  outputSchema: 'date',
})
export class NowTool extends ToolContext {
  execute(): Date {
    return new Date();
  }
}
```

## What This Demonstrates

- Using a primitive literal (`'string'`, `'number'`, `'boolean'`, `'date'`) for `outputSchema`
- Returning the bare value directly from `execute()` instead of wrapping it
- Picking primitive literals over a one-field Zod shape for ergonomic clarity
- Four concrete tools in one file (`fmt_currency`, `add`, `is_palindrome`, `now`) demonstrating each primitive form

## When to pick primitive literals over a Zod shape

```typescript
// ✅ primitive literal — clean
outputSchema: 'number',
execute() { return 42; }

// ❌ one-field Zod shape — unnecessarily nested
outputSchema: { value: z.number() },
execute() { return { value: 42 }; }
```

The primitive form returns the bare value; the shape form wraps it in `{ value }`. Pick primitive when you literally want one value back.
