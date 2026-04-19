---
name: semantic-search-with-persistence
reference: vectoriadb
level: intermediate
description: 'Shows how to use `VectoriaDB` for semantic search with transformer models, filtered search, and `FileStorageAdapter` for persistence across restarts.'
tags: [extensibility, vectoriadb, semantic-search, semantic, search, persistence]
features:
  - 'Using `VectoriaDB` with transformer models for true semantic search'
  - 'Configuring HNSW index (`useHNSW: true`) for fast O(log n) search on large datasets'
  - 'Filtered search with a callback: `filter: (m) => m.category === category`'
  - '`FileStorageAdapter` for persisting vectors to disk (restored without re-embedding)'
  - 'Async initialization with `await db.initialize()` (downloads model on first run)'
  - 'Update-or-add pattern with `db.has(id)` check'
---

# VectoriaDB: Semantic ML Search with Persistence

Shows how to use `VectoriaDB` for semantic search with transformer models, filtered search, and `FileStorageAdapter` for persistence across restarts.

## Code

```typescript
// src/providers/knowledge-base.provider.ts
import { FileStorageAdapter, VectoriaDB, type DocumentMetadata } from 'vectoriadb';

import { Provider, ProviderScope } from '@frontmcp/sdk';

export const KnowledgeBase = Symbol('KnowledgeBase');

interface Article extends DocumentMetadata {
  title: string;
  category: string;
}

@Provider({ name: 'knowledge-base', provide: KnowledgeBase, scope: ProviderScope.GLOBAL })
export class KnowledgeBaseProvider {
  private db: VectoriaDB<Article>;
  private ready: Promise<void>;

  constructor() {
    this.db = new VectoriaDB<Article>({
      modelName: 'Xenova/all-MiniLM-L6-v2', // Default transformer model
      cacheDir: './.cache/transformers', // Model cache directory
      useHNSW: true, // HNSW index for O(log n) search
      defaultSimilarityThreshold: 0.4,
      defaultTopK: 10,
      storageAdapter: new FileStorageAdapter({ cacheDir: './.cache/kb-vectors' }),
    });
    // Initialize async — downloads model on first run
    this.ready = this.db.initialize();
  }

  async search(query: string, options?: { category?: string; limit?: number }) {
    await this.ready;
    return this.db.search(query, {
      topK: options?.limit ?? 10,
      // Filtered search: narrow results by category
      filter: options?.category ? (m) => m.category === options.category : undefined,
    });
  }

  async index(id: string, text: string, metadata: Article) {
    await this.ready;
    // Update if exists, add if new
    if (this.db.has(id)) {
      await this.db.update(id, { text, metadata });
    } else {
      await this.db.add(id, text, metadata);
    }
    // Persist to disk — restored without re-embedding on next startup
    await this.db.saveToStorage();
  }

  async loadFromDisk() {
    await this.ready;
    await this.db.loadFromStorage();
  }
}
```

```typescript
// src/tools/semantic-search.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { KnowledgeBase } from '../providers/knowledge-base.provider';

@Tool({
  name: 'semantic_search',
  description: 'Search the knowledge base using natural language (understands meaning, not just keywords)',
  inputSchema: {
    query: z.string().min(1).describe('Natural language search query'),
    category: z.string().optional().describe('Filter by category'),
    limit: z.number().int().min(1).max(20).default(5).describe('Max results'),
  },
  outputSchema: {
    results: z.array(
      z.object({
        id: z.string(),
        score: z.number(),
        title: z.string(),
        category: z.string(),
      }),
    ),
  },
})
export class SemanticSearchTool extends ToolContext {
  async execute(input: { query: string; category?: string; limit: number }) {
    const kb = this.get(KnowledgeBase);

    const results = await kb.search(input.query, {
      category: input.category,
      limit: input.limit,
    });

    return {
      results: results.map((r) => ({
        id: r.id,
        score: r.score,
        title: r.metadata.title,
        category: r.metadata.category,
      })),
    };
  }
}
```

## What This Demonstrates

- Using `VectoriaDB` with transformer models for true semantic search
- Configuring HNSW index (`useHNSW: true`) for fast O(log n) search on large datasets
- Filtered search with a callback: `filter: (m) => m.category === category`
- `FileStorageAdapter` for persisting vectors to disk (restored without re-embedding)
- Async initialization with `await db.initialize()` (downloads model on first run)
- Update-or-add pattern with `db.has(id)` check

## Related

- See `vectoriadb` for the full configuration reference and engine comparison
