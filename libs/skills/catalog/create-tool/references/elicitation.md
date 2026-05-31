---
name: elicitation
description: this.elicit — request interactive input mid-execution. Server enable + accept/decline/cancel flow.
---

# Elicitation

`this.elicit(message, requestedSchema)` lets a tool ask for additional input mid-execution. The MCP client renders a UI (form / prompt), the user fills it in, and the response flows back to your `execute()` body. `requestedSchema` must be a Zod schema (e.g. `z.object({...})`), not a raw field map.

## Prerequisite — enable at server level

```typescript
@FrontMcp({
  info: { name: '…', version: '1.0.0' },
  apps: [MainApp],
  elicitation: { enabled: true },
})
```

Without `elicitation.enabled: true`, every `this.elicit(...)` call throws `ElicitationDisabledError` at runtime. There is no compile-time warning — the error only fires when the tool actually runs.

For production, configure a Redis-backed elicitation store via `elicitation.store: { provider: 'redis', … }` (the default in-memory store loses pending elicitations on restart).

## Quick example

```typescript
@Tool({
  name: 'confirm_delete',
  description: 'Delete a resource after explicit user confirmation',
  inputSchema: { resourceId: z.string() },
  outputSchema: { deleted: z.boolean() },
  annotations: { destructiveHint: true, idempotentHint: true },
})
class ConfirmDeleteTool extends ToolContext {
  async execute(input: { resourceId: string }) {
    const result = await this.elicit(
      'Permanently delete this resource? This cannot be undone.',
      z.object({
        confirm: z.boolean().describe('Type true to confirm'),
        reason: z.string().optional().describe('Optional reason for the audit log'),
      }),
    );

    if (result.status !== 'accept' || !result.content?.confirm) {
      return { deleted: false };
    }

    await this.get(ResourceService).delete(input.resourceId, { reason: result.content.reason });
    return { deleted: true };
  }
}
```

## Return shape

`this.elicit` returns:

```typescript
interface ElicitResult<T> {
  status: 'accept' | 'decline' | 'cancel';
  content?: T; // present only when status === 'accept'
}
```

Always check `result.status === 'accept'` before reading `result.content` — `content` only exists on `accept`.

## Multiple fields, optional fields, defaults

```typescript
const result = await this.elicit(
  'Choose deployment options',
  z.object({
    environment: z.enum(['staging', 'production']).default('staging'),
    rollback: z.boolean().default(false).describe('Roll back on first health-check failure'),
    notifyChannel: z.string().optional().describe('Notification channel (e.g. #ops)'),
  }),
);

if (result.status === 'accept') {
  // result.content: { environment: 'staging' | 'production'; rollback: boolean; notifyChannel?: string }
}
```

## What clients render

The client's UI varies — MCP Inspector shows a JSON form, Claude / ChatGPT may render a structured input dialog. Field types translate roughly:

| Zod                               | Typical UI                                            |
| --------------------------------- | ----------------------------------------------------- |
| `z.string()`                      | Single-line text input                                |
| `z.string().describe('long…')`    | Textarea if `describe` includes the word "multi-line" |
| `z.number()` / `z.number().int()` | Number input with stepper                             |
| `z.boolean()`                     | Checkbox                                              |
| `z.enum([…])`                     | Select / radio group                                  |
| `z.string().email()`              | Email input                                           |
| `z.string().url()`                | URL input                                             |
| `z.string().datetime()`           | Date-time picker                                      |

Treat the UI as best-effort — don't depend on a particular widget. The contract is the Zod schema; the rendering is the host's job.

## Early return on decline / cancel

Early returns must still match `outputSchema`:

```typescript
async execute(input: { resourceId: string }) {
  const result = await this.elicit('Delete?', z.object({ confirm: z.boolean() }));
  if (result.status !== 'accept') {
    // Must return a value matching outputSchema — not a raw error string
    return { deleted: false };
  }
  // …
}
```

If declining should propagate as an error to the client (rather than a normal output), use `this.fail` instead:

```typescript
if (result.status === 'decline') {
  this.fail(new PublicMcpError('User declined the destructive action.'));
}
```

## See also

- [`19-tool-with-elicitation`](../examples/19-tool-with-elicitation.md)
- [`execution-context.md`](./execution-context.md)
- `config` skill — `elicitation.store` (Redis vs memory) configuration
