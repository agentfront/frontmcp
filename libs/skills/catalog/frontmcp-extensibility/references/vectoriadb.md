---
name: vectoriadb
description: Use VectoriaDB for in-memory vector search with ML-based or TF-IDF engines in FrontMCP servers
---

# VectoriaDB Integration

Use VectoriaDB for in-memory vector search in FrontMCP servers. Two engines are available:

- **VectoriaDB** — ML-based semantic search using transformer models. Best for understanding meaning ("find users" matches "list accounts").
- **TFIDFVectoria** — Zero-dependency keyword search using TF-IDF scoring. Best for exact/fuzzy keyword matching with no model downloads.

Both are included in the `vectoriadb` package (already a FrontMCP dependency).

## When to Use

| Engine          | Use When                                                          | Dependencies    | Init                                 |
| --------------- | ----------------------------------------------------------------- | --------------- | ------------------------------------ |
| `TFIDFVectoria` | Keyword matching, zero deps, no network, small corpus (<10K docs) | None            | Synchronous                          |
| `VectoriaDB`    | Semantic understanding, similarity matching, large corpus         | transformers.js | Async (downloads model on first run) |

## TFIDFVectoria — Lightweight Keyword Search

Zero dependencies, synchronous initialization. Good for tool discovery, FAQ matching, and simple search features.

### Basic Usage

```typescript
import { TFIDFVectoria } from 'vectoriadb';

const db = new TFIDFVectoria({
  defaultSimilarityThreshold: 0.0,
  defaultTopK: 10,
});

// Add documents (id, text)
db.addDocument('users-list', 'List all users with pagination and filtering');
db.addDocument('users-create', 'Create a new user account with email and password');
db.addDocument('orders-list', 'List orders for a customer with date range filters');

// Build the index (required after adding documents)
db.buildIndex();

// Search
const results = db.search('find users', 5);
// results: [{ id: 'users-list', score: 0.82 }, { id: 'users-create', score: 0.65 }]
```

### With Field Weights

Weight different fields to control scoring influence:

```typescript
const db = new TFIDFVectoria({
  fields: {
    name: { weight: 3 }, // Name matches are 3x more important
    description: { weight: 2 }, // Description matches are 2x
    tags: { weight: 1 }, // Tags are baseline
  },
});

db.addDocument('weather-tool', {
  name: 'get_weather',
  description: 'Fetch current weather conditions for a city',
  tags: 'weather forecast temperature',
});

db.buildIndex();
const results = db.search('temperature forecast', 5);
```

### FrontMCP Provider Pattern

```typescript
import { Provider, ProviderScope } from '@frontmcp/sdk';
import { TFIDFVectoria } from 'vectoriadb';

export const FAQSearch = Symbol('FAQSearch');

@Provider({ name: 'faq-search', provide: FAQSearch, scope: ProviderScope.GLOBAL })
export class FAQSearchProvider {
  private db = new TFIDFVectoria({
    fields: {
      question: { weight: 3 },
      answer: { weight: 1 },
      tags: { weight: 2 },
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
    this.db.buildIndex();
  }

  search(query: string, limit = 5) {
    return this.db.search(query, limit);
  }
}
```

## VectoriaDB — Semantic ML Search

Uses transformer models for true semantic understanding. "find users" matches "list accounts" even without shared keywords.

### Basic Usage

```typescript
import { VectoriaDB, DocumentMetadata } from 'vectoriadb';

interface ProductDoc extends DocumentMetadata {
  name: string;
  category: string;
  price: number;
}

const db = new VectoriaDB<ProductDoc>({
  modelName: 'Xenova/all-MiniLM-L6-v2', // Default model
  cacheDir: './.cache/transformers', // Model cache
  defaultSimilarityThreshold: 0.4,
  defaultTopK: 10,
  useHNSW: true, // Enable HNSW for fast search on large datasets
});

// Must initialize before use (downloads model on first run)
await db.initialize();

// Add documents
await db.add('prod-1', 'Wireless noise-canceling headphones with 30h battery', {
  id: 'prod-1',
  name: 'QuietComfort Ultra',
  category: 'audio',
  price: 349,
});

// Semantic search — understands meaning, not just keywords
const results = await db.search('something to block office noise', {
  topK: 5,
  threshold: 0.4,
});
// results[0].metadata.name === 'QuietComfort Ultra' (semantic match!)
```

### Batch Operations

```typescript
await db.addMany([
  {
    id: 'doc-1',
    text: 'First document content',
    metadata: {
      /* ... */
    },
  },
  {
    id: 'doc-2',
    text: 'Second document content',
    metadata: {
      /* ... */
    },
  },
]);
```

### Filtered Search

```typescript
const results = await db.search('wireless audio', {
  topK: 5,
  filter: (meta) => meta.category === 'audio' && meta.price < 300,
});
```

### Persistence with Storage Adapters

```typescript
import { VectoriaDB, FileStorageAdapter } from 'vectoriadb';

const db = new VectoriaDB<MyDoc>({
  storageAdapter: new FileStorageAdapter({ cacheDir: './.cache/vectors' }),
});

await db.initialize();
// After adding documents, persist to disk
await db.saveToStorage();
// On next startup, restores without re-embedding
await db.loadFromStorage();
```

### FrontMCP Provider Pattern

```typescript
import { Provider, ProviderScope } from '@frontmcp/sdk';
import { VectoriaDB, FileStorageAdapter } from 'vectoriadb';
import type { DocumentMetadata } from 'vectoriadb';

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
      useHNSW: true,
      storageAdapter: new FileStorageAdapter({ cacheDir: './.cache/kb-vectors' }),
    });
    this.ready = this.db.initialize();
  }

  async search(query: string, options?: { category?: string; limit?: number }) {
    await this.ready;
    return this.db.search(query, {
      topK: options?.limit ?? 10,
      filter: options?.category ? (m) => m.category === options.category : undefined,
    });
  }

  async index(id: string, text: string, metadata: Article) {
    await this.ready;
    if (this.db.has(id)) {
      await this.db.update(id, { text, metadata });
    } else {
      await this.db.add(id, text, metadata);
    }
    await this.db.saveToStorage();
  }
}
```

## Configuration Reference

### VectoriaDB Options

| Option                       | Type           | Default                     | Description                              |
| ---------------------------- | -------------- | --------------------------- | ---------------------------------------- |
| `modelName`                  | string         | `'Xenova/all-MiniLM-L6-v2'` | Transformer model for embeddings         |
| `cacheDir`                   | string         | `'./.cache/transformers'`   | Model download cache directory           |
| `defaultSimilarityThreshold` | number         | `0.3`                       | Minimum similarity score (0-1)           |
| `defaultTopK`                | number         | `10`                        | Default results limit                    |
| `useHNSW`                    | boolean        | `false`                     | Enable HNSW index for O(log n) search    |
| `maxDocuments`               | number         | `100000`                    | Max documents (DoS protection)           |
| `storageAdapter`             | StorageAdapter | None                        | Persistence adapter (FileStorageAdapter) |

### TFIDFVectoria Options

| Option                       | Type                       | Default | Description              |
| ---------------------------- | -------------------------- | ------- | ------------------------ |
| `defaultSimilarityThreshold` | number                     | `0.0`   | Minimum similarity score |
| `defaultTopK`                | number                     | `10`    | Default results limit    |
| `fields`                     | Record<string, { weight }> | None    | Field-weighted indexing  |

## Choosing Between Engines

| Criterion          | TFIDFVectoria                  | VectoriaDB                                |
| ------------------ | ------------------------------ | ----------------------------------------- |
| **Dependencies**   | Zero                           | transformers.js (~50MB model)             |
| **Initialization** | Synchronous, instant           | Async, first-run model download           |
| **Search quality** | Keyword-based (exact/fuzzy)    | Semantic (understands meaning)            |
| **Best for**       | Tool discovery, FAQ, <10K docs | Knowledge base, recommendations, any size |
| **Reindex needed** | Yes (`buildIndex()` after add) | No (auto-indexed on add)                  |
| **Persistence**    | Not built-in                   | FileStorageAdapter                        |

## Verification Checklist

- [ ] Correct engine chosen based on requirements (TFIDFVectoria vs VectoriaDB)
- [ ] Provider wraps the database with proper initialization
- [ ] `buildIndex()` called after adding documents (TFIDFVectoria only)
- [ ] `await db.initialize()` called before any operations (VectoriaDB only)
- [ ] Field weights configured based on domain relevance
- [ ] Storage adapter configured if persistence is needed
- [ ] Search tool injects provider via `this.get(TOKEN)`

## Reference

- [VectoriaDB Documentation](https://docs.agentfront.dev/vectoriadb/get-started/welcome)
- [TFIDFVectoria API](https://docs.agentfront.dev/vectoriadb/api-reference/tfidf-vectoria/constructor)
- Related skills: `create-provider`, `create-tool`, `frontmcp-development`
