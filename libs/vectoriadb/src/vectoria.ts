import { EmbeddingService } from './embedding.service';
import { cosineSimilarity } from './similarity.utils';
import { HNSWIndex } from './hnsw.index';
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
  private hnswIndex: HNSWIndex | null;

  constructor(config: VectoriaConfig = {}) {
    this.embeddings = new Map();
    this.embeddingService = new EmbeddingService(config.modelName, config.cacheDir);

    this.config = {
      modelName: config.modelName ?? 'Xenova/all-MiniLM-L6-v2',
      cacheDir: config.cacheDir ?? './.cache/transformers',
      dimensions: config.dimensions ?? 384,
      defaultSimilarityThreshold: config.defaultSimilarityThreshold ?? 0.3,
      defaultTopK: config.defaultTopK ?? 10,
      useHNSW: config.useHNSW ?? false,
      hnsw: config.hnsw ?? {},
    };

    // Initialize HNSW index if enabled
    if (this.config.useHNSW) {
      this.hnswIndex = new HNSWIndex(this.config.hnsw);
    } else {
      this.hnswIndex = null;
    }
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
   * @throws Error if database is not initialized, document ID already exists, or text is empty
   */
  async add(id: string, text: string, metadata: T): Promise<void> {
    if (!this.isInitialized()) {
      throw new Error('VectoriaDB must be initialized before adding documents. Call initialize() first.');
    }

    if (!text || !text.trim()) {
      throw new Error('Document text cannot be empty or whitespace-only');
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

    // Add to HNSW index if enabled
    if (this.hnswIndex) {
      this.hnswIndex.insert(id, vector);
    }
  }

  /**
   * Add multiple documents in batch
   * @throws Error if database is not initialized, any document ID already exists, or any text is empty
   */
  async addMany(documents: Array<{ id: string; text: string; metadata: T }>): Promise<void> {
    if (!this.isInitialized()) {
      throw new Error('VectoriaDB must be initialized before adding documents. Call initialize() first.');
    }

    // Check for duplicate IDs within the batch and validate text
    const ids = new Set<string>();
    for (const doc of documents) {
      if (!doc.text || !doc.text.trim()) {
        throw new Error(`Document with id "${doc.id}" has empty or whitespace-only text`);
      }
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

    // Defensive check: ensure vectors match documents
    if (vectors.length !== documents.length) {
      throw new Error(`Embedding generation mismatch: expected ${documents.length} vectors, got ${vectors.length}`);
    }

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

      // Add to HNSW index if enabled
      if (this.hnswIndex) {
        this.hnswIndex.insert(id, vector);
      }
    }
  }

  /**
   * Search for documents using semantic similarity
   * @throws Error if database is not initialized, query is empty, or search parameters are invalid
   */
  async search(query: string, options: SearchOptions<T> = {}): Promise<SearchResult<T>[]> {
    if (!this.isInitialized()) {
      throw new Error('VectoriaDB must be initialized before searching. Call initialize() first.');
    }

    if (!query || !query.trim()) {
      throw new Error('Search query cannot be empty or whitespace-only');
    }

    // Get threshold and topK
    const threshold = options.threshold ?? this.config.defaultSimilarityThreshold;
    const topK = options.topK ?? this.config.defaultTopK;

    if (topK <= 0) {
      throw new Error('topK must be a positive number');
    }

    if (threshold < 0 || threshold > 1) {
      throw new Error('threshold must be between 0 and 1');
    }

    // Generate query embedding
    const queryVector = await this.embeddingService.generateEmbedding(query);

    // Use HNSW index if enabled
    if (this.hnswIndex) {
      return this.searchWithHNSW(queryVector, topK, threshold, options);
    }

    // Fallback to brute-force search
    return this.searchBruteForce(queryVector, topK, threshold, options);
  }

  /**
   * Search using HNSW index (approximate nearest neighbor)
   */
  private searchWithHNSW(
    queryVector: Float32Array,
    topK: number,
    threshold: number,
    options: SearchOptions<T>,
  ): SearchResult<T>[] {
    // Get candidates from HNSW (more than topK to account for filtering)
    const searchK = options.filter ? Math.min(topK * 3, this.embeddings.size) : topK;
    const candidates = this.hnswIndex!.search(queryVector, searchK, this.config.hnsw?.efSearch);

    const results: SearchResult<T>[] = [];

    for (const candidate of candidates) {
      const embedding = this.embeddings.get(candidate.id);
      if (!embedding) {
        continue;
      }

      // Apply filter if provided
      if (options.filter && !options.filter(embedding.metadata)) {
        continue;
      }

      // Convert distance to similarity (HNSW uses distance = 1 - similarity)
      const score = 1 - candidate.distance;

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

        // Stop early if we have enough results
        if (results.length >= topK) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Search using brute-force (exact nearest neighbor)
   */
  private searchBruteForce(
    queryVector: Float32Array,
    topK: number,
    threshold: number,
    options: SearchOptions<T>,
  ): SearchResult<T>[] {
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
    const deleted = this.embeddings.delete(id);

    // Remove from HNSW index if enabled
    if (deleted && this.hnswIndex) {
      this.hnswIndex.remove(id);
    }

    return deleted;
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

    // Clear HNSW index if enabled
    if (this.hnswIndex) {
      this.hnswIndex.clear();
    }
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
