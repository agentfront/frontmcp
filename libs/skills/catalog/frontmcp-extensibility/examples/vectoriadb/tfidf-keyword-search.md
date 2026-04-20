---
name: tfidf-keyword-search
reference: vectoriadb
level: basic
description: 'Shows how to use `TFIDFVectoria` for zero-dependency keyword search in a FrontMCP provider, with field weights and index building.'
tags: [extensibility, vectoriadb, keyword-search, tfidf, keyword, search]
features:
  - 'Using `TFIDFVectoria` for zero-dependency keyword search (no model downloads)'
  - 'Configuring field weights to control scoring influence'
  - 'Calling `buildIndex()` after adding documents (required for TFIDFVectoria)'
  - 'Wrapping the search engine in a FrontMCP provider with `ProviderScope.GLOBAL`'
  - 'Injecting the provider into tools via `this.get(FAQSearch)`'
---

# TFIDFVectoria: Lightweight Keyword Search Provider

Shows how to use `TFIDFVectoria` for zero-dependency keyword search in a FrontMCP provider, with field weights and index building.

## Code

```typescript
// src/providers/faq-search.provider.ts
import { TFIDFVectoria } from 'vectoriadb';

import { Provider, ProviderScope } from '@frontmcp/sdk';

export const FAQSearch = Symbol('FAQSearch');

@Provider({ name: 'faq-search', provide: FAQSearch, scope: ProviderScope.GLOBAL })
export class FAQSearchProvider {
  private db = new TFIDFVectoria({
    fields: {
      question: { weight: 3 }, // Question matches are 3x more important
      answer: { weight: 1 }, // Answer matches are baseline
      tags: { weight: 2 }, // Tag matches are 2x
    },
  });

  async initialize(faqs: Array<{ id: string; question: string; answer: string; tags: string }>) {
    for (const faq of faqs) {
      this.db.addDocument(faq.id, {
        question: faq.question,
        answer: faq.answer,
        tags: faq.tags,
      });
    }
    // Required after adding documents — builds the TF-IDF index
    this.db.buildIndex();
  }

  search(query: string, limit = 5) {
    return this.db.search(query, limit);
  }
}
```

```typescript
// src/tools/search-faq.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { FAQSearch } from '../providers/faq-search.provider';

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
      }),
    ),
  },
})
export class SearchFaqTool extends ToolContext {
  async execute(input: { query: string; limit: number }) {
    const faqSearch = this.get(FAQSearch);
    const results = faqSearch.search(input.query, input.limit);

    return {
      results: results.map((r) => ({
        id: r.id,
        score: r.score,
      })),
    };
  }
}
```

## What This Demonstrates

- Using `TFIDFVectoria` for zero-dependency keyword search (no model downloads)
- Configuring field weights to control scoring influence
- Calling `buildIndex()` after adding documents (required for TFIDFVectoria)
- Wrapping the search engine in a FrontMCP provider with `ProviderScope.GLOBAL`
- Injecting the provider into tools via `this.get(FAQSearch)`

## Related

- See `vectoriadb` for the full API reference and engine comparison
