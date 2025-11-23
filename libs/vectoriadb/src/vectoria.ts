import { EmbeddingService } from './embedding.service';
import { cosineSimilarity } from './similarity.utils';
import type {
  VectoriaConfig,
  DocumentEmbedding,
  DocumentMetadata,
  SearchOptions,
  SearchResult,
  VectoriaStats,
} from './interfaces';

/**
 * VectoriaDB - A lightweight, production-ready in-memory vector database
 *
 * Features:
 * - Semantic search using cosine similarity
 * - Flexible metadata filtering
 * - Batch operations for efficiency
 * - TypeScript generic support for type-safe metadata
 */
export class VectoriaDB<T extends DocumentMetadata = DocumentMetadata> {
  private embeddings: Map<string, DocumentEmbedding<T>>;
  private embeddingService: EmbeddingService;
  private config: Required<VectoriaConfig>;

  constructor(config: VectoriaConfig = {}) {
    this.embeddings = new Map();
    this.embeddingService = new EmbeddingService(config.modelName, config.cacheDir);

    this.config = {
      modelName: config.modelName || 'Xenova/all-MiniLM-L6-v2',
      cacheDir: config.cacheDir || './.cache/transformers',
      dimensions: config.dimensions || 384,
      defaultSimilarityThreshold: config.defaultSimilarityThreshold ?? 0.3,
      defaultTopK: config.defaultTopK || 10,
    };
  }

  /**
   * Initialize the vector database
   * Must be called before using the database
   */
  async initialize(): Promise<void> {
    await this.embeddingService.initialize();
    this.config.dimensions = this.embeddingService.getDimensions();
  }

  /**
   * Check if the database is initialized
   */
  isInitialized(): boolean {
    return this.embeddingService.isReady();
  }

  /**
   * Add a document to the vector database
   * @throws Error if database is not initialized or document ID already exists
   */
  async add(id: string, text: string, metadata: T): Promise<void> {
    if (!this.isInitialized()) {
      throw new Error('VectoriaDB must be initialized before adding documents. Call initialize() first.');
    }

    if (this.embeddings.has(id)) {
      throw new Error(`Document with id "${id}" already exists. Use remove() first or choose a different id.`);
    }

    // Generate embedding
    const vector = await this.embeddingService.generateEmbedding(text);

    // Create embedding object
    const embedding: DocumentEmbedding<T> = {
      id,
      vector,
      metadata,
      text,
      createdAt: new Date(),
    };

    // Store embedding
    this.embeddings.set(id, embedding);
  }

  /**
   * Add multiple documents in batch
   * @throws Error if database is not initialized or any document ID already exists
   */
  async addMany(documents: Array<{ id: string; text: string; metadata: T }>): Promise<void> {
    if (!this.isInitialized()) {
      throw new Error('VectoriaDB must be initialized before adding documents. Call initialize() first.');
    }

    // Check for duplicate IDs within the batch
    const ids = new Set<string>();
    for (const doc of documents) {
      if (ids.has(doc.id)) {
        throw new Error(`Duplicate document id "${doc.id}" in batch`);
      }
      if (this.embeddings.has(doc.id)) {
        throw new Error(`Document with id "${doc.id}" already exists`);
      }
      ids.add(doc.id);
    }

    // Extract texts
    const texts = documents.map((d) => d.text);

    // Generate embeddings in batch
    const vectors = await this.embeddingService.generateEmbeddings(texts);

    // Store embeddings
    for (let i = 0; i < documents.length; i++) {
      const { id, text, metadata } = documents[i];
      const vector = vectors[i];

      const embedding: DocumentEmbedding<T> = {
        id,
        vector,
        metadata,
        text,
        createdAt: new Date(),
      };

      this.embeddings.set(id, embedding);
    }
  }

  /**
   * Search for documents using semantic similarity
   * @throws Error if database is not initialized
   */
  async search(query: string, options: SearchOptions<T> = {}): Promise<SearchResult<T>[]> {
    if (!this.isInitialized()) {
      throw new Error('VectoriaDB must be initialized before searching. Call initialize() first.');
    }

    // Generate query embedding
    const queryVector = await this.embeddingService.generateEmbedding(query);

    // Get threshold and topK
    const threshold = options.threshold ?? this.config.defaultSimilarityThreshold;
    const topK = options.topK ?? this.config.defaultTopK;

    // Calculate similarities
    const results: SearchResult<T>[] = [];

    for (const embedding of this.embeddings.values()) {
      // Apply filter if provided
      if (options.filter && !options.filter(embedding.metadata)) {
        continue;
      }

      const score = cosineSimilarity(queryVector, embedding.vector);

      if (score >= threshold) {
        const result: SearchResult<T> = {
          id: embedding.id,
          metadata: embedding.metadata,
          score,
          text: embedding.text,
        };

        if (options.includeVector) {
          result.vector = embedding.vector;
        }

        results.push(result);
      }
    }

    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    // Return top K
    return results.slice(0, topK);
  }

  /**
   * Get a document by ID
   */
  get(id: string): DocumentEmbedding<T> | undefined {
    return this.embeddings.get(id);
  }

  /**
   * Check if a document exists
   */
  has(id: string): boolean {
    return this.embeddings.has(id);
  }

  /**
   * Remove a document from the database
   */
  remove(id: string): boolean {
    return this.embeddings.delete(id);
  }

  /**
   * Remove multiple documents
   */
  removeMany(ids: string[]): number {
    let removed = 0;
    for (const id of ids) {
      if (this.remove(id)) {
        removed++;
      }
    }
    return removed;
  }

  /**
   * Clear all embeddings
   */
  clear(): void {
    this.embeddings.clear();
  }

  /**
   * Get the number of embeddings
   */
  size(): number {
    return this.embeddings.size;
  }

  /**
   * Get all embedding IDs
   */
  keys(): string[] {
    return Array.from(this.embeddings.keys());
  }

  /**
   * Get all embeddings
   */
  values(): DocumentEmbedding<T>[] {
    return Array.from(this.embeddings.values());
  }

  /**
   * Get database statistics
   * @throws Error if database is not initialized
   */
  getStats(): VectoriaStats {
    if (!this.isInitialized()) {
      throw new Error('VectoriaDB must be initialized before getting stats. Call initialize() first.');
    }

    // Estimate memory usage
    const vectorBytes = this.embeddings.size * this.config.dimensions * 4; // Float32
    const metadataBytes = this.embeddings.size * 1024; // ~1KB per metadata (rough estimate)

    return {
      totalEmbeddings: this.embeddings.size,
      dimensions: this.config.dimensions,
      estimatedMemoryBytes: vectorBytes + metadataBytes,
      modelName: this.config.modelName,
    };
  }

  /**
   * Get documents by filter (without semantic search)
   */
  filter(filterFn: (metadata: T) => boolean): DocumentEmbedding<T>[] {
    return Array.from(this.embeddings.values()).filter((embedding) => filterFn(embedding.metadata));
  }

  /**
   * Get all documents
   */
  getAll(): DocumentEmbedding<T>[] {
    return Array.from(this.embeddings.values());
  }
}
