---
name: tfidf-keyword-search
reference: vectoriadb
level: basic
description: 'Shows how to use `TFIDFVectoria` for zero-dependency keyword search in a FrontMCP provider, concatenating fields into one text and calling `reindex()`.'
tags: [extensibility, vectoriadb, keyword-search, tfidf, keyword, search]
features:
  - 'Using `TFIDFVectoria` for zero-dependency keyword search (no model downloads)'
  - 'Calling `addDocument(id, text, metadata)` with a single concatenated text string'
  - 'Calling `reindex()` after adding documents (required for TFIDFVectoria)'
  - 'Wrapping the search engine in a FrontMCP provider with `ProviderScope.GLOBAL`'
  - 'Injecting the provider into tools via `this.get(FAQSearchProvider)`'
---

# TFIDFVectoria: Lightweight Keyword Search Provider

Shows how to use `TFIDFVectoria` for zero-dependency keyword search in a FrontMCP
provider. `TFIDFVectoria` indexes a single text string per document, so multi-field
documents are concatenated into one searchable blob; the original fields are kept
in `metadata` for use on search results.

## Code

```typescript
// src/providers/faq-search.provider.ts
import { TFIDFVectoria } from 'vectoriadb';

import { Provider, ProviderScope } from '@frontmcp/sdk';

interface FaqDoc {
  id: string;
  question: string;
  answer: string;
  tags: string;
}

@Provider({ name: 'faq-search', scope: ProviderScope.GLOBAL })
export class FAQSearchProvider {
  private db = new TFIDFVectoria<FaqDoc>({
    defaultTopK: 10,
  });

  async initialize(faqs: FaqDoc[]) {
    for (const faq of faqs) {
      // Concatenate fields into a single searchable text string;
      // preserve the original fields in metadata.
      const text = `${faq.question} ${faq.answer} ${faq.tags}`;
      this.db.addDocument(faq.id, text, faq);
    }
    // Required after adding documents — rebuilds IDF and embeddings
    this.db.reindex();
  }

  search(query: string, limit = 5) {
    return this.db.search(query, { topK: limit });
  }
}
```

```typescript
// src/tools/search-faq.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { FAQSearchProvider } from '../providers/faq-search.provider';

@Tool({
  name: 'search_faq',
  description: 'Search the FAQ knowledge base using keyword matching',
  inputSchema: {
    query: z.string().min(1).describe('Search query'),
    limit: z.number().int().min(1).max(20).default(5).describe('Max results'),
  },
  outputSchema: {
    results: z.array(
      z.object({
        id: z.string(),
        score: z.number(),
        question: z.string(),
      }),
    ),
  },
})
export class SearchFaqTool extends ToolContext {
  async execute(input: { query: string; limit: number }) {
    const faqSearch = this.get(FAQSearchProvider);
    const results = faqSearch.search(input.query, input.limit);

    return {
      results: results.map((r) => ({
        id: r.id,
        score: r.score,
        question: r.metadata.question,
      })),
    };
  }
}
```

## What This Demonstrates

- Using `TFIDFVectoria` for zero-dependency keyword search (no model downloads)
- Calling `addDocument(id, text, metadata)` with a single concatenated text string
- Calling `reindex()` after adding documents (required for TFIDFVectoria)
- Wrapping the search engine in a FrontMCP provider with `ProviderScope.GLOBAL`
- Injecting the provider into tools via `this.get(FAQSearchProvider)`

## Related

- See `vectoriadb` for the full API reference and engine comparison
