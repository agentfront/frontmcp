---
name: create-tool-annotations
description: Reference for MCP tool annotation hints like readOnly, destructive, and idempotent
---

# Tool Annotations Reference

Annotations provide hints to MCP clients about tool behavior:

```typescript
@Tool({
  name: 'my_tool',
  inputSchema: { ... },
  annotations: {
    title: 'My Tool',              // Human-readable display name
    readOnlyHint: true,            // Tool only reads data, no side effects
    destructiveHint: false,        // Tool does NOT destroy/delete data
    idempotentHint: true,          // Safe to call multiple times with same input
    openWorldHint: false,          // Tool does NOT interact with external world
  },
})
```

## Fields

| Field             | Type      | Default | Description                        |
| ----------------- | --------- | ------- | ---------------------------------- |
| `title`           | `string`  | —       | Human-friendly display name        |
| `readOnlyHint`    | `boolean` | `false` | Tool only reads, no mutations      |
| `destructiveHint` | `boolean` | `true`  | Tool may delete/overwrite data     |
| `idempotentHint`  | `boolean` | `false` | Repeated calls produce same result |
| `openWorldHint`   | `boolean` | `true`  | Tool may access external services  |

## Usage Guidance

- Set `readOnlyHint: true` for query/lookup tools
- Set `destructiveHint: true` for delete/overwrite operations (triggers client warnings)
- Set `idempotentHint: true` for safe-to-retry tools
- Set `openWorldHint: false` for tools that only access local data

## Examples

| Example                                                                                     | Level        | Description                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [`destructive-delete-tool`](../examples/create-tool-annotations/destructive-delete-tool.md) | Intermediate | Demonstrates annotating a tool that deletes data, enabling MCP clients to warn users before execution.                          |
| [`readonly-query-tool`](../examples/create-tool-annotations/readonly-query-tool.md)         | Basic        | Demonstrates annotating a tool that only reads data, signaling to MCP clients that it has no side effects and is safe to retry. |

> See all examples in [`examples/create-tool-annotations/`](../examples/create-tool-annotations/)
