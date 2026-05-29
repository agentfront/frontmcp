---
name: input-schema-is-raw-shape
constraint: '`inputSchema` is a raw Zod shape, never `z.object(...)`.'
severity: required
---

# Rule: `inputSchema` is a raw Zod shape

## The rule

The top-level value of `inputSchema` is a plain object mapping field names to Zod types. The framework wraps it in `z.object(...)` internally and validates every call.

## Good

```typescript
@Tool({
  name: 'search',
  inputSchema: {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(10),
  },
})
```

Nested `z.object({...})` INSIDE a field is fine — only the top-level value must be a raw shape:

```typescript
inputSchema: {
  user: z.object({ id: z.string(), name: z.string() }), // OK — nested
  filter: z.array(z.string()),
}
```

## Bad

```typescript
// ❌ wrapped at the top level
@Tool({
  name: 'search',
  inputSchema: z.object({
    query: z.string(),
  }),
})

// ❌ wrapped via z.union / z.intersection at the top
inputSchema: z.union([z.object({...}), z.object({...})]),
```

## Why

- **Type inference** — `ToolInputOf<{ inputSchema: typeof inputSchema }>` and the SDK's decorator inference both assume the raw-shape form. Wrapping breaks both.
- **`@Tool` metadata** — the decorator reads `inputSchema` as a `Record<string, ZodType>` to compute the JSON schema published in `tools/list`. A wrapped `z.object` defeats this.
- **Consistency** — every tool in the codebase uses the same form. A wrapped `inputSchema` is an outlier that confuses readers and breaks grep-based code search.

If you legitimately need a union or transform for input, do it inside `execute()`:

```typescript
inputSchema: {
  start: z.string().datetime(),
  end: z.string().datetime(),
}

async execute(input) {
  if (input.start >= input.end) {
    this.fail(new InvalidInputError('start must be before end'));
  }
  // …
}
```

## Verification

```bash
# Any `inputSchema: z.` is a violation
grep -rE 'inputSchema:\s*z\.' src/**/*.tool.ts
```
