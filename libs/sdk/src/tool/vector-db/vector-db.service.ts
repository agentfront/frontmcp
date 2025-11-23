import { EmbeddingService } from './embedding.service';
import { cosineSimilarity } from './similarity.utils';
import type {
  VectorDatabaseConfig,
  ToolEmbedding,
  ToolEmbeddingMetadata,
  SearchOptions,
  SearchResult,
  VectorDatabaseStats,
  ToolData,
  SearchFilter,
} from './vector-db.interface';

/**
 * In-memory vector database for tool embeddings with semantic search
 */
export class ToolVectorDatabase {
  private embeddings: Map<string, ToolEmbedding>;
  private embeddingService: EmbeddingService;
  private config: Required<VectorDatabaseConfig>;

  // Indexes for fast filtering
  private indexByAppId: Map<string, Set<string>>;
  private indexByProviderId: Map<string, Set<string>>;
  private indexByOwnerKey: Map<string, Set<string>>;
  private indexByToolName: Map<string, Set<string>>;
  private indexByTag: Map<string, Set<string>>;

  constructor(config: VectorDatabaseConfig = {}) {
    this.embeddings = new Map();
    this.embeddingService = new EmbeddingService(config.modelName);

    this.config = {
      modelName: config.modelName || 'Xenova/all-MiniLM-L6-v2',
      dimensions: config.dimensions || 384,
      defaultSimilarityThreshold: config.defaultSimilarityThreshold ?? 0.3,
      defaultTopK: config.defaultTopK || 10,
    };

    // Initialize indexes
    this.indexByAppId = new Map();
    this.indexByProviderId = new Map();
    this.indexByOwnerKey = new Map();
    this.indexByToolName = new Map();
    this.indexByTag = new Map();
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
   * Add a tool to the vector database
   */
  async addTool(id: string, toolData: ToolData, metadata: ToolEmbeddingMetadata): Promise<void> {
    // Convert tool to text
    const text = this.embeddingService.toolToText(toolData);

    // Generate embedding
    const vector = await this.embeddingService.generateEmbedding(text);

    // Create embedding object
    const embedding: ToolEmbedding = {
      id,
      vector,
      metadata,
      text,
      createdAt: new Date(),
    };

    // Store embedding
    this.embeddings.set(id, embedding);

    // Update indexes
    this.updateIndexes(id, metadata);
  }

  /**
   * Add multiple tools in batch
   */
  async addTools(
    tools: Array<{
      id: string;
      toolData: ToolData;
      metadata: ToolEmbeddingMetadata;
    }>,
  ): Promise<void> {
    // Convert all tools to text
    const texts = tools.map((t) => this.embeddingService.toolToText(t.toolData));

    // Generate embeddings in batch
    const vectors = await this.embeddingService.generateEmbeddings(texts);

    // Store embeddings and update indexes
    for (let i = 0; i < tools.length; i++) {
      const { id, metadata, toolData } = tools[i];
      const vector = vectors[i];
      const text = texts[i];

      const embedding: ToolEmbedding = {
        id,
        vector,
        metadata,
        text,
        createdAt: new Date(),
      };

      this.embeddings.set(id, embedding);
      this.updateIndexes(id, metadata);
    }
  }

  /**
   * Update indexes for fast filtering
   */
  private updateIndexes(id: string, metadata: ToolEmbeddingMetadata): void {
    // Index by appId
    if (metadata.appId) {
      if (!this.indexByAppId.has(metadata.appId)) {
        this.indexByAppId.set(metadata.appId, new Set());
      }
      this.indexByAppId.get(metadata.appId)!.add(id);
    }

    // Index by providerId
    if (metadata.providerId) {
      if (!this.indexByProviderId.has(metadata.providerId)) {
        this.indexByProviderId.set(metadata.providerId, new Set());
      }
      this.indexByProviderId.get(metadata.providerId)!.add(id);
    }

    // Index by ownerKey
    if (metadata.ownerKey) {
      if (!this.indexByOwnerKey.has(metadata.ownerKey)) {
        this.indexByOwnerKey.set(metadata.ownerKey, new Set());
      }
      this.indexByOwnerKey.get(metadata.ownerKey)!.add(id);
    }

    // Index by toolName
    if (metadata.toolName) {
      if (!this.indexByToolName.has(metadata.toolName)) {
        this.indexByToolName.set(metadata.toolName, new Set());
      }
      this.indexByToolName.get(metadata.toolName)!.add(id);
    }

    // Index by tags
    if (metadata.tags && metadata.tags.length > 0) {
      for (const tag of metadata.tags) {
        if (!this.indexByTag.has(tag)) {
          this.indexByTag.set(tag, new Set());
        }
        this.indexByTag.get(tag)!.add(id);
      }
    }
  }

  /**
   * Remove indexes for a tool
   */
  private removeFromIndexes(id: string, metadata: ToolEmbeddingMetadata): void {
    if (metadata.appId) {
      this.indexByAppId.get(metadata.appId)?.delete(id);
    }

    if (metadata.providerId) {
      this.indexByProviderId.get(metadata.providerId)?.delete(id);
    }

    if (metadata.ownerKey) {
      this.indexByOwnerKey.get(metadata.ownerKey)?.delete(id);
    }

    if (metadata.toolName) {
      this.indexByToolName.get(metadata.toolName)?.delete(id);
    }

    if (metadata.tags && metadata.tags.length > 0) {
      for (const tag of metadata.tags) {
        this.indexByTag.get(tag)?.delete(id);
      }
    }
  }

  /**
   * Apply metadata filters to get candidate IDs
   */
  private applyFilters(filter?: SearchFilter): Set<string> | null {
    if (!filter) {
      return null; // No filter = search all
    }

    let candidateIds: Set<string> | null = null;

    // Filter by appId
    if (filter.appId) {
      const appIds = Array.isArray(filter.appId) ? filter.appId : [filter.appId];
      const appIdCandidates = new Set<string>();

      for (const appId of appIds) {
        const ids = this.indexByAppId.get(appId);
        if (ids) {
          ids.forEach((id) => appIdCandidates.add(id));
        }
      }

      candidateIds = this.intersectSets(candidateIds, appIdCandidates);
    }

    // Filter by providerId
    if (filter.providerId) {
      const providerIds = Array.isArray(filter.providerId) ? filter.providerId : [filter.providerId];
      const providerIdCandidates = new Set<string>();

      for (const providerId of providerIds) {
        const ids = this.indexByProviderId.get(providerId);
        if (ids) {
          ids.forEach((id) => providerIdCandidates.add(id));
        }
      }

      candidateIds = this.intersectSets(candidateIds, providerIdCandidates);
    }

    // Filter by ownerKey
    if (filter.ownerKey) {
      const ownerKeys = Array.isArray(filter.ownerKey) ? filter.ownerKey : [filter.ownerKey];
      const ownerKeyCandidates = new Set<string>();

      for (const ownerKey of ownerKeys) {
        const ids = this.indexByOwnerKey.get(ownerKey);
        if (ids) {
          ids.forEach((id) => ownerKeyCandidates.add(id));
        }
      }

      candidateIds = this.intersectSets(candidateIds, ownerKeyCandidates);
    }

    // Filter by toolNames (for authorization)
    if (filter.toolNames && filter.toolNames.length > 0) {
      const toolNameCandidates = new Set<string>();

      for (const toolName of filter.toolNames) {
        const ids = this.indexByToolName.get(toolName);
        if (ids) {
          ids.forEach((id) => toolNameCandidates.add(id));
        }
      }

      candidateIds = this.intersectSets(candidateIds, toolNameCandidates);
    }

    // Filter by tags (OR - tool must have at least one tag)
    if (filter.tags && filter.tags.length > 0) {
      const tagCandidates = new Set<string>();

      for (const tag of filter.tags) {
        const ids = this.indexByTag.get(tag);
        if (ids) {
          ids.forEach((id) => tagCandidates.add(id));
        }
      }

      candidateIds = this.intersectSets(candidateIds, tagCandidates);
    }

    return candidateIds;
  }

  /**
   * Intersect two sets (AND operation)
   */
  private intersectSets(a: Set<string> | null, b: Set<string>): Set<string> | null {
    if (a === null) {
      return b;
    }

    const result = new Set<string>();
    for (const id of a) {
      if (b.has(id)) {
        result.add(id);
      }
    }

    return result.size > 0 ? result : null;
  }

  /**
   * Search for tools using semantic similarity
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    // Generate query embedding
    const queryVector = await this.embeddingService.generateEmbedding(query);

    // Get candidates based on filters
    const candidateIds = this.applyFilters(options.filter);

    // Calculate similarities
    const results: SearchResult[] = [];
    const threshold = options.threshold ?? this.config.defaultSimilarityThreshold;

    // Iterate over embeddings
    const embeddingsToSearch =
      candidateIds === null
        ? Array.from(this.embeddings.values())
        : Array.from(candidateIds)
            .map((id) => this.embeddings.get(id))
            .filter((e): e is ToolEmbedding => e !== undefined);

    for (const embedding of embeddingsToSearch) {
      const score = cosineSimilarity(queryVector, embedding.vector);

      if (score >= threshold) {
        const result: SearchResult = {
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
    const topK = options.topK ?? this.config.defaultTopK;
    return results.slice(0, topK);
  }

  /**
   * Get a tool by ID
   */
  get(id: string): ToolEmbedding | undefined {
    return this.embeddings.get(id);
  }

  /**
   * Check if a tool exists
   */
  has(id: string): boolean {
    return this.embeddings.has(id);
  }

  /**
   * Remove a tool from the database
   */
  remove(id: string): boolean {
    const embedding = this.embeddings.get(id);
    if (!embedding) {
      return false;
    }

    this.removeFromIndexes(id, embedding.metadata);
    return this.embeddings.delete(id);
  }

  /**
   * Remove multiple tools
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
    this.indexByAppId.clear();
    this.indexByProviderId.clear();
    this.indexByOwnerKey.clear();
    this.indexByToolName.clear();
    this.indexByTag.clear();
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
  values(): ToolEmbedding[] {
    return Array.from(this.embeddings.values());
  }

  /**
   * Get database statistics
   */
  getStats(): VectorDatabaseStats {
    // Calculate breakdown
    const byAppId: Record<string, number> = {};
    const byProviderId: Record<string, number> = {};
    const byOwnerKey: Record<string, number> = {};

    for (const [appId, ids] of this.indexByAppId.entries()) {
      byAppId[appId] = ids.size;
    }

    for (const [providerId, ids] of this.indexByProviderId.entries()) {
      byProviderId[providerId] = ids.size;
    }

    for (const [ownerKey, ids] of this.indexByOwnerKey.entries()) {
      byOwnerKey[ownerKey] = ids.size;
    }

    // Estimate memory usage
    const vectorBytes = this.embeddings.size * this.config.dimensions * 4; // Float32
    const metadataBytes = this.embeddings.size * 1024; // ~1KB per metadata (rough estimate)
    const indexBytes =
      (this.indexByAppId.size +
        this.indexByProviderId.size +
        this.indexByOwnerKey.size +
        this.indexByToolName.size +
        this.indexByTag.size) *
      100; // ~100 bytes per index entry

    return {
      totalEmbeddings: this.embeddings.size,
      dimensions: this.config.dimensions,
      estimatedMemoryBytes: vectorBytes + metadataBytes + indexBytes,
      modelName: this.config.modelName,
      breakdown: {
        byAppId,
        byProviderId,
        byOwnerKey,
      },
    };
  }

  /**
   * Get tools by metadata filter (without semantic search)
   */
  getByFilter(filter: SearchFilter): ToolEmbedding[] {
    const candidateIds = this.applyFilters(filter);

    if (candidateIds === null) {
      return Array.from(this.embeddings.values());
    }

    return Array.from(candidateIds)
      .map((id) => this.embeddings.get(id))
      .filter((e): e is ToolEmbedding => e !== undefined);
  }
}
