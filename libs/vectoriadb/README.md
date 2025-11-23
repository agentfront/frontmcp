# VectoriaDB

[![npm version](https://img.shields.io/npm/v/vectoriadb.svg)](https://www.npmjs.com/package/vectoriadb)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

> A lightweight, production-ready in-memory vector database for semantic search in JavaScript/TypeScript

VectoriaDB is a fast, minimal-dependency vector database designed for in-memory semantic search. Powered by [transformers.js](https://github.com/xenova/transformers.js), it's perfect for applications that need to quickly search through documents, tools, or any text-based data using natural language queries.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Why VectoriaDB?](#why-vectoriadb)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Advanced Usage](#advanced-usage)
- [Performance](#performance)
- [Use Cases](#use-cases)
- [Testing](#testing)
- [Comparison](#comparison-with-other-vector-databases)
- [Limitations](#limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Features

- **🚀 Fast**: In-memory storage with optimized HNSW indexing for O(log n) search
- **🪶 Lightweight**: Minimal dependencies, small footprint
- **🔍 Semantic Search**: Natural language queries using state-of-the-art embeddings
- **🎯 Type-Safe**: Full TypeScript support with generics
- **⚡ Batch Operations**: Efficient bulk insert and search
- **🔧 Flexible Filtering**: Custom metadata filtering with type safety
- **📊 Scalable**: HNSW index for 100k+ documents with sub-millisecond search
- **💾 Persistent**: File & Redis adapters for caching across restarts
- **🔄 Smart Updates**: Incremental updates without re-embedding (instant metadata updates)
- **📦 Production-Ready**: Battle-tested in FrontMCP

## Installation

```bash
npm install vectoriadb
# or
yarn add vectoriadb
# or
pnpm add vectoriadb
```

**Requirements:**

- Node.js 18+ (for transformers.js compatibility)
- TypeScript 5.0+ (if using TypeScript)

## Why VectoriaDB?

**Use VectoriaDB when you need:**

- 🎯 **Semantic search** without complex infrastructure (no external services required)
- ⚡ **Fast in-memory search** with HNSW indexing (handles 100k+ documents)
- 🔒 **Privacy-first** - all embeddings generated locally, no API calls
- 🚀 **Production-ready** vector search with minimal setup
- 📦 **Embedded search** in Node.js applications, CLIs, or desktop apps

**Skip VectoriaDB if you need:**

- 💾 Persistent storage (use Pinecone, Weaviate, or Qdrant)
- 🌐 Distributed architecture (use Weaviate or Milvus)
- 📊 Multi-million document scale (use specialized distributed vector DBs)

## Quick Start

```typescript
import { VectoriaDB } from 'vectoriadb';

// Create and initialize the database
const db = new VectoriaDB();
await db.initialize();

// Add documents
await db.add('doc-1', 'How to create a user account', {
  id: 'doc-1',
  category: 'auth',
  author: 'Alice',
});

await db.add('doc-2', 'Send email notifications to users', {
  id: 'doc-2',
  category: 'notifications',
  author: 'Bob',
});

// Search
const results = await db.search('creating new accounts');
console.log(results[0].metadata); // { id: 'doc-1', category: 'auth', ... }
console.log(results[0].score); // 0.87
```

## Core Concepts

### Documents

Each document in VectoriaDB consists of:

- **id**: Unique identifier
- **text**: The text content to search
- **metadata**: Custom metadata (type-safe with generics)

### Embeddings

VectoriaDB automatically generates embeddings (vector representations) of your documents using transformers.js. The default model is `Xenova/all-MiniLM-L6-v2` (22MB, 384 dimensions), which provides a great balance of size, speed, and accuracy.

### Search

Search uses cosine similarity to find the most semantically similar documents to your query.

## API Reference

### Constructor

```typescript
const db = new VectoriaDB<MetadataType>(config?)
```

**Config Options:**

```typescript
interface VectoriaConfig {
  modelName?: string; // Default: 'Xenova/all-MiniLM-L6-v2'
  dimensions?: number; // Auto-detected from model
  defaultSimilarityThreshold?: number; // Default: 0.3
  defaultTopK?: number; // Default: 10
}
```

### Methods

#### `initialize(): Promise<void>`

Initialize the embedding model. Must be called before using the database.

```typescript
await db.initialize();
```

#### `add(id: string, text: string, metadata: T): Promise<void>`

Add a single document to the database.

```typescript
await db.add('doc-1', 'Document content', { id: 'doc-1', category: 'tech' });
```

#### `addMany(documents: Array<{id, text, metadata}>): Promise<void>`

Add multiple documents in batch (more efficient).

```typescript
await db.addMany([
  { id: 'doc-1', text: 'Content 1', metadata: { id: 'doc-1' } },
  { id: 'doc-2', text: 'Content 2', metadata: { id: 'doc-2' } },
]);
```

#### `search(query: string, options?): Promise<SearchResult<T>[]>`

Search for documents using semantic similarity.

```typescript
const results = await db.search('machine learning', {
  topK: 5, // Return top 5 results
  threshold: 0.5, // Minimum similarity score
  filter: (metadata) => metadata.category === 'tech', // Custom filter
  includeVector: false, // Include vector in results
});
```

#### `get(id: string): DocumentEmbedding<T> | undefined`

Get a document by ID.

```typescript
const doc = db.get('doc-1');
```

#### `has(id: string): boolean`

Check if a document exists.

```typescript
if (db.has('doc-1')) {
  // Document exists
}
```

#### `remove(id: string): boolean`

Remove a document.

```typescript
db.remove('doc-1');
```

#### `removeMany(ids: string[]): number`

Remove multiple documents.

```typescript
const removed = db.removeMany(['doc-1', 'doc-2']);
```

#### `clear(): void`

Remove all documents.

```typescript
db.clear();
```

#### `size(): number`

Get the number of documents.

```typescript
const count = db.size();
```

#### `filter(filterFn): DocumentEmbedding<T>[]`

Get documents by filter (without semantic search).

```typescript
const techDocs = db.filter((metadata) => metadata.category === 'tech');
```

#### `getStats(): VectoriaStats`

Get database statistics.

```typescript
const stats = db.getStats();
console.log(stats.totalEmbeddings);
console.log(stats.estimatedMemoryBytes);
```

## Advanced Usage

### Type-Safe Metadata

Use TypeScript generics for type-safe metadata:

```typescript
interface MyMetadata extends DocumentMetadata {
  id: string;
  category: 'tech' | 'business' | 'science';
  author: string;
  tags: string[];
}

const db = new VectoriaDB<MyMetadata>();

await db.add('doc-1', 'Content', {
  id: 'doc-1',
  category: 'tech', // Type-checked!
  author: 'Alice',
  tags: ['ai', 'ml'],
});

const results = await db.search('query', {
  filter: (metadata) => {
    // metadata is fully typed!
    return metadata.category === 'tech' && metadata.tags.includes('ai');
  },
});
```

### Custom Embedding Models

Use any Hugging Face model compatible with transformers.js:

```typescript
const db = new VectoriaDB({
  modelName: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', // Multilingual support
});
```

### Batch Operations

For better performance with large datasets:

```typescript
const documents = [
  { id: '1', text: 'Doc 1', metadata: { id: '1' } },
  { id: '2', text: 'Doc 2', metadata: { id: '2' } },
  // ... thousands more
];

// Much faster than calling add() in a loop
await db.addMany(documents);
```

### HNSW Index for Production Scale

For production applications with large datasets (>10k documents), enable HNSW (Hierarchical Navigable Small World) indexing for faster approximate nearest neighbor search:

```typescript
const db = new VectoriaDB({
  useHNSW: true,
  hnsw: {
    M: 16, // Max connections per node (higher = better recall, more memory)
    M0: 32, // Max connections at layer 0
    efConstruction: 200, // Construction quality (higher = better quality, slower build)
    efSearch: 50, // Search quality (higher = better recall, slower search)
  },
});

await db.initialize();

// Add documents - HNSW index is built automatically
await db.addMany(documents);

// Search uses HNSW for O(log n) instead of O(n) complexity
const results = await db.search('query');
```

**HNSW Benefits:**

- **Speed**: O(log n) search vs O(n) brute-force
- **Scalability**: Handles 100k+ documents efficiently
- **Accuracy**: >95% recall with proper tuning
- **Production-Ready**: Battle-tested algorithm used by major vector databases

**Parameter Tuning:**

| Parameter      | Lower Value                 | Higher Value                 | Default |
| -------------- | --------------------------- | ---------------------------- | ------- |
| M              | Faster build, less memory   | Better recall, more memory   | 16      |
| efConstruction | Faster build, lower quality | Better quality, slower build | 200     |
| efSearch       | Faster search, lower recall | Better recall, slower search | 50      |

**When to use HNSW:**

- ✅ Dataset > 10,000 documents
- ✅ Search latency is critical
- ✅ Have memory for the graph structure (~50-100 bytes per document per connection)
- ❌ Dataset < 1,000 documents (overhead not worth it)
- ❌ Need exact nearest neighbors (HNSW is approximate)

### Complex Filtering

Combine semantic search with complex metadata filters:

```typescript
interface SecurityMetadata extends DocumentMetadata {
  id: string;
  category: string;
  tags: string[];
  author: string;
  priority: 'low' | 'medium' | 'high';
}

const db = new VectoriaDB<SecurityMetadata>();

const results = await db.search('user authentication', {
  topK: 10,
  threshold: 0.4,
  filter: (metadata) => {
    return (
      metadata.category === 'security' &&
      metadata.tags.includes('auth') &&
      metadata.author === 'security-team' &&
      metadata.priority === 'high'
    );
  },
});
```

### Persistence with Storage Adapters

Cache embeddings across restarts to avoid recalculation. VectoriaDB supports multiple storage backends:

#### In-Memory (Default)

No persistence - data is lost on restart:

```typescript
const db = new VectoriaDB(); // Uses MemoryStorageAdapter by default
```

#### File-Based Persistence

Perfect for local development - caches to disk with automatic invalidation when tools change:

```typescript
import { VectoriaDB, FileStorageAdapter, SerializationUtils } from 'vectoriadb';

const documents = [
  { id: 'tool-1', text: 'Create user account', metadata: { id: 'tool-1' } },
  { id: 'tool-2', text: 'Send email notification', metadata: { id: 'tool-2' } },
];

// Create tools hash for cache invalidation
const toolsHash = SerializationUtils.createToolsHash(documents);

const db = new VectoriaDB({
  storageAdapter: new FileStorageAdapter({
    cacheDir: './.cache/vectoriadb',
    namespace: 'my-app', // Separate cache per namespace
  }),
  toolsHash, // Cache invalidated when tools change
  version: '1.0.0', // Cache invalidated when version changes
});

await db.initialize(); // Automatically loads from cache if valid

// Add documents (only on first run or after invalidation)
if (db.size() === 0) {
  await db.addMany(documents);
  await db.saveToStorage(); // Manually save to cache
}

// Subsequent runs will load from cache instantly
```

#### Redis for Distributed Caching

Share embeddings across pods in distributed environments:

```typescript
import { VectoriaDB, RedisStorageAdapter, SerializationUtils } from 'vectoriadb';
import Redis from 'ioredis'; // or your Redis client

const documents = [
  /* your documents */
];
const toolsHash = SerializationUtils.createToolsHash(documents);

const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

const db = new VectoriaDB({
  storageAdapter: new RedisStorageAdapter({
    client: redis,
    namespace: 'my-app-v1', // Namespace by app + version
    ttl: 86400, // 24 hours (default)
  }),
  toolsHash,
  version: process.env.APP_VERSION,
});

await db.initialize(); // Loads from Redis if cache is valid

if (db.size() === 0) {
  await db.addMany(documents);
  await db.saveToStorage();
}

// Don't forget to close when shutting down
await db.close();
```

**Cache Invalidation:**

The cache is automatically invalidated when:

- `toolsHash` changes (documents added/removed/modified)
- `version` changes (application version updated)
- `modelName` changes (different embedding model)

**Best Practices:**

- **Local dev**: Use `FileStorageAdapter` to speed up restarts
- **Production**: Use `RedisStorageAdapter` for multi-pod deployments
- **Tools hash**: Create from document IDs + texts for automatic invalidation
- **Namespace**: Use app name + version to prevent cache conflicts
- **Manual save**: Call `saveToStorage()` after adding documents

### Incremental Updates (Production-Ready)

Update documents efficiently without re-embedding when only metadata changes:

#### Update Metadata Only (Instant)

```typescript
// Update metadata without re-embedding (instant operation)
db.updateMetadata('doc-1', {
  id: 'doc-1',
  category: 'updated-category',
  priority: 'high',
  lastModified: new Date(),
});
```

#### Smart Update (Auto-Detection)

```typescript
// Only re-embeds if text actually changed
const reembedded = await db.update('doc-1', {
  text: 'Updated content', // If different, will re-embed
  metadata: { id: 'doc-1', category: 'updated' },
});

console.log(reembedded); // true if re-embedded, false if text was same
```

#### Batch Updates (Efficient)

```typescript
// Update many documents - only re-embeds those with text changes
const result = await db.updateMany([
  {
    id: 'doc-1',
    text: 'New content for doc 1', // Will re-embed
    metadata: { id: 'doc-1', category: 'tech' },
  },
  {
    id: 'doc-2',
    metadata: { id: 'doc-2', category: 'food' }, // No text = no re-embedding
  },
  {
    id: 'doc-3',
    text: 'Same text as before', // Smart detection = no re-embedding
    metadata: { id: 'doc-3', category: 'science' },
  },
]);

console.log(`Updated ${result.updated} documents`);
console.log(`Re-embedded ${result.reembedded} documents`); // Only what changed
```

#### Force Re-Embedding

```typescript
// Force re-embed even if text hasn't changed (e.g., new embedding model)
await db.update('doc-1', { text: 'same text' }, { forceReembed: true });

// Force re-embed all in batch
await db.updateMany(docs, { forceReembed: true });
```

**Performance Benefits:**

| Operation              | Speed      | Re-embedding      |
| ---------------------- | ---------- | ----------------- |
| `updateMetadata()`     | Instant    | Never             |
| `update()` (metadata)  | Instant    | No                |
| `update()` (text)      | ~100-200ms | Only if changed   |
| `updateMany()` (mixed) | Batched    | Only what changed |

**Use Cases:**

- **Metadata updates**: Change categories, tags, priorities instantly
- **Partial text updates**: Only re-embed documents that actually changed
- **Dynamic content**: Update frequently changing metadata without performance hit
- **Bulk operations**: Efficiently update thousands of documents

## Performance

### Memory Usage

Memory efficient with Float32 arrays:

- **Embeddings**: ~1.5KB per document (384 dimensions × 4 bytes)
- **Metadata**: ~1KB per document (estimated)

**Example**: 10,000 documents ≈ 25 MB

### Search Speed

**Without HNSW (brute-force):**

- **Complexity**: O(n) where n = number of documents
- **Performance**: <10ms for 10,000 documents on modern hardware
- **Best for**: <10,000 documents

**With HNSW (approximate nearest neighbor):**

- **Complexity**: O(log n) approximate search
- **Performance**: Sub-millisecond for 100,000+ documents
- **Accuracy**: >95% recall with default parameters
- **Best for**: >10,000 documents

### Embedding Generation

- **Model**: Xenova/all-MiniLM-L6-v2 (22MB)
- **Speed**: ~100-200 embeddings/second (hardware dependent)
- **Batch optimization**: 32 documents per batch

## Use Cases

### 1. Tool Discovery

```typescript
interface ToolMetadata extends DocumentMetadata {
  id: string;
  toolName: string;
  category: string;
}

const db = new VectoriaDB<ToolMetadata>();
await db.initialize();

await db.addMany([
  { id: 'tool-1', text: 'Create user accounts', metadata: { id: 'tool-1', toolName: 'create_user', category: 'auth' } },
  { id: 'tool-2', text: 'Send emails', metadata: { id: 'tool-2', toolName: 'send_email', category: 'notification' } },
]);

const results = await db.search('how to add new users');
// Returns: [{ metadata: { toolName: 'create_user', ... }, score: 0.89 }]
```

### 2. Documentation Search

```typescript
interface DocMetadata extends DocumentMetadata {
  id: string;
  title: string;
  section: string;
  url: string;
}

const db = new VectoriaDB<DocMetadata>();
// Add documentation pages
// Search with natural language
```

### 3. Product Search

```typescript
interface ProductMetadata extends DocumentMetadata {
  id: string;
  name: string;
  category: string;
  price: number;
}

const db = new VectoriaDB<ProductMetadata>();
// Add products with descriptions
// Search: "affordable wireless headphones"
```

## Testing

VectoriaDB comes with comprehensive tests covering all major functionality:

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

The test suite includes:

- **Embedding Service Tests**: Verify embedding generation and model initialization
- **Vector Database Tests**: Test CRUD operations, search, and filtering
- **Similarity Tests**: Validate cosine similarity calculations

All tests use mocked transformers.js to avoid downloading models during CI/CD, making tests fast and reliable.

## Comparison with Other Vector Databases

| Feature              | VectoriaDB | Pinecone | Weaviate | ChromaDB |
| -------------------- | ---------- | -------- | -------- | -------- |
| **In-memory**        | ✅         | ❌       | ❌       | ✅       |
| **Lightweight**      | ✅ (22MB)  | ❌       | ❌       | ⚠️       |
| **Type-safe**        | ✅         | ⚠️       | ⚠️       | ⚠️       |
| **Zero config**      | ✅         | ❌       | ❌       | ✅       |
| **Production-ready** | ✅         | ✅       | ✅       | ✅       |
| **Persistence**      | ❌         | ✅       | ✅       | ✅       |
| **Distributed**      | ❌         | ✅       | ✅       | ❌       |

VectoriaDB is ideal for:

- **Small to medium datasets** (<100k documents)
- **Fast in-memory search** without external dependencies
- **Embedded applications** that need semantic search
- **Development and testing** before scaling to production DBs

## Limitations

1. **Single process**: Not distributed (use Redis adapter for multi-pod setups)
2. **HNSW is approximate**: ~95% recall vs 100% with brute-force (use brute-force for exact results)
3. **In-memory primary**: Persistence via adapters (cache strategy, not database)

## Roadmap

- [x] Comprehensive test suite with mocked dependencies
- [x] HNSW indexing for faster search (>100k documents)
- [x] Persistence adapters (Redis, File, Memory)
- [x] Incremental updates without re-embedding
- [ ] Compression for stored embeddings
- [ ] Multi-vector embeddings per document

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

Apache-2.0

## Credits

Built with:

- [transformers.js](https://github.com/xenova/transformers.js) by Xenova
- Part of the [FrontMCP](https://github.com/agentfront/frontmcp) ecosystem
