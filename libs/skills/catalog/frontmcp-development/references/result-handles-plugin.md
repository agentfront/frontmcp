---
name: result-handles-plugin
description: Fold large tool answers into a preview, a shape and a handle, and let the model read slices with result_query
---

# Result Handles Plugin

`@frontmcp/plugin-result-handles` keeps a tool answer that is too large to send whole on the server. The client gets
`{ preview, shape, handle }` in its place, and the model reads the parts it needs with the `result_query` tool. A
handle works only for the session and the caller it was issued to, until its TTL runs out. The store keeps the answer
encrypted, under keys derived from the handle and its owner, so it holds nothing readable without the handle.

## When to Use This Skill

### Must Use

- A tool returns large lists or documents (exports, search results, logs) that would flood the model's context
- You want the model to page through a large answer instead of receiving it cut by the answer budget

### Recommended

- Combining with `output.budget`: the plugin folds first, and the budget fits what is still too large
- Tools whose answers vary in size: small answers are sent whole, only large ones fold

### Skip When

- The answer must reach the client whole (a widget renders it, or another system parses it): a UI answer is never folded
- You only need to cut answers to a size, with no way back to the rest (use `output.budget`, see `decorators-guide`)
- You want to cache answers between calls (see `official-plugins`, the Cache plugin)

> **Decision:** Use this plugin when a tool's answer is often larger than the model should read at once, and the model
> can find what it needs by path, range or page.

## Prerequisites

- `@frontmcp/sdk` and `@frontmcp/plugin-result-handles` on the same version
- A shared store (Redis, Vercel KV, Upstash or SQLite) when the server runs on more than one instance

## Steps

### Step 1: Install the plugin

```bash
npm install @frontmcp/plugin-result-handles
```

```typescript
import ResultHandlesPlugin from '@frontmcp/plugin-result-handles';
import { App } from '@frontmcp/sdk';

@App({
  name: 'Orders',
  tools: [ExportOrdersTool],
  plugins: [
    ResultHandlesPlugin.init({
      thresholdBytes: 32 * 1024, // answers over 32 KB fold (default 16 KB)
      ttlSeconds: 600, // a handle can be read for 10 minutes (default)
      preview: { items: 5, chars: 500 }, // the default
      storage: { type: 'redis', redis: { url: process.env.REDIS_URL } }, // default { type: 'auto' }
    }),
  ],
})
class OrdersApp {}
```

On an app, the plugin folds that app's tools; on `@FrontMcp({ plugins })`, every app's. It adds the `result_query`
tool; on several apps the server lists one, and it reads the handles of every app's copy. `storage` goes to
`createStorage()` from `@frontmcp/utils`; `{ type: 'sqlite', sqlite: { path } }` needs `@frontmcp/storage-sqlite`. A
memory store holds 1000 answers at most and drops the oldest (`storage.memory.maxEntries`, `0` for no limit).

### Step 2: Let tools with an output schema fold

A client checks `structuredContent` against the tool's listed `outputSchema`, so a tool with one folds only when its
schema admits the folded form. Make `foldedAnswerSchema` a member of a union:

```typescript
import { foldedAnswerSchema } from '@frontmcp/plugin-result-handles';
import { Tool, ToolContext, z } from '@frontmcp/sdk';

const reportSchema = z.object({ orders: z.array(orderSchema), total: z.number() });

@Tool({
  name: 'export_orders',
  inputSchema: { status: z.string() },
  outputSchema: z.union([reportSchema, foldedAnswerSchema]),
})
class ExportOrdersTool extends ToolContext {
  async execute({ status }: { status: string }) {
    const orders = await this.get(OrdersService).list(status);
    return { orders, total: orders.length };
  }
}
```

A tool with no output schema always admits it. A JSON Schema output schema (an OpenAPI or remote tool's) must validate
it. A tool whose schema does not admit it is sent whole, and the plugin logs one warning naming the tool.

### Step 3: Choose what folds (optional)

```typescript
ResultHandlesPlugin.init({
  foldPolicy: (toolName, answer, { bytes, fullName, request }) => toolName !== 'download_invoice',
});
```

The policy is asked only for answers over the threshold. `answer` is the answer's `structuredContent`, or its text: a
text that is a JSON object or array is parsed, so the policy (and `result_query`) gets the value, not the string.

## What the Model Sees

```json
{
  "preview": { "orders": [{ "id": 0, "status": "open" }], "total": 500 },
  "shape": {
    "type": "object",
    "keys": {
      "orders": {
        "type": "array",
        "length": 500,
        "items": { "type": "object", "keys": { "id": { "type": "number" } } }
      },
      "total": { "type": "number" }
    }
  },
  "handle": "3f1c2a4e-9b7d-4c1e-8f2a-1b2c3d4e5f60"
}
```

This is the answer's `structuredContent` and its text, followed by a text line naming `result_query`, the handle and
the TTL. `_meta['frontmcp/result-handle']` holds `{ handle, bytes, ttlSeconds }`. The preview keeps the first `items`
of each list, the first `chars` of each string and the first 50 keys of each object; the shape lists the keys, types,
list lengths and string lengths, and a list's first item.

`result_query` arguments:

| Argument | Meaning                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `handle` | The folded answer's handle (required)                                                                 |
| `path`   | `$.orders[2].note`, `orders.2.note` or the JSON pointer `/orders/2/note`; the whole answer by default |
| `offset` | First list item, or first character of a string                                                       |
| `limit`  | List items (default 20) or characters (default 2000)                                                  |
| `page`   | A page of `limit` items, from 1, in place of `offset`                                                 |
| `fields` | Keep only these keys of the object, or of each object of the list                                     |

It answers `{ path, value, total?, offset?, nextOffset? }`.

## Common Patterns

| Pattern                     | Correct                                                | Incorrect                                 | Why                                                                     |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------- |
| Output schema of a big tool | `z.union([reportSchema, foldedAnswerSchema])`          | `reportSchema` alone                      | A schema without the folded form never folds; the answer is sent whole  |
| Several instances           | `storage: { type: 'redis', redis: { url } }`           | `storage: { type: 'memory' }`             | A handle saved on one instance is "not found" on another                |
| With an answer budget       | `output.budget` above `thresholdBytes`                 | A budget below the threshold              | The plugin folds first; a budget below the folded size cuts the preview |
| Reading back in a tool      | `this.callTool('export_orders')` gets the whole answer | Expecting a handle from `this.callTool()` | Only a client's call folds                                              |

## Verification Checklist

### Configuration

- [ ] `thresholdBytes` is at least 1024 and `ttlSeconds` at least 1 (otherwise `init()` throws `ResultHandlesConfigurationError`)
- [ ] Tools with an output schema have `foldedAnswerSchema` in a union
- [ ] A shared `storage` when the server runs on several instances

### Runtime

- [ ] A large answer comes back with `structuredContent.handle` and `_meta['frontmcp/result-handle']`
- [ ] `result_query` with that handle reads a slice
- [ ] Another session gets `RESULT_HANDLE_NOT_FOUND`

## Troubleshooting

| Problem                                   | Cause                                                                                                                                                                           | Solution                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Warning: "does not admit the folded form" | The tool's output schema rejects `{ preview, shape, handle }`                                                                                                                   | Add `foldedAnswerSchema` to the schema as a union member                         |
| A large answer is not folded              | Not text only, several texts or a text beside `structuredContent` that says something else, an error result, a widget answer, an in-process call, or a stateless anonymous call | Fold only applies to a client's text answer with a session or a signed-in caller |
| Warning: "Could not keep the answer"      | The store failed to save it (Redis down, say); the answer was sent whole                                                                                                        | Check the `storage` connection                                                   |
| `RESULT_HANDLE_NOT_FOUND`                 | Expired, another session or caller, another instance or a full memory store                                                                                                     | Call the tool again; use a shared store across instances                         |
| `RESULT_SLICE_TOO_LARGE`                  | The slice is over `thresholdBytes`                                                                                                                                              | Read fewer items, fewer `fields`, or a deeper `path`                             |
| `RESULT_PATH_NOT_FOUND`                   | The path is malformed or names nothing                                                                                                                                          | Follow the keys the `shape` lists                                                |

## Reference

- [Result handles plugin](https://frontmcp.dev/reference/plugins/result-handles)
- Related skills: `official-plugins`, `create-plugin-hooks` (the `fitAnswer` stage), `decorators-guide` (`output.budget`)
