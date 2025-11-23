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
import { BaseStorageAdapter, StorageMetadata, StoredData } from './storage/adapter.interface';
import * as SerializationUtils from './storage/serialization.utils';
import { MemoryStorageAdapter } from './storage/memory.adapter';
import {
  VectoriaNotInitializedError,
  DocumentValidationError,
  DocumentNotFoundError,
  DocumentExistsError,
  DuplicateDocumentError,
  QueryValidationError,
  EmbeddingError,
} from './errors';

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
  private storageAdapter: BaseStorageAdapter<T>;

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
      storageAdapter: config.storageAdapter,
      toolsHash: config.toolsHash ?? '',
      version: config.version ?? '1.0.0',
      maxDocuments: config.maxDocuments ?? 100000,
      maxDocumentSize: config.maxDocumentSize ?? 1000000,
      maxBatchSize: config.maxBatchSize ?? 1000,
      verboseErrors: config.verboseErrors ?? true,
    };

    // Initialize HNSW index if enabled
    if (this.config.useHNSW) {
      this.hnswIndex = new HNSWIndex(this.config.hnsw);
    } else {
      this.hnswIndex = null;
    }

    // Initialize storage adapter (default to in-memory)
    this.storageAdapter = config.storageAdapter ?? new MemoryStorageAdapter<T>();
  }

  /**
   * Initialize the vector database
   * Must be called before using the database
   * Automatically loads from cache if available and valid
   */
  async initialize(): Promise<void> {
    // Initialize embedding service
    await this.embeddingService.initialize();
    this.config.dimensions = this.embeddingService.getDimensions();

    // Initialize storage adapter
    await this.storageAdapter.initialize();

    // Try to load from cache
    const loaded = await this.loadFromStorage();
    if (loaded) {
      // Successfully loaded from cache
      return;
    }

    // No valid cache, continue with empty database
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
      throw new VectoriaNotInitializedError('adding documents');
    }

    // Check document count limit (DoS protection)
    if (this.embeddings.size >= this.config.maxDocuments) {
      throw new DocumentValidationError(
        `Document limit exceeded. Maximum allowed documents: ${this.config.maxDocuments}`,
        id,
      );
    }

    if (!text || !text.trim()) {
      throw new DocumentValidationError('Document text cannot be empty or whitespace-only', id);
    }

    // Check document size limit (DoS protection)
    if (text.length > this.config.maxDocumentSize) {
      throw new DocumentValidationError(
        `Document text exceeds maximum size. Maximum allowed: ${this.config.maxDocumentSize} characters`,
        id,
      );
    }

    if (this.embeddings.has(id)) {
      throw new DocumentExistsError(id);
    }

    if (metadata.id !== id) {
      throw new DocumentValidationError(`Metadata id "${metadata.id}" does not match document id "${id}"`, id);
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
      throw new VectoriaNotInitializedError('adding documents');
    }

    // Check batch size limit (DoS protection)
    if (documents.length > this.config.maxBatchSize) {
      throw new DocumentValidationError(
        `Batch size exceeds maximum allowed. Maximum: ${this.config.maxBatchSize}, provided: ${documents.length}`,
      );
    }

    // Check if adding these documents would exceed the total document limit (DoS protection)
    const newTotal = this.embeddings.size + documents.length;
    if (newTotal > this.config.maxDocuments) {
      throw new DocumentValidationError(
        `Adding ${documents.length} documents would exceed maximum document limit. Current: ${this.embeddings.size}, Maximum: ${this.config.maxDocuments}`,
      );
    }

    // Check for duplicate IDs within the batch and validate text
    const ids = new Set<string>();
    for (const doc of documents) {
      if (!doc.text || !doc.text.trim()) {
        throw new DocumentValidationError(`Document with id "${doc.id}" has empty or whitespace-only text`, doc.id);
      }
      // Check document size limit (DoS protection)
      if (doc.text.length > this.config.maxDocumentSize) {
        throw new DocumentValidationError(
          `Document with id "${doc.id}" exceeds maximum size. Maximum allowed: ${this.config.maxDocumentSize} characters`,
          doc.id,
        );
      }
      if (doc.metadata.id !== doc.id) {
        throw new DocumentValidationError(
          `Document with id "${doc.id}": metadata.id "${doc.metadata.id}" does not match document id`,
          doc.id,
        );
      }
      if (ids.has(doc.id)) {
        throw new DuplicateDocumentError(doc.id, 'batch');
      }
      if (this.embeddings.has(doc.id)) {
        throw new DuplicateDocumentError(doc.id, 'existing');
      }
      ids.add(doc.id);
    }

    // Extract texts
    const texts = documents.map((d) => d.text);

    // Generate embeddings in batch
    const vectors = await this.embeddingService.generateEmbeddings(texts);

    // Defensive check: ensure vectors match documents
    if (vectors.length !== documents.length) {
      throw new EmbeddingError(
        `Embedding generation mismatch: expected ${documents.length} vectors, got ${vectors.length}`,
      );
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
      throw new VectoriaNotInitializedError('searching');
    }

    if (!query || !query.trim()) {
      throw new QueryValidationError('Search query cannot be empty or whitespace-only');
    }

    // Get threshold and topK
    const threshold = options.threshold ?? this.config.defaultSimilarityThreshold;
    const topK = options.topK ?? this.config.defaultTopK;

    if (topK <= 0) {
      throw new QueryValidationError('topK must be a positive number');
    }

    if (threshold < 0 || threshold > 1) {
      throw new QueryValidationError('threshold must be between 0 and 1');
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
   * Update document metadata without re-embedding
   * Fast operation - only updates metadata, keeps existing embedding
   * @throws Error if database is not initialized or document doesn't exist
   */
  updateMetadata(id: string, metadata: T): void {
    if (!this.isInitialized()) {
      throw new VectoriaNotInitializedError('updating');
    }

    const existing = this.embeddings.get(id);
    if (!existing) {
      throw new DocumentNotFoundError(id);
    }

    // Update metadata only, keep everything else the same
    existing.metadata = metadata;
  }

  /**
   * Update document with smart re-embedding
   * Only re-embeds if text changes (unless forceReembed is true)
   * @throws Error if database is not initialized, document doesn't exist, or text is empty
   */
  async update(
    id: string,
    updates: { text?: string; metadata?: T },
    options: { forceReembed?: boolean } = {},
  ): Promise<boolean> {
    if (!this.isInitialized()) {
      throw new VectoriaNotInitializedError('updating');
    }

    const existing = this.embeddings.get(id);
    if (!existing) {
      throw new DocumentNotFoundError(id);
    }

    // Check if text is being updated
    const textChanged = updates.text !== undefined && updates.text !== existing.text;
    const needsReembed = textChanged || options.forceReembed;

    // Validate new text if provided
    if (updates.text !== undefined && (!updates.text || !updates.text.trim())) {
      throw new DocumentValidationError('Document text cannot be empty or whitespace-only', id);
    }

    // Check document size limit (DoS protection)
    if (updates.text !== undefined && updates.text.length > this.config.maxDocumentSize) {
      throw new DocumentValidationError(
        `Document text exceeds maximum size. Maximum allowed: ${this.config.maxDocumentSize} characters`,
        id,
      );
    }

    // Update metadata if provided
    if (updates.metadata !== undefined) {
      existing.metadata = updates.metadata;
    }

    // Update text and re-embed if needed
    if (needsReembed && updates.text !== undefined) {
      const newText = updates.text;

      // Remove from HNSW index (will re-add with new embedding)
      if (this.hnswIndex) {
        this.hnswIndex.remove(id);
      }

      // Generate new embedding
      const vector = await this.embeddingService.generateEmbedding(newText);

      // Update the embedding
      existing.vector = vector;
      existing.text = newText;
      existing.createdAt = new Date();

      // Re-add to HNSW index
      if (this.hnswIndex) {
        this.hnswIndex.insert(id, vector);
      }

      return true; // Re-embedded
    }

    return false; // No re-embedding needed
  }

  /**
   * Update multiple documents with smart re-embedding
   * Only re-embeds documents where text changed
   * @throws Error if database is not initialized, any document doesn't exist, or any text is empty
   */
  async updateMany(
    updates: Array<{ id: string; text?: string; metadata?: T }>,
    options: { forceReembed?: boolean } = {},
  ): Promise<{ updated: number; reembedded: number }> {
    if (!this.isInitialized()) {
      throw new VectoriaNotInitializedError('updating');
    }

    // Check batch size limit (DoS protection)
    if (updates.length > this.config.maxBatchSize) {
      throw new DocumentValidationError(
        `Batch size exceeds maximum allowed. Maximum: ${this.config.maxBatchSize}, provided: ${updates.length}`,
      );
    }

    // Validate all documents exist and new texts are valid
    for (const update of updates) {
      if (!this.embeddings.has(update.id)) {
        throw new DocumentNotFoundError(update.id);
      }
      if (update.text !== undefined && (!update.text || !update.text.trim())) {
        throw new DocumentValidationError(
          `Document with id "${update.id}" has empty or whitespace-only text`,
          update.id,
        );
      }
      // Check document size limit (DoS protection)
      if (update.text !== undefined && update.text.length > this.config.maxDocumentSize) {
        throw new DocumentValidationError(
          `Document with id "${update.id}" exceeds maximum size. Maximum allowed: ${this.config.maxDocumentSize} characters`,
          update.id,
        );
      }
    }

    // Separate updates into metadata-only and re-embedding required
    const metadataOnlyUpdates: typeof updates = [];
    const reembedUpdates: typeof updates = [];

    for (const update of updates) {
      const existing = this.embeddings.get(update.id)!;
      const textChanged = update.text !== undefined && update.text !== existing.text;
      const needsReembed = textChanged || options.forceReembed;

      if (needsReembed && update.text !== undefined) {
        reembedUpdates.push(update);
      } else {
        metadataOnlyUpdates.push(update);
      }
    }

    // Update metadata-only updates (fast)
    for (const update of metadataOnlyUpdates) {
      const existing = this.embeddings.get(update.id)!;
      if (update.metadata !== undefined) {
        existing.metadata = update.metadata;
      }
    }

    // Batch re-embed updates that need it
    if (reembedUpdates.length > 0) {
      const texts = reembedUpdates.map((u) => u.text!);
      const vectors = await this.embeddingService.generateEmbeddings(texts);

      for (let i = 0; i < reembedUpdates.length; i++) {
        const update = reembedUpdates[i];
        const existing = this.embeddings.get(update.id)!;
        const vector = vectors[i];

        // Remove from HNSW if needed
        if (this.hnswIndex) {
          this.hnswIndex.remove(update.id);
        }

        // Update embedding
        existing.vector = vector;
        existing.text = update.text!;
        existing.createdAt = new Date();

        // Update metadata if provided
        if (update.metadata !== undefined) {
          existing.metadata = update.metadata;
        }

        // Re-add to HNSW
        if (this.hnswIndex) {
          this.hnswIndex.insert(update.id, vector);
        }
      }
    }

    return {
      updated: updates.length,
      reembedded: reembedUpdates.length,
    };
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
      throw new VectoriaNotInitializedError('getting stats');
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

  /**
   * Save embeddings to storage
   * Call this method to persist embeddings manually
   */
  async saveToStorage(): Promise<void> {
    if (!this.isInitialized()) {
      throw new VectoriaNotInitializedError('saving');
    }

    const metadata = this.getStorageMetadata();
    const embeddings = Array.from(this.embeddings.values()).map((emb) => SerializationUtils.serializeEmbedding(emb));

    const data: StoredData<T> = {
      metadata,
      embeddings,
    };

    await this.storageAdapter.save(data);
  }

  /**
   * Load embeddings from storage
   * Returns true if successfully loaded from cache
   * @private
   */
  private async loadFromStorage(): Promise<boolean> {
    try {
      const metadata = this.getStorageMetadata();

      // Check if valid cache exists
      const hasValid = await this.storageAdapter.hasValidCache(metadata);
      if (!hasValid) {
        return false;
      }

      // Load from storage
      const data = await this.storageAdapter.load();
      if (!data || !data.embeddings || data.embeddings.length === 0) {
        return false;
      }

      // Clear existing data
      this.clear();

      // Restore embeddings
      for (const serialized of data.embeddings) {
        const embedding = SerializationUtils.deserializeEmbedding(serialized);
        this.embeddings.set(embedding.id, embedding);

        // Add to HNSW index if enabled
        if (this.hnswIndex) {
          this.hnswIndex.insert(embedding.id, embedding.vector);
        }
      }

      return true;
    } catch {
      // Failed to load from cache, return false to continue with empty database
      return false;
    }
  }

  /**
   * Get storage metadata for the current state
   * @private
   */
  private getStorageMetadata(): StorageMetadata {
    return {
      version: this.config.version,
      toolsHash: this.config.toolsHash,
      timestamp: Date.now(),
      modelName: this.config.modelName,
      dimensions: this.config.dimensions,
      documentCount: this.embeddings.size,
    };
  }

  /**
   * Clear storage cache
   * This will delete all persisted embeddings
   */
  async clearStorage(): Promise<void> {
    await this.storageAdapter.clear();
  }

  /**
   * Close the database and storage adapter
   * Call this when shutting down to cleanup resources
   */
  async close(): Promise<void> {
    await this.storageAdapter.close();
  }
}
