---
name: vector-search-and-resources
reference: example-knowledge-base
level: intermediate
description: Shows a semantic search tool with embedding generation and a resource template for retrieving documents by ID using URI parameters.
tags:
  - guides
  - vectoriadb
  - semantic-search
  - knowledge-base
  - knowledge
  - base
features:
  - Semantic search tool that delegates embedding generation to VectoriaDB via `store.search(query, topK)`
  - Using `this.mark()` for execution phase tracing
  - "Resource template with `uriTemplate: 'kb://documents/{documentId}'` for parameterized URIs"
  - 'Typed params via `ResourceContext<{ documentId: string }>` for type-safe URI parameters'
  - Returning `ReadResourceResult` with proper MCP protocol structure
---

# Knowledge Base: Semantic Search Tool and Resource Template

Shows a semantic search tool with embedding generation and a resource template for retrieving documents by ID using URI parameters.

## Code

```typescript
// src/search/tools/search-docs.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { VectorStoreProvider } from '../../ingestion/providers/vector-store.provider';

@Tool({
  name: 'search_docs',
  description: 'Semantic search across the knowledge base',
  inputSchema: {
    query: z.string().min(1).describe('Natural language search query'),
    topK: z.number().int().min(1).max(20).default(5).describe('Number of results'),
  },
  outputSchema: {
    results: z.array(
      z.object({
        documentId: z.string(),
        content: z.string(),
        score: z.number(),
        title: z.string(),
      }),
    ),
    total: z.number(),
  },
})
export class SearchDocsTool extends ToolContext {
  async execute(input: { query: string; topK: number }) {
    const store = this.get(VectorStoreProvider);

    // VectoriaDB handles embedding generation internally — pass the raw query.
    this.mark('searching');
    const matches = await store.search(input.query, input.topK);

    const results = matches.map((m) => ({
      documentId: m.metadata.documentId,
      content: m.metadata.content,
      score: m.score,
      title: m.metadata.title ?? 'Untitled',
    }));

    return { results, total: results.length };
  }
}
```

```typescript
// src/search/resources/doc.resource.ts
import { ReadResourceResult, ResourceContext, ResourceNotFoundError, ResourceTemplate } from '@frontmcp/sdk';

import { VectorStoreProvider } from '../../ingestion/providers/vector-store.provider';

@ResourceTemplate({
  name: 'document',
  uriTemplate: 'kb://documents/{documentId}',
  description: 'Retrieve all chunks of a document by its ID',
  mimeType: 'application/json',
})
export class DocResource extends ResourceContext<{ documentId: string }> {
  async execute(uri: string, params: { documentId: string }): Promise<ReadResourceResult> {
    const store = this.get(VectorStoreProvider);
    const matches = await store.getByDocumentId(params.documentId);

    if (matches.length === 0) {
      // Use a typed MCP error so the protocol response carries the correct JSON-RPC code.
      throw new ResourceNotFoundError(uri);
    }

    const document = {
      documentId: params.documentId,
      title: matches[0].metadata.title ?? 'Untitled',
      chunks: matches
        .map((m) => ({ chunkIndex: m.metadata.chunkIndex, content: m.metadata.content }))
        .sort((a, b) => a.chunkIndex - b.chunkIndex),
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(document, null, 2),
        },
      ],
    };
  }
}
```

## What This Demonstrates

- Semantic search tool that delegates embedding generation to VectoriaDB via `store.search(query, topK)`
- Using `this.mark()` for execution phase tracing
- Resource template with `uriTemplate: 'kb://documents/{documentId}'` for parameterized URIs
- Typed params via `ResourceContext<{ documentId: string }>` for type-safe URI parameters
- Returning `ReadResourceResult` with proper MCP protocol structure

## Related

- See `example-knowledge-base` for the full knowledge base example with ingestion, agent, and plugin code
