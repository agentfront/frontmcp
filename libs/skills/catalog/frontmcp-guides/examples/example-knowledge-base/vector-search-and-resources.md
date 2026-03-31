---
name: vector-search-and-resources
reference: example-knowledge-base
level: intermediate
description: 'Shows a semantic search tool with embedding generation and a resource template for retrieving documents by ID using URI parameters.'
tags: [guides, openai, semantic-search, knowledge-base, knowledge, base]
features:
  - 'Semantic search tool that generates query embeddings via `this.fetch()` to OpenAI'
  - 'Using `this.mark()` for execution phase tracing'
  - "Resource template with `uriTemplate: 'kb://documents/{documentId}'` for parameterized URIs"
  - 'Typed params via `ResourceContext<{ documentId: string }>` for type-safe URI parameters'
  - 'Returning `ReadResourceResult` with proper MCP protocol structure'
---

# Knowledge Base: Semantic Search Tool and Resource Template

Shows a semantic search tool with embedding generation and a resource template for retrieving documents by ID using URI parameters.

## Code

```typescript
// src/search/tools/search-docs.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { VECTOR_STORE } from '../../ingestion/providers/vector-store.provider';

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
    const store = this.get(VECTOR_STORE);

    // Mark execution phases for observability
    this.mark('embedding-query');
    const queryEmbedding = await this.generateQueryEmbedding(input.query);

    this.mark('searching');
    const chunks = await store.search(queryEmbedding, input.topK);

    const results = chunks.map((chunk) => ({
      documentId: chunk.documentId,
      content: chunk.content,
      score: chunk.metadata.score ? parseFloat(chunk.metadata.score) : 0,
      title: chunk.metadata.title ?? 'Untitled',
    }));

    return { results, total: results.length };
  }

  private async generateQueryEmbedding(query: string): Promise<number[]> {
    const response = await this.fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: query, model: 'text-embedding-3-small' }),
    });
    const data = await response.json();
    return data.data[0].embedding;
  }
}
```

```typescript
// src/search/resources/doc.resource.ts
import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import type { ReadResourceResult } from '@frontmcp/protocol';
import { VECTOR_STORE } from '../../ingestion/providers/vector-store.provider';

@ResourceTemplate({
  name: 'document',
  uriTemplate: 'kb://documents/{documentId}',
  description: 'Retrieve all chunks of a document by its ID',
  mimeType: 'application/json',
})
export class DocResource extends ResourceContext<{ documentId: string }> {
  async execute(uri: string, params: { documentId: string }): Promise<ReadResourceResult> {
    const store = this.get(VECTOR_STORE);
    const chunks = await store.getByDocumentId(params.documentId);

    if (chunks.length === 0) {
      this.fail(new Error(`Document not found: ${params.documentId}`));
    }

    const document = {
      documentId: params.documentId,
      title: chunks[0].metadata.title ?? 'Untitled',
      chunks: chunks.map((c) => ({
        chunkIndex: c.metadata.chunkIndex,
        content: c.content,
      })),
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

- Semantic search tool that generates query embeddings via `this.fetch()` to OpenAI
- Using `this.mark()` for execution phase tracing
- Resource template with `uriTemplate: 'kb://documents/{documentId}'` for parameterized URIs
- Typed params via `ResourceContext<{ documentId: string }>` for type-safe URI parameters
- Returning `ReadResourceResult` with proper MCP protocol structure

## Related

- See `example-knowledge-base` for the full knowledge base example with ingestion, agent, and plugin code
