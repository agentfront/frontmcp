# @frontmcp/plugin-result-handles

A FrontMCP plugin for tools whose answers are too large to send whole. An answer over a size threshold is kept on the
server, and the model gets a preview, a shape and a handle in its place. It then reads only the parts it needs with the
`result_query` tool: a path, a range or a page, and the fields it wants. A handle works only for the session and the
caller it was issued to, and only until its TTL runs out.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-result-handles.svg)](https://www.npmjs.com/package/@frontmcp/plugin-result-handles) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-result-handles.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-result-handles @frontmcp/sdk
```

Requires Node.js 24 or later. Keep `@frontmcp/sdk` on the same version as this package.

## Usage

Register the plugin on the app whose answers it should fold, or on `@FrontMcp({ plugins })` for every app:

```ts
import ResultHandlesPlugin from '@frontmcp/plugin-result-handles';
import { App } from '@frontmcp/sdk';

@App({
  id: 'orders',
  name: 'Orders',
  tools: [ExportOrdersTool],
  plugins: [ResultHandlesPlugin.init({ thresholdBytes: 32 * 1024, preview: { items: 2 } })],
})
export class OrdersApp {}
```

An answer of 500 orders then reaches the client as:

```json
{
  "preview": {
    "orders": [
      { "id": 0, "status": "open" },
      { "id": 1, "status": "shipped" }
    ],
    "total": 500
  },
  "shape": {
    "type": "object",
    "keys": {
      "orders": {
        "type": "array",
        "length": 500,
        "items": {
          "type": "object",
          "keys": { "id": { "type": "number" }, "status": { "type": "string", "length": 4 } }
        }
      },
      "total": { "type": "number" }
    }
  },
  "handle": "3f1c2a4e-9b7d-4c1e-8f2a-1b2c3d4e5f60"
}
```

as `structuredContent` and as its text, followed by a line telling the model how to read the rest. The result's
`_meta['frontmcp/result-handle']` holds `{ handle, bytes, ttlSeconds }`.

## What folds

The plugin runs on the `fitAnswer` stage of `tools/call`, before the answer budget (`output.budget`), so the budget
sees the folded answer. An answer folds when all of these hold:

- a client called the tool: a tool calling another with `this.callTool()` gets the whole answer;
- the answer is text only: `structuredContent`, or one text content. Images, audio, resources, several texts, error
  results and answers that render a widget are left alone;
- its data, `structuredContent` or the text, is larger than `thresholdBytes` as UTF-8 JSON;
- the call has a verified session or an authenticated caller. A stateless anonymous call is left alone, since nobody
  could read its handle back;
- `foldPolicy(toolName, answer, context)` returns `true`;
- the tool's output schema admits the folded form (below).

When the store can't keep the answer (Redis is down, say), the answer is sent whole and the plugin logs a warning.

## Tools with an output schema

A client checks `structuredContent` against the `outputSchema` it was listed, so a tool with an output schema folds
only when that schema admits `{ preview, shape, handle }`. Add `foldedAnswerSchema` to it as a union member:

```ts
import { foldedAnswerSchema } from '@frontmcp/plugin-result-handles';

const reportSchema = z.object({ orders: z.array(orderSchema), total: z.number() });

@Tool({ name: 'export_orders', inputSchema: {}, outputSchema: z.union([reportSchema, foldedAnswerSchema]) })
export class ExportOrdersTool extends ToolContext {
  /* … */
}
```

A Zod schema must accept the folded form with no undeclared key; a JSON Schema (an OpenAPI or remote tool's) must
validate it. A tool whose schema doesn't admit it is sent whole, and the plugin logs a warning naming the tool once.

## `result_query`

| Argument | Description                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| `handle` | The handle of the folded answer. Required.                                                                           |
| `path`   | A dot path (`$.orders[2].note`, `orders.2.note`) or a JSON pointer (`/orders/2/note`). The whole answer if left out. |
| `offset` | Of a list, the first item to read; of a string, the first character.                                                 |
| `limit`  | How many items (20 by default) or characters (2000 by default) to read.                                              |
| `page`   | A page of `limit` items, from 1, in place of `offset`.                                                               |
| `fields` | Keep only these keys of the object, or of each object in the list.                                                   |

It answers `{ path, value, total?, offset?, nextOffset? }`: `total` is the length of the list or string, and
`nextOffset` is set while there is more to read. Its errors carry a remedy for the model:

| Code                      | When                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `RESULT_HANDLE_NOT_FOUND` | The handle expired, was never issued, or belongs to another session or caller.              |
| `RESULT_PATH_NOT_FOUND`   | The path isn't a dot path or a JSON pointer, or names nothing in the answer.                |
| `RESULT_SLICE_TOO_LARGE`  | The slice is larger than `thresholdBytes`: read fewer items, fewer fields or a deeper path. |
| `INVALID_INPUT`           | Both `page` and `offset` were given.                                                        |

## Who can read a handle

A handle is a random UUID, never derived from the answer. It's bound to the call's verified session and, unless the
caller is anonymous, to its authenticated subject. A different session or a different caller gets
`RESULT_HANDLE_NOT_FOUND`, the same answer as for a handle that never existed, and never the data.

## Options

| Option           | Default                    | Description                                                                                                                     |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `thresholdBytes` | `16384`                    | Answers larger than this fold, and no `result_query` slice is larger. At least 1024.                                            |
| `ttlSeconds`     | `600`                      | How long a folded answer can be read.                                                                                           |
| `preview`        | `{ items: 5, chars: 500 }` | The first `items` of each list and `chars` of each string the preview keeps.                                                    |
| `foldPolicy`     | every answer               | `(toolName, answer, { bytes, fullName, request }) => boolean`: which answers over the threshold fold.                           |
| `storage`        | `{ type: 'auto' }`         | Where folded answers are kept, passed to `createStorage()` from `@frontmcp/utils`: memory, Redis, Vercel KV, Upstash or SQLite. |
| `namespace`      | `'result-handles'`         | The key prefix of folded answers in the storage.                                                                                |

Invalid options throw a `ResultHandlesConfigurationError` from `init()`, naming each problem.

With `storage: { type: 'auto' }` the store is Redis, Vercel KV or Upstash when their environment variables are set,
and memory otherwise. Memory keeps answers in one process, so use a shared store when the server runs on several
instances:

```ts
ResultHandlesPlugin.init({ storage: { type: 'redis', redis: { url: process.env.REDIS_URL } } });
ResultHandlesPlugin.init({ storage: { type: 'sqlite', sqlite: { path: '/var/lib/my-server/results.sqlite' } } });
```

SQLite needs `@frontmcp/storage-sqlite`.

Each folded answer is kept, as the tool returned it and unencrypted, until its TTL runs out. With memory storage,
`storage: { type: 'memory', memory: { maxEntries: 1000 } }` caps how many are held at once, dropping the oldest.

## Docs

- [Result handles plugin reference](https://frontmcp.dev/reference/plugins/result-handles)
- [Plugins and adapters](https://frontmcp.dev/reference/plugins): where to register a plugin

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework this plugin extends, and the answer
  budget (`output.budget`) that runs after it
- [`@frontmcp/utils`](https://www.npmjs.com/package/@frontmcp/utils): `createStorage()`, which builds the store

## Contributing

Source: [`plugins/plugin-result-handles`](https://github.com/agentfront/frontmcp/tree/main/plugins/plugin-result-handles).
Issues and pull requests are welcome; see
[CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
