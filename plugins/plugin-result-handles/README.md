# @frontmcp/plugin-result-handles

A FrontMCP plugin for tools whose answers are too large to send whole. An answer over a size threshold is kept on the
server, and the model gets a preview, a shape and a handle in its place. It then reads only the parts it needs with the
`result_query` tool: a path, a range or a page, and the fields it wants, filtered, searched, sorted or counted. A
handle works only for the session and the caller it was issued to, and only until its TTL runs out. Resource reads can
fold too.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-result-handles.svg)](https://www.npmjs.com/package/@frontmcp/plugin-result-handles) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-result-handles.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-result-handles @frontmcp/sdk
```

Requires Node.js 24 or later. Keep `@frontmcp/sdk` on the same version as this package.

## Usage

Register the plugin on the app whose answers it should fold, or on `@FrontMcp({ plugins })` for every app. On several
apps, the server lists one `result_query`, and it reads the handles of every app's copy:

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
- the answer is one text content, or `structuredContent` with at most one text that only repeats it (as the SDK
  writes it). Images, audio, resources, several texts, a text beside `structuredContent` that says something else,
  error results and answers that render a widget are left alone;
- its data, `structuredContent` or the text, is larger than `thresholdBytes` as UTF-8 JSON;
- the call has a verified session or an authenticated caller. A stateless anonymous call is left alone, since nobody
  could read its handle back;
- `foldPolicy(toolName, answer, context)` returns `true`. `answer` is the `structuredContent`, or the text; a text that
  is a JSON object or array is parsed, so the policy and `result_query` get the value;
- the tool's output schema admits the folded form (below).

When the store can't keep the answer (Redis is down, say), the answer is sent whole and the plugin logs a warning.

## Resource reads

`resources/read` answers fold too when you turn on `resources`. It's off by default:

```ts
ResultHandlesPlugin.init({ resources: true });
// or choose which reads fold
ResultHandlesPlugin.init({ resources: (uri, answer, { bytes, fullName, request }) => uri.startsWith('reports://') });
```

The plugin runs on the `fitAnswer` stage of `resources/read`, before the answer budget. A read folds when a client
read it (an agent's `read_resource` gets it whole), it has one text content that isn't HTML, the text (parsed when
it's a JSON object or array) is larger than `thresholdBytes`, the call has a verified session or an authenticated
caller, and the `resources` policy, when it's a function, returns `true`. The folded read has two contents: the JSON of
`{ preview, shape, handle }` (`mimeType: 'application/json'`), then a `text/plain` note naming `result_query`.
`_meta['frontmcp/result-handle']` holds `{ handle, bytes, ttlSeconds }`, as for a tool. A resource handle is bound to
the session and caller of the read, and `result_query` reads it like a tool's.

## Tools with an output schema

A client checks `structuredContent` against the `outputSchema` it was listed, so a tool with an output schema folds
only when that schema admits `{ preview, shape, handle }`. Add `foldedAnswerSchema` to it as a union member:

```ts
import { foldedAnswerSchema } from '@frontmcp/plugin-result-handles';
import { Tool, ToolContext, z } from '@frontmcp/sdk';

const reportSchema = z.object({ orders: z.array(orderSchema), total: z.number() });

@Tool({ name: 'export_orders', inputSchema: {}, outputSchema: z.union([reportSchema, foldedAnswerSchema]) })
export class ExportOrdersTool extends ToolContext {
  /* … */
}
```

A Zod schema must accept the folded form with no undeclared key; a JSON Schema (an OpenAPI or remote tool's) must
validate it. A tool whose schema doesn't admit it is sent whole, and the plugin logs a warning naming the tool once.

## `result_query`

| Argument | Description                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `handle` | The handle of the folded answer. Required.                                                                             |
| `path`   | A dot path (`$.orders[2].note`, `orders.2.note`) or a JSON pointer (`/orders/2/note`). The whole answer if left out.   |
| `offset` | Of a list, the first item to read; of a string, the first character.                                                   |
| `limit`  | How many items (20 by default) or characters (2000 by default) to read.                                                |
| `page`   | A page of `limit` items, from 1, in place of `offset`.                                                                 |
| `fields` | Keep only these keys of the object, or of each object in the list.                                                     |
| `where`  | Keep the items of the list that meet every condition (below).                                                          |
| `grep`   | `{ pattern, regex?, ignoreCase?, field? }`: keep the items with a match, or the lines of a string as `{ line, text }`. |
| `sort`   | `[{ field?, order? }]`: sort the items by these fields, the first one first; `order` is `'asc'` (default) or `'desc'`. |
| `count`  | `true` answers how many items `where` and `grep` keep, as `value`, in place of the items.                              |

It answers `{ path, value, total?, offset?, nextOffset? }`: `total` is the length of the list or string, and
`nextOffset` is set while there is more to read. With `where` or `grep`, `total` and `nextOffset` count only the items
kept. `where`, `grep`, `sort` and `offset`/`limit`/`page` run in that order, then `fields`:

```json
{
  "handle": "3f1c2a4e-9b7d-4c1e-8f2a-1b2c3d4e5f60",
  "path": "orders",
  "where": [
    { "field": "status", "op": "eq", "value": "open" },
    { "field": "total", "op": "gte", "value": 100 }
  ],
  "sort": [{ "field": "total", "order": "desc" }],
  "limit": 10,
  "fields": ["id", "total"]
}
```

A `where` condition is `{ field?, op, value? }`. `field` is a path in each item (`status`, `customer.id`), or the item
itself when it's left out. No code is run: `op` is one of these comparisons.

| `op`                     | Keeps an item whose value at `field`                                      |
| ------------------------ | ------------------------------------------------------------------------- |
| `eq`, `ne`               | is, or isn't, `value` (a missing field is `ne` anything)                  |
| `gt`, `gte`, `lt`, `lte` | is a number or string of `value`'s type, and greater or less than `value` |
| `in`                     | is one of `value`, a list of up to 100 values                             |
| `contains`               | is a string containing `value`, or a list holding `value`                 |
| `startsWith`, `endsWith` | is a string starting or ending with `value`                               |
| `exists`                 | is there (`value: false`: is missing)                                     |

`where` runs before `grep` on a list, so a grep spends its steps on the items `where` keeps; on a string, `where` reads
the `{ line, text }` items the grep makes. `grep` searches each item's strings, numbers and booleans (16 levels deep),
or the value at `field`, which only a list takes. Its `pattern` is
literal unless `regex: true`. A regex runs on a matcher with no backtracking, so its time grows with the text, not with
the pattern's shape, and one query stops after 20,000,000 steps. It takes literals, `.`, classes (`[a-z]`, `[^0-9]`),
`\d \w \s` and their negations, `\b`, `^` and `$` (the start and end of each string or line), groups, `|`, and the
quantifiers `* + ? {m} {m,} {m,n}` (counts up to 100; a larger one is refused); backreferences and lookarounds are
refused. `ignoreCase` folds case as a JavaScript RegExp's `i` flag does, for a literal pattern too (`σ` finds `ς`). Its errors carry a
remedy for the model:

| Code                           | When                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `RESULT_HANDLE_NOT_FOUND`      | The handle expired, was never issued, or belongs to another session or caller.                         |
| `RESULT_HANDLE_OWNER_REQUIRED` | The call has neither a verified session nor an authenticated caller, so no answer was folded for it.   |
| `RESULT_PATH_NOT_FOUND`        | The path isn't a dot path or a JSON pointer, or names nothing in the answer.                           |
| `RESULT_SLICE_TOO_LARGE`       | The slice is larger than `thresholdBytes`: read fewer items, fewer fields or a deeper path.            |
| `INVALID_INPUT`                | Both `page` and `offset`, a view of a value that isn't a list, a bad condition, field or grep pattern. |

## Who can read a handle

A handle is a random UUID, never derived from the answer. It's bound to the call's verified session and, unless the
caller is anonymous, to its authenticated subject. A different session or a different caller gets
`RESULT_HANDLE_NOT_FOUND`, the same answer as for a handle that never existed, and never the data.

The store never sees the handle. Each answer is encrypted with AES-256-GCM, and both its encryption key and its
storage key are derived (HKDF-SHA256) from the handle, the session and the subject. The storage holds nothing readable
without the handle, and a lookup by another session or caller finds no record at all, as for an unknown or expired
handle.

## Options

| Option           | Default                    | Description                                                                                                                     |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `thresholdBytes` | `16384`                    | Answers larger than this fold, and no `result_query` slice is larger. At least 1024.                                            |
| `ttlSeconds`     | `600`                      | How long a folded answer can be read.                                                                                           |
| `preview`        | `{ items: 5, chars: 500 }` | The first `items` of each list and `chars` of each string the preview keeps.                                                    |
| `foldPolicy`     | every answer               | `(toolName, answer, { bytes, fullName, request }) => boolean`: which answers over the threshold fold.                           |
| `storage`        | `{ type: 'auto' }`         | Where folded answers are kept, passed to `createStorage()` from `@frontmcp/utils`: memory, Redis, Vercel KV, Upstash or SQLite. |
| `namespace`      | `'result-handles'`         | The key prefix of folded answers in the storage.                                                                                |
| `resources`      | off                        | Fold `resources/read` answers too: `true`, or `(uri, answer, { bytes, fullName, request }) => boolean`.                         |
| `slidingTtl`     | `false`                    | Each read of a handle starts its `ttlSeconds` again, so a handle in use stays readable.                                         |
| `maxStoredBytes` | no limit                   | The most bytes of folded answers each copy of the plugin keeps; past it the least recently saved or read go first.              |

Invalid options throw a `ResultHandlesConfigurationError` from `init()`, naming each problem.

With `storage: { type: 'auto' }` the store is Redis, Vercel KV or Upstash when their environment variables are set,
and memory otherwise. Memory keeps answers in one process, so use a shared store when the server runs on several
instances:

```ts
ResultHandlesPlugin.init({ storage: { type: 'redis', redis: { url: process.env.REDIS_URL } } });
ResultHandlesPlugin.init({ storage: { type: 'sqlite', sqlite: { path: '/var/lib/my-server/results.sqlite' } } });
```

SQLite needs `@frontmcp/storage-sqlite`. In a browser build (`create()` in a web page, WebMCP), Redis and SQLite
throw `BrowserStoreUnavailableError` from `init()`, naming `storage: { type: 'memory' }`: a page has no TCP socket and
no file. `{ type: 'auto' }` picks memory there.

Each folded answer is kept, encrypted, until its TTL runs out. A memory store holds 1000 answers at most
(`DEFAULT_MEMORY_MAX_ENTRIES`) and drops the oldest past that; set `storage.memory.maxEntries` to change it, or to `0`
for no limit.

To keep handles that are in use and bound the memory they take, turn on `slidingTtl` and set `maxStoredBytes`:

```ts
ResultHandlesPlugin.init({ ttlSeconds: 300, slidingTtl: true, maxStoredBytes: 64 * 1024 * 1024 });
```

`maxStoredBytes` counts the stored (encrypted) bytes of the answers this process folded, and is at least
`thresholdBytes`. Past it, the least recently saved or read answers are deleted first; an answer larger than the whole
budget is sent whole, with a warning. On a shared store each instance counts the answers it folded itself.

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
