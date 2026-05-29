---
name: 19-tool-with-elicitation
level: advanced
description: 'Tool that pauses mid-execution to ask the user for confirmation + extra input via `this.elicit(...)` — the safe pattern for destructive or expensive actions.'
tags: [elicitation, this.elicit, destructive-action, confirmation]
features:
  - 'Calling `this.elicit(message, { fieldSchema })` to request interactive input mid-`execute()`'
  - 'Branching on `result.action` — `accept` / `decline` / `cancel` — and matching the early returns against `outputSchema`'
  - 'Pairing elicitation with `annotations.destructiveHint: true` so clients know to render the confirmation prominently'
  - "Requiring `elicitation: { enabled: true }` at the `@FrontMcp({...})` server level — and what fails when it isn't"
---

# Tool With Elicitation

Tool that pauses mid-execution to ask the user for confirmation + extra input via `this.elicit(...)` — the safe pattern for destructive or expensive actions.

For destructive or expensive actions, elicitation is the safe pattern. The tool starts, pauses, asks the user "are you sure? what reason?", and finishes (or cancels) based on the answer.

> Requires `elicitation: { enabled: true }` on `@FrontMcp({...})`. Without it, every `this.elicit(...)` throws `ElicitationDisabledError` at runtime.

## Code

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'demo', version: '1.0.0' },
  apps: [MainApp],
  elicitation: { enabled: true }, // ← must be enabled for this.elicit to work
})
export default class DemoServer {}
```

```typescript
// src/apps/main/tools/delete-user.tool.ts
import { PublicMcpError, Tool, ToolContext, z } from '@frontmcp/sdk';

import { USER_SERVICE } from '../tokens';

const inputSchema = { userId: z.string().describe('User ID to delete') };
const outputSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('deleted'), userId: z.string(), reason: z.string().optional() }),
  z.object({ outcome: z.literal('cancelled'), userId: z.string(), reason: z.string() }),
]);

@Tool({
  name: 'delete_user',
  description: 'Delete a user account — requires explicit confirmation',
  inputSchema,
  outputSchema,
  annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
})
export class DeleteUserTool extends ToolContext {
  async execute(input: { userId: string }) {
    const users = this.get(USER_SERVICE);
    const user = await users.findById(input.userId);
    if (!user) this.fail(new PublicMcpError(`No such user: ${input.userId}`));

    const elicited = await this.elicit(`Permanently delete ${user.email}? This cannot be undone.`, {
      confirm: z.boolean().describe('Set to true to confirm'),
      reason: z.string().optional().describe('Reason for the audit log'),
    });

    if (elicited.action === 'cancel') {
      return { outcome: 'cancelled' as const, userId: input.userId, reason: 'User closed prompt' };
    }
    if (elicited.action === 'decline' || !elicited.data.confirm) {
      return { outcome: 'cancelled' as const, userId: input.userId, reason: 'User declined' };
    }

    await users.delete(input.userId, { reason: elicited.data.reason });
    return { outcome: 'deleted' as const, userId: input.userId, reason: elicited.data.reason };
  }
}
```

## What This Demonstrates

- Calling `this.elicit(message, { fieldSchema })` to request interactive input mid-`execute()`
- Branching on `result.action` — `accept` / `decline` / `cancel` — and matching the early returns against `outputSchema`
- Pairing elicitation with `annotations.destructiveHint: true` so clients know to render the confirmation prominently
- Requiring `elicitation: { enabled: true }` at the `@FrontMcp({...})` server level — and what fails when it isn't

## `result.action` matrix

| Action      | When                                      | Always check `result.data`?                  |
| ----------- | ----------------------------------------- | -------------------------------------------- |
| `'accept'`  | User filled the form and submitted        | Yes — `result.data` is typed from the schema |
| `'decline'` | User clicked decline / no                 | No — `data` is absent                        |
| `'cancel'`  | User closed the prompt without responding | No — `data` is absent                        |

The Zod schema you pass to `this.elicit` defines the `result.data` type when action is `'accept'`.

## Early returns must match `outputSchema`

The `cancelled` branch returns `{ outcome: 'cancelled', userId, reason }` which matches the `z.discriminatedUnion` outputSchema. If `outputSchema` were `z.object({ deleted: z.boolean() })`, you'd return `{ deleted: false }` instead.

The framework validates the return regardless of how you got there — early elicitation returns are no exception.
