/**
 * Configuration options for VectoriaDB
 */
export interface VectoriaConfig {
  /**
   * Name of the embedding model to use
   * @default 'Xenova/all-MiniLM-L6-v2'
   */
  modelName?: string;

  /**
   * Directory to cache downloaded models
   * @default './.cache/transformers'
   */
  cacheDir?: string;

  /**
   * Vector dimensions (auto-detected from model if not provided)
   */
  dimensions?: number;

  /**
   * Default similarity threshold for search results
   * @default 0.3
   */
  defaultSimilarityThreshold?: number;

  /**
   * Maximum number of results to return by default
   * @default 10
   */
  defaultTopK?: number;

  /**
   * Enable HNSW index for faster search
   * When enabled, provides O(log n) search instead of O(n) brute-force
   * @default false
   */
  useHNSW?: boolean;

  /**
   * HNSW index configuration
   */
  hnsw?: {
    /**
     * Maximum number of connections per node in layer > 0
     * Higher = better recall, more memory
     * @default 16
     */
    M?: number;

    /**
     * Maximum connections for layer 0 (typically M * 2)
     * @default 32
     */
    M0?: number;

    /**
     * Size of dynamic candidate list during construction
     * Higher = better quality index, slower construction
     * @default 200
     */
    efConstruction?: number;

    /**
     * Size of dynamic candidate list during search
     * Higher = better recall, slower search
     * @default 50
     */
    efSearch?: number;
  };

  /**
   * Storage adapter for persisting embeddings
   * @default MemoryStorageAdapter (no persistence)
   */
  storageAdapter?: any; // Will be typed as StorageAdapter in implementation

  /**
   * Tools hash for cache invalidation
   * Used to detect when tools/documents change
   * If not provided, cache won't be invalidated based on content
   */
  toolsHash?: string;

  /**
   * Version string for cache compatibility
   * Used to invalidate cache when version changes
   * @default package version
   */
  version?: string;

  /**
   * Maximum number of documents allowed in the database
   * Prevents memory exhaustion attacks
   * @default 100000
   */
  maxDocuments?: number;

  /**
   * Maximum size of a single document text (in characters)
   * Prevents memory exhaustion via huge documents
   * @default 1000000 (1 million characters ~1MB)
   */
  maxDocumentSize?: number;

  /**
   * Maximum number of documents in a single batch operation
   * Prevents DoS via massive batch operations
   * @default 1000
   */
  maxBatchSize?: number;

  /**
   * Enable verbose error messages
   * When false (production mode), error messages are sanitized to prevent information disclosure
   * When true (development mode), error messages include detailed information for debugging
   * @default true (development mode with verbose errors)
   */
  verboseErrors?: boolean;
}

/**
 * Metadata associated with a document embedding
 * Flexible structure to support any domain
 */
export interface DocumentMetadata {
  /**
   * Unique identifier for the document
   */
  id: string;

  /**
   * Additional metadata fields (flexible)
   */
  [key: string]: any;
}

/**
 * Stored document embedding with vector and metadata
 */
export interface DocumentEmbedding<T extends DocumentMetadata = DocumentMetadata> {
  /**
   * Unique identifier for this embedding
   */
  id: string;

  /**
   * Vector representation
   */
  vector: Float32Array;

  /**
   * Associated metadata
   */
  metadata: T;

  /**
   * Original text used to generate the embedding
   */
  text: string;

  /**
   * Timestamp when this embedding was created
   */
  createdAt: Date;
}

/**
 * Search filter function
 */
export type FilterFunction<T extends DocumentMetadata = DocumentMetadata> = (metadata: T) => boolean;

/**
 * Search options
 */
export interface SearchOptions<T extends DocumentMetadata = DocumentMetadata> {
  /**
   * Maximum number of results to return
   * @default 10
   */
  topK?: number;

  /**
   * Minimum similarity score threshold (0-1)
   * @default 0.3
   */
  threshold?: number;

  /**
   * Filter function to apply to metadata
   * Returns true if the document should be included
   */
  filter?: FilterFunction<T>;

  /**
   * Whether to include the vector in results
   * @default false
   */
  includeVector?: boolean;
}

/**
 * Search result with similarity score
 */
export interface SearchResult<T extends DocumentMetadata = DocumentMetadata> {
  /**
   * Document ID
   */
  id: string;

  /**
   * Document metadata
   */
  metadata: T;

  /**
   * Cosine similarity score (0-1, higher is better)
   */
  score: number;

  /**
   * Original text used for embedding
   */
  text: string;

  /**
   * Vector (only if includeVector: true)
   */
  vector?: Float32Array;
}

/**
 * Statistics about the vector database
 */
export interface VectoriaStats {
  /**
   * Total number of embeddings
   */
  totalEmbeddings: number;

  /**
   * Vector dimensions
   */
  dimensions: number;

  /**
   * Memory usage estimate in bytes
   */
  estimatedMemoryBytes: number;

  /**
   * Embedding model name
   */
  modelName: string;
}

/**
 * Document data for embedding generation
 */
export interface DocumentData {
  /**
   * Main text content
   */
  text: string;

  /**
   * Additional metadata (optional)
   */
  metadata?: Record<string, any>;
}
