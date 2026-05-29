---
name: 26-tool-with-resource-link-output
level: advanced
description: "Tool returning `outputSchema: 'resource_link'` — the URI is sent to the client; the client fetches the body via `resources/read`. The right pattern for large or cacheable payloads."
tags: [output-schema, resource_link, large-payload, caching]
features:
  - "Returning `outputSchema: 'resource_link'` from a tool — `{ uri }` only, body fetched separately"
  - "Pairing the tool with a matching `@Resource({ uri: 'export://{exportId}.csv' })` URI template that resolves to the actual body"
  - "When `'resource_link'` beats `'image'` / `'audio'` / a raw byte response (large payloads, cacheable URIs, deferred fetch)"
  - 'Cross-linking to the `create-resource` skill for the URI-template resource on the other end'
---

# Tool With Resource Link Output

Tool returning `outputSchema: 'resource_link'` — the URI is sent to the client; the client fetches the body via `resources/read`. The right pattern for large or cacheable payloads.

When the tool's output is large (>1MB) or cacheable, return a `'resource_link'` instead of inlining the bytes. The tool returns just `{ uri }`; the client decides when to fetch the body via `resources/read`.

## Code

```typescript
// src/apps/main/resources/export.resource.ts
// (Lives in this app — see the create-resource skill for the full URI-template surface)
import { Resource, ResourceContext } from '@frontmcp/sdk';

import { EXPORTS } from '../tokens';

@Resource({
  uri: 'export://{exportId}.csv',
  description: 'Generated export CSV',
})
export class ExportCsvResource extends ResourceContext<{ exportId: string }> {
  async read(params: { exportId: string }) {
    const exports = this.get(EXPORTS);
    const csv = await exports.loadCsv(params.exportId); // returns Buffer or stream
    return {
      contents: [{ uri: `export://${params.exportId}.csv`, mimeType: 'text/csv', blob: csv.toString('base64') }],
    };
  }
}
```

```typescript
// src/apps/main/tools/start-export.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { EXPORTS } from '../tokens';

const inputSchema = {
  datasetId: z.string().uuid(),
};
const outputSchema = 'resource_link';

@Tool({
  name: 'start_export',
  description: 'Generate an export and return a resource link the client can read',
  inputSchema,
  outputSchema,
  annotations: { idempotentHint: false },
})
export class StartExportTool extends ToolContext {
  async execute(input: { datasetId: string }) {
    const exports = this.get(EXPORTS);
    const exportId = await exports.create(input.datasetId);

    // Return JUST the URI. The client fetches the body via resources/read.
    return { uri: `export://${exportId}.csv` };
  }
}
```

## What This Demonstrates

- Returning `outputSchema: 'resource_link'` from a tool — `{ uri }` only, body fetched separately
- Pairing the tool with a matching `@Resource({ uri: 'export://{exportId}.csv' })` URI template that resolves to the actual body
- When `'resource_link'` beats `'image'` / `'audio'` / a raw byte response (large payloads, cacheable URIs, deferred fetch)
- Cross-linking to the `create-resource` skill for the URI-template resource on the other end

## `'resource_link'` vs `'resource'` vs `'image'` / `'audio'`

| Output                | When                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `'resource_link'`     | URI only. Best for large payloads (>1MB), cacheable content, deferred-fetch UX. Tool stays cheap; client fetches on demand. |
| `'resource'`          | URI + inline content in one response. Best when the client always needs the body immediately (small-to-medium size).        |
| `'image'` / `'audio'` | Inlined base64. Simplest for small media (≤1MB). No URI involved.                                                           |

## Why split tool + resource

- **Tool runs fast** — just generates the URI; doesn't materialize the whole payload in the response.
- **Client caches by URI** — repeated requests for `export://abc.csv` hit the client's cache; the tool only runs again if the URI changes.
- **Resource lifecycle is independent** — you can expire resources, regenerate them on demand, version them by URI suffix.

See the `create-resource` skill for URI templates, parameter validation, multi-content reads, and binary vs text resources.
