---
name: execution-context
description: What ToolContext provides at runtime — this.get, this.fetch, this.notify, this.context.
---

# `ToolContext` runtime API

`ToolContext` extends `ExecutionContextBase`. Inside `execute()` you have access to:

## Methods

| Method                                                           | Purpose                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `execute(input: In): Promise<Out>`                               | The method you implement                                                                                       |
| `this.get(token)`                                                | Resolve a DI dependency. Throws `DependencyNotFoundError` if not registered.                                   |
| `this.tryGet(token)`                                             | Resolve a DI dependency. Returns `undefined` if not registered.                                                |
| `this.fail(err)`                                                 | Abort execution, trigger the error flow. **Never returns.** Use for business-logic errors.                     |
| `this.respond(value)`                                            | Early-return with a value. Validates against `outputSchema`. **Never returns** (throws `FlowControl.respond`). |
| `this.mark(stage)`                                               | Set the active execution stage for debugging / tracing                                                         |
| `this.fetch(input, init?)`                                       | HTTP fetch with context propagation (trace headers, etc.)                                                      |
| `this.notify(message, level?)`                                   | Send a log-level notification to the client                                                                    |
| `this.progress(progress, total?, message?)`                      | Send a progress notification. Returns `Promise<boolean>` (false when no progress token in request)             |
| `this.notifyResourceUpdated(uri)`                                | Tell subscribed clients a resource's contents changed (`notifications/resources/updated`)                      |
| `this.notifyResourceListChanged()`                               | Tell clients the resource list changed (`notifications/resources/list_changed`)                                |
| `this.elicit(message, schema)`                                   | Request interactive input from the user mid-execution. See [`elicitation.md`](./elicitation.md)                |
| `this.isPlatform(os)` / `this.isRuntime(rt)` / `this.isEnv(env)` | Imperative platform checks (declarative form is `availableWhen` — see [`availability.md`](./availability.md))  |

## Properties

| Property        | Type                  | Description                                                                                                                                                                |
| --------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `this.input`    | `In`                  | The validated input object (same value as the `input` parameter)                                                                                                           |
| `this.output`   | `Out \| undefined`    | The output value (available after `execute()` returns)                                                                                                                     |
| `this.metadata` | tool metadata         | Frozen view of the `@Tool({...})` config                                                                                                                                   |
| `this.scope`    | scope instance        | The current scope — DI lookups, child scopes                                                                                                                               |
| `this.context`  | `FrontMcpContext`     | Per-request context (see below)                                                                                                                                            |
| `this.auth`     | `FrontMcpAuthContext` | User identity & claims — `this.auth.user.sub`, `this.auth.claims['…']`, `hasRole()`, `hasPermission()`, `hasScope()`. Use this (not `this.context.authInfo`) for identity. |

## `this.context` (FrontMcpContext)

| Property       | Type              | Description                                                                                                                                                                                              |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestId`    | `string`          | Unique ID for this request                                                                                                                                                                               |
| `sessionId`    | `string`          | Session identifier (for stateful transports)                                                                                                                                                             |
| `scopeId`      | `string`          | Scope identifier (for multi-app servers)                                                                                                                                                                 |
| `authInfo`     | `AuthInfo`        | Raw validated access token — `token`, `clientId`, `scopes`, `expiresAt?`, `resource?`, `extra?`. For user identity / JWT claims use `this.auth` (`this.auth.user.sub`, `this.auth.claims['…']`) instead. |
| `traceContext` | `TraceContext`    | Distributed-tracing context (propagated to `this.fetch` automatically)                                                                                                                                   |
| `timestamp`    | `number`          | Request start timestamp                                                                                                                                                                                  |
| `metadata`     | `RequestMetadata` | Request headers, client IP, MCP client name/version                                                                                                                                                      |

## DI: `this.get` vs `this.tryGet`

```typescript
import { Token } from '@frontmcp/di';

interface UserService { findById(id: string): Promise<User | null>; }
const USER_SERVICE: Token<UserService> = Symbol('UserService');

async execute(input: { userId: string }) {
  // Throws DependencyNotFoundError if USER_SERVICE isn't registered in scope
  const users = this.get(USER_SERVICE);

  // Returns undefined if not registered — for optional deps
  const cache = this.tryGet(CACHE);
  if (cache) {
    const cached = await cache.get(input.userId);
    if (cached) return cached;
  }

  const user = await users.findById(input.userId);
  if (!user) this.fail(new ResourceNotFoundError(`user:${input.userId}`));
  return user;
}
```

Use `this.get` (throws) when the tool genuinely requires the dependency. Use `this.tryGet` (returns undefined) when the tool degrades gracefully without it (e.g., optional cache, optional metrics emitter).

## HTTP: `this.fetch`

`this.fetch` is a thin wrapper around the standard `fetch` that propagates the request's `traceContext` so downstream services can stitch the call into the same trace.

```typescript
async execute(input: { url: string }) {
  const response = await this.fetch(input.url);
  if (!response.ok) {
    this.fail(new InternalMcpError(`upstream returned ${response.status}`));
  }
  return response.json();
}
```

It accepts the same arguments as standard `fetch`:

```typescript
this.fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(5_000),
});
```

> Don't `try/catch` around the fetch and swallow errors — let infrastructure errors propagate to the framework. Only use `this.fail` for **business-logic** errors. See [`error-handling.md`](./error-handling.md).

## Notifications: `this.notify` + `this.progress`

```typescript
async execute(input: { items: string[] }) {
  this.mark('validation');
  // …
  this.mark('processing');
  for (let i = 0; i < input.items.length; i++) {
    await this.progress(i + 1, input.items.length, `Processing ${input.items[i]}`);
    await this.processItem(input.items[i]);
  }
  await this.notify(`Processed ${input.items.length} items`, 'info');
  this.mark('complete');
  return { processed: input.items.length };
}
```

- `this.notify(msg, level?)` — sends `notifications/message` to the client (`debug` / `info` / `warning` / `error`). Always-best-effort.
- `this.progress(n, total?, msg?)` — sends `notifications/progress` IF the request had a progress token. Returns `false` when no token was provided (so the call costs almost nothing if nobody's listening).
- `this.mark(stage)` — server-side breadcrumb, surfaced in logs / metrics / traces. No client notification.
- `this.notifyResourceUpdated(uri)` — sends `notifications/resources/updated` to every session subscribed to `uri` (via `resources/subscribe`); no-op for non-subscribers. Call it when a tool mutates state that backs a `@Resource` so subscribers re-fetch.
- `this.notifyResourceListChanged()` — broadcasts `notifications/resources/list_changed` so clients re-run `resources/list`. Call it after a tool adds or removes resources at runtime.

```typescript
async execute(input: { id: string; title: string }) {
  await this.get(NOTES).save(input.id, input.title);
  this.notifyResourceUpdated(`notes://${input.id}`); // subscribers re-fetch this resource
  return { ok: true };
}
```

See [`18-tool-with-progress-and-notify`](../examples/18-tool-with-progress-and-notify.md).

## Early return: `this.respond`

Both `return value` and `this.respond(value)` validate against `outputSchema`. `this.respond` throws an internal `FlowControl.respond` and never returns — useful for early-exit branches:

```typescript
async execute(input: Input) {
  const cached = await this.tryGet(CACHE)?.get(input.key);
  if (cached) this.respond(cached);   // never returns; just for early exit

  const result = await this.compute(input);
  return result;
}
```

> `this.respond` doesn't bypass `outputSchema` — its argument is validated like a normal return value.

## See also

- [`error-handling.md`](./error-handling.md)
- [`auth-providers.md`](./auth-providers.md) — `this.authProviders` (and `this.auth` for user identity / claims)
- [`elicitation.md`](./elicitation.md) — `this.elicit`
