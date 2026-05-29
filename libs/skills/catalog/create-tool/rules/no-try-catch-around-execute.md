---
name: no-try-catch-around-execute
constraint: 'Do not wrap the body of `execute()` in `try/catch`. The framework owns the error flow.'
severity: required
---

# Rule: don't `try/catch` around `execute()`

## The rule

The framework's tool-execution flow catches exceptions, formats them into proper JSON-RPC errors, runs error hooks, emits notifications. Wrapping the `execute()` body in a `try/catch` defeats all of that.

## Good

```typescript
async execute(input: Input) {
  const record = await this.findRecord(input.id);
  if (!record) {
    this.fail(new ResourceNotFoundError(`record:${input.id}`)); // controlled error
  }
  return doWork(record); // any other throw propagates to the framework
}
```

## Bad

```typescript
// ❌ swallows everything, hides infrastructure errors, breaks the framework's flow
async execute(input: Input) {
  try {
    const record = await this.findRecord(input.id);
    return doWork(record);
  } catch (err) {
    this.fail(err instanceof Error ? err : new Error(String(err)));
  }
}

// ❌ even worse — silently returns a default and the client never sees the failure
async execute(input: Input) {
  try {
    return await doWork(input);
  } catch {
    return { ok: false }; // 💣
  }
}
```

## Why

- **The framework's flow already catches.** It logs the error with full context, emits structured notifications, formats the JSON-RPC error with the right code, and runs error hooks (audit, metrics, telemetry). Wrapping defeats all of that.
- **Raw `Error` messages get redacted.** Without `PublicMcpError`, the framework treats the message as potentially-sensitive and replaces it with "Internal error". Manual try/catch + `this.fail(err)` strips the public-message guarantee.
- **Observability breaks.** Distributed-tracing spans, metrics counters, and audit logs all key off the framework-caught error. Manual try/catch hides the error from them.

## The narrow exception

If you have a specific failure mode the framework can't classify (a particular HTTP status, an upstream error code that means "not found" instead of "server error"), catch JUST THAT case and convert to `this.fail`:

```typescript
async execute(input: Input) {
  const response = await this.fetch(url, init);
  if (response.status === 404) {
    this.fail(new ResourceNotFoundError(`upstream:${input.id}`));
  }
  if (!response.ok) {
    this.fail(new PublicMcpError(`Upstream returned ${response.status}`));
  }
  // 5xx, network errors, timeouts — let them propagate to the framework
  return response.json();
}
```

That's not wrapping the whole `execute()` — that's targeted conversion of one specific signal. Different shape, different purpose.

## Verification

```bash
# Find try/catch directly inside execute() — should return 0 hits
grep -rPzo '(?s)async execute\([^)]*\) \{.*?try \{' src/**/*.tool.ts
```
