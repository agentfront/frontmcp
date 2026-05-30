---
name: function-style-builder
description: tool({...})(handler) — when to pick over a class, register, ctx parameter.
---

# Function-style tools — `tool({...})(handler)`

For simple tools that don't need DI, lifecycle hooks, or UI widgets, the `tool()` function builder is a one-liner alternative to a class.

## Shape

```typescript
import { tool, z } from '@frontmcp/sdk';

const AddNumbers = tool({
  name: 'add_numbers',
  description: 'Add two numbers',
  inputSchema: {
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  },
  outputSchema: 'number',
})((input) => input.a + input.b);
```

Register it the same way as a class tool:

```typescript
@App({ name: 'main', tools: [AddNumbers] })
class MainApp {}
```

## With `ctx`

The handler receives `(input, ctx)`. `ctx` is the tool's `ToolContext`, but from an external `(input, ctx) => …` handler you can only reach its **public** surface — the same members a class tool reaches via `this.*` that aren't `protected`:

```typescript
import { PublicMcpError } from '@frontmcp/sdk';

const GetCurrentUser = tool({
  name: 'get_current_user',
  description: 'Return the authenticated user',
  inputSchema: {},
  outputSchema: { id: z.string(), email: z.string().email() },
})(async (_input, ctx) => {
  // Identity comes from `ctx.auth` (not `ctx.context.authInfo`, which is the raw access token).
  const userId = ctx.auth.user?.sub;
  // `ctx.fail(...)` is protected → not callable here. Throw a PublicMcpError instead.
  if (!userId) throw new PublicMcpError('No authenticated user');
  const users = ctx.get(USER_SERVICE);
  return users.findById(userId);
});
```

`ctx` provides (public): `get`, `tryGet`, `mark`, `fetch`, `respond`, `context`, `scope`, `input`, `metadata`, `isPlatform`, `isRuntime`, `isEnv`, `callTool`, `auth`, `config`, `clientInfo`, `platform`.

> `fail`, `notify`, `progress`, and `elicit` are **`protected`** on `ToolContext` — they're reachable only from inside a class tool's `execute()` (via `this.*`), **not** from an external function-builder handler (calling them on `ctx` is a compile error). To signal a failure from a function tool, `throw new PublicMcpError(...)`. If you need `notify` / `progress` / `elicit`, use a class tool.

## When to pick which

| Class (`@Tool` + `extends ToolContext`)           | Function (`tool({...})(handler)`)      |
| ------------------------------------------------- | -------------------------------------- |
| Needs DI (`this.get`) — most production tools     | Pure-input math / formatting / parsing |
| Needs lifecycle / hooks                           | One-off conversions                    |
| Needs a `ui:` widget                              | No bridge / no widget                  |
| Wants a `.tool.spec.ts` with module-level helpers | Spec testing via simple closure        |
| Needs to be extended / decorated                  | Standalone                             |

**Default to class.** Pick function only for tools that are trivially short AND don't need DI.

## Async vs sync

The handler can be sync or async — both are fine:

```typescript
tool({ … })((input) => input.a + input.b);              // sync
tool({ … })(async (input, ctx) => { /* … */ });          // async
```

## All the decorator options work

`rateLimit`, `concurrency`, `timeout`, `annotations`, `authProviders`, `availableWhen`, `examples`, `visibility` (and the deprecated `hideFromDiscovery` alias) are all valid on the function builder:

```typescript
const SendEmail = tool({
  name: 'send_email',
  description: 'Send an email via SendGrid',
  inputSchema: { to: z.string().email(), subject: z.string(), body: z.string() },
  outputSchema: { messageId: z.string() },
  rateLimit: { maxRequests: 100, windowMs: 60_000 },
  authProviders: ['sendgrid'],
  annotations: { openWorldHint: true },
})(async (input, ctx) => {
  const headers = await ctx.authProviders.headers('sendgrid');
  // …
});
```

The `ui:` block also works:

```typescript
const ShowCard = tool({
  name: 'show_card',
  inputSchema: { text: z.string() },
  outputSchema: { text: z.string() },
  ui: {
    template: (ctx) => `<div>${ctx.helpers.escapeHtml(ctx.output.text)}</div>`,
  },
})((input) => ({ text: input.text }));
```

…but at that point, you usually want a class for the file layout and `.tool.spec.ts` ergonomics.

## See also

- [`02-basic-function-tool`](../examples/02-basic-function-tool.md)
- [`execution-context.md`](./execution-context.md) — same surface available on `ctx`
- [`registration.md`](./registration.md)
