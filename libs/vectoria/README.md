# VectoriaDB

> A lightweight, production-ready in-memory vector database for semantic search in JavaScript/TypeScript

VectoriaDB is a fast, zero-dependency (except transformers.js) vector database designed for in-memory semantic search. It's perfect for applications that need to quickly search through documents, tools, or any text-based data using natural language queries.

## Features

- **🚀 Fast**: In-memory storage with optimized cosine similarity search
- **🪶 Lightweight**: Minimal dependencies, small footprint
- **🔍 Semantic Search**: Natural language queries using state-of-the-art embeddings
- **🎯 Type-Safe**: Full TypeScript support with generics
- **⚡ Batch Operations**: Efficient bulk insert and search
- **🔧 Flexible Filtering**: Custom metadata filtering with type safety
- **📦 Production-Ready**: Battle-tested in FrontMCP

## Installation

```bash
npm install @frontmcp/vectoria
# or
yarn add @frontmcp/vectoria
# or
pnpm add @frontmcp/vectoria
```

## Quick Start

```typescript
import { VectoriaDB } from '@frontmcp/vectoria';

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

### Complex Filtering

Combine semantic search with complex metadata filters:

```typescript
const results = await db.search('user authentication', {
  topK: 10,
  threshold: 0.4,
  filter: (metadata) => {
    return (
      metadata.category === 'security' &&
      metadata.tags.includes('auth') &&
      metadata.author === 'security-team' &&
      new Date(metadata.createdAt) > new Date('2024-01-01')
    );
  },
});
```

## Performance

### Memory Usage

Memory efficient with Float32 arrays:

- **Embeddings**: ~1.5KB per document (384 dimensions × 4 bytes)
- **Metadata**: ~1KB per document (estimated)

**Example**: 10,000 documents ≈ 25 MB

### Search Speed

- **Linear scan**: O(n) where n = number of documents
- **Fast enough**: <10ms for 10,000 documents on modern hardware
- **Scalability**: For >100,000 documents, consider adding HNSW indexing

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

1. **In-memory only**: Data is lost on restart (by design)
2. **Single process**: Not distributed
3. **Linear search**: O(n) - for >100k documents, consider HNSW
4. **No persistence**: For persistence, integrate with Redis/SQLite

## Roadmap

- [ ] HNSW indexing for faster search (>100k documents)
- [ ] Persistence adapters (Redis, SQLite, File)
- [ ] Incremental updates without re-embedding
- [ ] Quantization for compressed storage
- [ ] GPU acceleration
- [ ] Multi-language support out of the box
- [ ] Query caching

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

Apache-2.0

## Credits

Built with:

- [transformers.js](https://github.com/xenova/transformers.js) by Xenova
- Part of the [FrontMCP](https://github.com/agentfront/frontmcp) ecosystem
