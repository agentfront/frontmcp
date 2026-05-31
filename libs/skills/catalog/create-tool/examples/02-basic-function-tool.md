---
name: 02-basic-function-tool
level: basic
description: 'Function-style `tool({...})(handler)` for a tiny pure-input tool — pick this over a class only when the tool needs no DI / lifecycle / UI.'
tags: [foundation, function-tool, tool-builder]
features:
  - 'Using the `tool({...})(handler)` builder for a one-liner'
  - "Returning a primitive via `outputSchema: 'number'`"
  - 'Registering the function-style tool in `@App({ tools })` exactly like a class tool'
  - "When function-style is the right choice (and when it isn't)"
---

# Basic Function Tool

Function-style `tool({...})(handler)` for a tiny pure-input tool — pick this over a class only when the tool needs no DI / lifecycle / UI.

For trivial pure-input tools, the `tool()` function builder is a one-liner alternative to `@Tool` + class.

## Code

```typescript
// src/apps/main/tools/add-numbers.tool.ts
import { tool, z } from '@frontmcp/sdk';

export const AddNumbers = tool({
  name: 'add_numbers',
  description: 'Add two numbers',
  inputSchema: {
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  },
  outputSchema: 'number',
})((input) => input.a + input.b);
```

```typescript
// src/apps/main/tools/add-numbers.e2e.spec.ts
import { expect, test } from '@frontmcp/testing';

test.use({
  server: './src/main.ts',
  port: 3004,
});

test('adds two numbers', async ({ mcp }) => {
  // mcp.tools.call returns a ToolResultWrapper around the MCP CallToolResult.
  // A primitive `outputSchema: 'number'` surfaces as text content "5" and
  // structuredContent `{ content: 5 }` — assert on the MCP result, not on `5` directly.
  const result = await mcp.tools.call('add_numbers', { a: 2, b: 3 });

  expect(result).toBeSuccessful();
  expect(result).toHaveTextContent('5');
  expect(result.json()).toEqual({ content: 5 });
});
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { AddNumbers } from './tools/add-numbers.tool';

@App({ name: 'main', tools: [AddNumbers] })
export class MainApp {}
```

## What This Demonstrates

- Using the `tool({...})(handler)` builder for a one-liner
- Returning a primitive via `outputSchema: 'number'`
- Registering the function-style tool in `@App({ tools })` exactly like a class tool
- When function-style is the right choice (and when it isn't)

## When to pick function-style over class

- ✅ Pure math / formatting / parsing — no DI, no lifecycle, no UI widget
- ❌ Anything that needs `this.get(TOKEN)` — promote to class
- ❌ Anything with a `ui:` widget — class + folder-per-tool layout is cleaner

See [`references/function-style-builder.md`](../references/function-style-builder.md) for the full `tool()` surface, including `(input, ctx)` handler form with `ctx.get` / `ctx.fetch` (to fail, `throw new PublicMcpError(...)` — `ctx.fail` is class-tool only).
