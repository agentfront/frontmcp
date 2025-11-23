# Tool Vector Database

A production-ready, lightweight in-memory vector database for semantic search over tool embeddings. Built specifically for FrontMCP's tool discovery and search capabilities.

## Features

- **Semantic Search**: Find tools using natural language queries
- **Metadata Filtering**: Filter by appId, providerId, ownerKey, tags, and custom metadata
- **Authorization**: Filter tools by authorized tool names
- **Lightweight**: Uses efficient in-memory storage with Float32Arrays
- **Production-Ready**: Built with TypeScript, fully typed, and optimized for performance
- **Auto-Sync**: Optional automatic synchronization with ToolRegistry
- **Batch Operations**: Efficient batch embedding generation and insertion
- **Cosine Similarity**: Fast similarity search using optimized vector operations

## Architecture

### Components

1. **ToolVectorDatabase**: Core vector database service

   - In-memory vector storage
   - Similarity search with cosine similarity
   - Multiple indexes for fast filtering
   - Statistics and monitoring

2. **EmbeddingService**: Embedding generation using transformers.js

   - Uses `Xenova/all-MiniLM-L6-v2` model (22MB, 384 dimensions)
   - Batch embedding generation
   - Tool-to-text conversion with schema parsing

3. **ToolVectorRegistry**: Integration with ToolRegistry

   - Automatic synchronization
   - Tool instance resolution
   - Metadata extraction from registry

4. **Similarity Utils**: Vector operations
   - Cosine similarity
   - Euclidean distance
   - Dot product
   - Vector normalization

## Installation

The vector database is included in the FrontMCP SDK. Make sure you have the required dependency:

```bash
yarn add @huggingface/transformers
```

## Quick Start

### Basic Usage

```typescript
import { ToolVectorDatabase } from '@frontmcp/sdk/tool/vector-db';

// Create and initialize the database
const vectorDb = new ToolVectorDatabase({
  modelName: 'Xenova/all-MiniLM-L6-v2',
  defaultTopK: 10,
  defaultSimilarityThreshold: 0.3,
});

await vectorDb.initialize();

// Add a tool
await vectorDb.addTool(
  'tool-1',
  {
    name: 'create_user',
    description: 'Create a new user account',
    inputSchema: {
      /* ... */
    },
    outputSchema: {
      /* ... */
    },
    tags: ['user', 'admin'],
  },
  {
    toolId: 'tool-1',
    toolName: 'create_user',
    appId: 'portal',
    providerId: 'auth-plugin',
  },
);

// Search
const results = await vectorDb.search('how to create an account', {
  topK: 5,
  threshold: 0.3,
});

results.forEach((result) => {
  console.log(`${result.metadata.toolName}: ${result.score}`);
});
```

### Integration with ToolRegistry

```typescript
import { ToolVectorRegistry } from '@frontmcp/sdk/tool/vector-db';

// Create vector registry that syncs with ToolRegistry
const vectorRegistry = new ToolVectorRegistry(toolRegistry, {
  modelName: 'Xenova/all-MiniLM-L6-v2',
  autoSync: true, // Automatically sync when tools change
});

await vectorRegistry.initialize();

// Search and get ToolInstance objects directly
const results = await vectorRegistry.searchTools('create user account', {
  topK: 5,
});

results.forEach(({ tool, score }) => {
  console.log(`${tool.metadata.name}: ${score}`);
});
```

## Advanced Usage

### Filtering by Metadata

```typescript
// Filter by appId
const results = await vectorDb.search('manage users', {
  filter: { appId: 'portal' },
});

// Filter by multiple appIds
const results = await vectorDb.search('send notification', {
  filter: { appId: ['portal', 'crm'] },
});

// Filter by providerId
const results = await vectorDb.search('authentication', {
  filter: { providerId: 'auth-plugin' },
});

// Filter by tags (OR logic - tool must have at least one tag)
const results = await vectorDb.search('user operations', {
  filter: { tags: ['user', 'admin'] },
});

// Combine multiple filters (AND logic)
const results = await vectorDb.search('create account', {
  filter: {
    appId: 'portal',
    providerId: 'auth-plugin',
    tags: ['user'],
  },
});
```

### Authorization-Based Filtering

```typescript
// User is authorized to use only specific tools
const authorizedTools = ['create_user', 'read_user', 'update_user'];

const results = await vectorDb.search('manage users', {
  filter: { toolNames: authorizedTools },
  topK: 10,
});

// Results will only include tools the user is authorized to use
```

### Batch Operations

```typescript
// Add multiple tools at once (more efficient)
await vectorDb.addTools([
  {
    id: 'tool-1',
    toolData: { name: 'create_user' /* ... */ },
    metadata: { toolId: 'tool-1' /* ... */ },
  },
  {
    id: 'tool-2',
    toolData: { name: 'delete_user' /* ... */ },
    metadata: { toolId: 'tool-2' /* ... */ },
  },
  // ... more tools
]);
```

### Get Tools Without Search

```typescript
// Get tools by filter without semantic search
const authTools = vectorDb.getByFilter({
  providerId: 'auth-plugin',
});

// Get a specific tool
const tool = vectorDb.get('tool-1');

// Check if tool exists
if (vectorDb.has('tool-1')) {
  // ...
}
```

### Statistics and Monitoring

```typescript
const stats = vectorDb.getStats();

console.log(`Total embeddings: ${stats.totalEmbeddings}`);
console.log(`Dimensions: ${stats.dimensions}`);
console.log(`Memory usage: ${stats.estimatedMemoryBytes} bytes`);
console.log(`Model: ${stats.modelName}`);

// Breakdown by metadata
console.log('By App:', stats.breakdown.byAppId);
console.log('By Provider:', stats.breakdown.byProviderId);
console.log('By Owner:', stats.breakdown.byOwnerKey);
```

### Cleanup

```typescript
// Remove a tool
vectorDb.remove('tool-1');

// Remove multiple tools
vectorDb.removeMany(['tool-1', 'tool-2']);

// Clear all tools
vectorDb.clear();

// Get database size
const count = vectorDb.size();
```

## Performance

### Memory Usage

The vector database is designed to be lightweight and memory-efficient:

- **Embeddings**: ~1.5KB per tool (384 dimensions × 4 bytes)
- **Metadata**: ~1KB per tool (estimated)
- **Indexes**: ~100 bytes per index entry

**Example**: 1,000 tools ≈ 2.6 MB

### Search Performance

- **O(n) similarity calculation**: Linear scan over all embeddings
- **Indexed filtering**: O(1) lookup for metadata filters
- **Combined**: Filter first (fast), then similarity search (linear on filtered set)

For larger datasets (>10,000 tools), consider implementing HNSW indexing for faster similarity search.

### Embedding Generation

- **Model**: Xenova/all-MiniLM-L6-v2 (22MB)
- **Batch size**: 32 (configurable in EmbeddingService)
- **Speed**: ~100-200 embeddings/second (depends on hardware)

## Configuration

### VectorDatabaseConfig

```typescript
interface VectorDatabaseConfig {
  modelName?: string; // Default: 'Xenova/all-MiniLM-L6-v2'
  dimensions?: number; // Auto-detected from model
  defaultSimilarityThreshold?: number; // Default: 0.3
  defaultTopK?: number; // Default: 10
}
```

### SearchOptions

```typescript
interface SearchOptions {
  topK?: number; // Max results to return
  threshold?: number; // Minimum similarity score (0-1)
  filter?: SearchFilter; // Metadata filters
  includeVector?: boolean; // Include vector in results (default: false)
}

interface SearchFilter {
  appId?: string | string[];
  toolNames?: string[];
  providerId?: string | string[];
  ownerKey?: string | string[];
  tags?: string[];
  [key: string]: any; // Custom filters
}
```

## API Reference

### ToolVectorDatabase

#### Methods

- `initialize(): Promise<void>` - Initialize the embedding model
- `addTool(id, toolData, metadata): Promise<void>` - Add a single tool
- `addTools(tools): Promise<void>` - Add multiple tools (batch)
- `search(query, options): Promise<SearchResult[]>` - Semantic search
- `get(id): ToolEmbedding | undefined` - Get tool by ID
- `has(id): boolean` - Check if tool exists
- `remove(id): boolean` - Remove a tool
- `removeMany(ids): number` - Remove multiple tools
- `clear(): void` - Remove all tools
- `size(): number` - Get number of embeddings
- `getStats(): VectorDatabaseStats` - Get database statistics
- `getByFilter(filter): ToolEmbedding[]` - Get tools by filter (no search)

### ToolVectorRegistry

#### Methods

- `initialize(syncImmediately): Promise<void>` - Initialize and sync
- `syncAllTools(): Promise<void>` - Manually sync all tools
- `syncTool(toolInstance): Promise<void>` - Sync a single tool
- `removeTool(toolInstance): boolean` - Remove a tool
- `search(query, options): Promise<SearchResult[]>` - Semantic search
- `searchTools(query, options): Promise<Array<{tool, score}>>` - Search with ToolInstance
- `getToolsByFilter(filter): ToolInstance[]` - Get tools by filter
- `getVectorDb(): ToolVectorDatabase` - Access underlying vector DB
- `getStats(): VectorDatabaseStats` - Get statistics
- `destroy(): void` - Cleanup resources

## Examples

See [example.ts](./example.ts) for comprehensive examples including:

1. Basic usage with ToolVectorDatabase
2. Integration with ToolRegistry
3. Advanced filtering combinations
4. Authorization-based filtering
5. Batch operations

## Best Practices

1. **Initialize once**: Call `initialize()` once at startup, not per request
2. **Use batch operations**: Add multiple tools with `addTools()` for better performance
3. **Filter before search**: Use metadata filters to reduce the search space
4. **Adjust threshold**: Tune `threshold` based on your use case (0.2-0.5 typically works well)
5. **Monitor memory**: Use `getStats()` to track memory usage in production
6. **Auto-sync carefully**: Only enable `autoSync` if your registry changes frequently

## Limitations

1. **In-memory only**: All data is lost on restart (by design)
2. **Linear search**: O(n) similarity search (fast enough for <10k tools)
3. **No persistence**: For persistence, integrate with Redis or another store
4. **Single model**: Currently uses one embedding model (can be extended)

## Future Enhancements

Potential improvements for future versions:

- [ ] HNSW indexing for faster similarity search (>10k tools)
- [ ] Persistent storage adapter (Redis, SQLite, etc.)
- [ ] Multiple embedding models support
- [ ] GPU acceleration for embedding generation
- [ ] Incremental updates without full re-embedding
- [ ] Query caching for common searches
- [ ] Compressed vector storage (quantization)

## License

Apache-2.0
