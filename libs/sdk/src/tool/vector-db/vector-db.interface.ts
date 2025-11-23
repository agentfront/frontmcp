/**
 * Configuration options for the vector database
 */
export interface VectorDatabaseConfig {
  /**
   * Name of the embedding model to use
   * @default 'Xenova/all-MiniLM-L6-v2'
   */
  modelName?: string;

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
}

/**
 * Metadata associated with a tool embedding
 */
export interface ToolEmbeddingMetadata {
  /**
   * Unique tool identifier
   */
  toolId: string;

  /**
   * Tool name
   */
  toolName: string;

  /**
   * Application ID (for filtering)
   */
  appId?: string;

  /**
   * Provider ID (for filtering)
   */
  providerId?: string;

  /**
   * Owner key from tool lineage
   */
  ownerKey?: string;

  /**
   * Qualified name from registry
   */
  qualifiedName?: string;

  /**
   * Additional tags for categorization
   */
  tags?: string[];

  /**
   * Any additional custom metadata
   */
  [key: string]: any;
}

/**
 * Stored tool embedding with vector and metadata
 */
export interface ToolEmbedding {
  /**
   * Unique identifier for this embedding
   */
  id: string;

  /**
   * Vector representation of the tool
   */
  vector: Float32Array;

  /**
   * Associated metadata
   */
  metadata: ToolEmbeddingMetadata;

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
 * Search filter options
 */
export interface SearchFilter {
  /**
   * Filter by application ID(s)
   */
  appId?: string | string[];

  /**
   * Filter by specific tool names (for authorization)
   */
  toolNames?: string[];

  /**
   * Filter by provider ID(s)
   */
  providerId?: string | string[];

  /**
   * Filter by owner key(s)
   */
  ownerKey?: string | string[];

  /**
   * Filter by tags (tool must have at least one of these tags)
   */
  tags?: string[];

  /**
   * Custom metadata filters (exact match)
   */
  [key: string]: any;
}

/**
 * Search options
 */
export interface SearchOptions {
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
   * Metadata filters to apply
   */
  filter?: SearchFilter;

  /**
   * Whether to include the vector in results
   * @default false
   */
  includeVector?: boolean;
}

/**
 * Search result with similarity score
 */
export interface SearchResult {
  /**
   * Embedding ID
   */
  id: string;

  /**
   * Tool metadata
   */
  metadata: ToolEmbeddingMetadata;

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
export interface VectorDatabaseStats {
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

  /**
   * Breakdown by metadata field
   */
  breakdown: {
    byAppId: Record<string, number>;
    byProviderId: Record<string, number>;
    byOwnerKey: Record<string, number>;
  };
}

/**
 * Tool data for embedding generation
 */
export interface ToolData {
  /**
   * Tool name/title
   */
  name: string;

  /**
   * Tool description
   */
  description?: string;

  /**
   * Input schema (JSON Schema or description)
   */
  inputSchema?: any;

  /**
   * Output schema (JSON Schema or description)
   */
  outputSchema?: any;

  /**
   * Additional tags
   */
  tags?: string[];
}
