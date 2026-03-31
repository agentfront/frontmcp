---
name: product-catalog-search
reference: vectoriadb
level: advanced
description: 'Shows advanced VectoriaDB usage with typed document metadata, batch operations, filtered search by multiple criteria, and batch indexing of a product catalog.'
tags: [extensibility, vectoriadb, product, catalog, search]
features:
  - 'Typed document metadata with `ProductDoc extends DocumentMetadata`'
  - 'Batch operations with `db.addMany()` for efficient catalog indexing'
  - 'Multi-criteria filtered search combining category, price, and stock status'
  - '`maxDocuments` option for DoS protection on large datasets'
  - '`FileStorageAdapter` for persisting the entire product index to disk'
  - 'Semantic matching: "something to block office noise" finds "noise-canceling headphones"'
---

# VectoriaDB: Product Catalog with Typed Metadata and Batch Operations

Shows advanced VectoriaDB usage with typed document metadata, batch operations, filtered search by multiple criteria, and batch indexing of a product catalog.

## Code

```typescript
// src/providers/product-search.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';
import { VectoriaDB, FileStorageAdapter } from 'vectoriadb';
import type { DocumentMetadata } from 'vectoriadb';

export const ProductSearch = Symbol('ProductSearch');

// Typed metadata for product documents
interface ProductDoc extends DocumentMetadata {
  name: string;
  category: string;
  price: number;
  inStock: boolean;
}

@Provider({ name: 'product-search', provide: ProductSearch, scope: ProviderScope.GLOBAL })
export class ProductSearchProvider {
  private db: VectoriaDB<ProductDoc>;
  private ready: Promise<void>;

  constructor() {
    this.db = new VectoriaDB<ProductDoc>({
      modelName: 'Xenova/all-MiniLM-L6-v2',
      cacheDir: './.cache/transformers',
      useHNSW: true,
      defaultSimilarityThreshold: 0.3,
      defaultTopK: 10,
      maxDocuments: 100000, // DoS protection
      storageAdapter: new FileStorageAdapter({ cacheDir: './.cache/product-vectors' }),
    });
    this.ready = this.db.initialize();
  }

  // Batch indexing for large catalogs
  async indexProducts(
    products: Array<{
      id: string;
      description: string;
      name: string;
      category: string;
      price: number;
      inStock: boolean;
    }>,
  ) {
    await this.ready;

    // Use addMany for efficient batch operations
    await this.db.addMany(
      products.map((p) => ({
        id: p.id,
        text: `${p.name}: ${p.description}`,
        metadata: {
          id: p.id,
          name: p.name,
          category: p.category,
          price: p.price,
          inStock: p.inStock,
        },
      })),
    );

    await this.db.saveToStorage();
  }

  // Multi-criteria filtered search
  async search(query: string, filters?: { category?: string; maxPrice?: number; inStockOnly?: boolean }, limit = 10) {
    await this.ready;

    return this.db.search(query, {
      topK: limit,
      threshold: 0.4,
      filter: (meta) => {
        if (filters?.category && meta.category !== filters.category) return false;
        if (filters?.maxPrice !== undefined && meta.price > filters.maxPrice) return false;
        if (filters?.inStockOnly && !meta.inStock) return false;
        return true;
      },
    });
  }
}
```

```typescript
// src/tools/find-products.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { ProductSearch } from '../providers/product-search.provider';

@Tool({
  name: 'find_products',
  description: 'Find products using natural language (e.g., "something to block office noise")',
  inputSchema: {
    query: z.string().min(1).describe('Natural language product search'),
    category: z.string().optional().describe('Filter by category'),
    maxPrice: z.number().positive().optional().describe('Maximum price'),
    inStockOnly: z.boolean().default(true).describe('Only show in-stock products'),
    limit: z.number().int().min(1).max(20).default(5).describe('Max results'),
  },
  outputSchema: {
    products: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        category: z.string(),
        price: z.number(),
        score: z.number(),
        inStock: z.boolean(),
      }),
    ),
    total: z.number(),
  },
})
export class FindProductsTool extends ToolContext {
  async execute(input: { query: string; category?: string; maxPrice?: number; inStockOnly: boolean; limit: number }) {
    const search = this.get(ProductSearch);

    const results = await search.search(
      input.query,
      {
        category: input.category,
        maxPrice: input.maxPrice,
        inStockOnly: input.inStockOnly,
      },
      input.limit,
    );

    return {
      products: results.map((r) => ({
        id: r.id,
        name: r.metadata.name,
        category: r.metadata.category,
        price: r.metadata.price,
        score: r.score,
        inStock: r.metadata.inStock,
      })),
      total: results.length,
    };
  }
}
```

## What This Demonstrates

- Typed document metadata with `ProductDoc extends DocumentMetadata`
- Batch operations with `db.addMany()` for efficient catalog indexing
- Multi-criteria filtered search combining category, price, and stock status
- `maxDocuments` option for DoS protection on large datasets
- `FileStorageAdapter` for persisting the entire product index to disk
- Semantic matching: "something to block office noise" finds "noise-canceling headphones"

## Related

- See `vectoriadb` for the full configuration reference, engine comparison, and TFIDFVectoria examples
