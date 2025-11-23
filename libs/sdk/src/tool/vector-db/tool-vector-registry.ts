import { ToolVectorDatabase } from './vector-db.service';
import type ToolRegistry from '../tool.registry';
import type { ToolInstance } from '../tool.instance';
import type {
  VectorDatabaseConfig,
  ToolEmbeddingMetadata,
  SearchOptions,
  SearchResult,
  ToolData,
} from './vector-db.interface';

/**
 * Integration service that syncs ToolRegistry with ToolVectorDatabase
 * Provides semantic search over registered tools
 */
export class ToolVectorRegistry {
  private vectorDb: ToolVectorDatabase;
  private registry: ToolRegistry;
  private autoSync: boolean;
  private unsubscribe?: () => void;

  constructor(registry: ToolRegistry, config: VectorDatabaseConfig & { autoSync?: boolean } = {}) {
    this.registry = registry;
    this.vectorDb = new ToolVectorDatabase(config);
    this.autoSync = config.autoSync ?? true;
  }

  /**
   * Initialize the vector database and optionally sync tools
   */
  async initialize(syncImmediately: boolean = true): Promise<void> {
    await this.vectorDb.initialize();

    if (syncImmediately) {
      await this.syncAllTools();
    }

    if (this.autoSync) {
      this.startAutoSync();
    }
  }

  /**
   * Start listening to registry changes and auto-sync
   */
  private startAutoSync(): void {
    if (this.unsubscribe) {
      return; // Already syncing
    }

    this.unsubscribe = this.registry.subscribe({ immediate: false }, async (event) => {
      if (event.kind === 'reset') {
        // Full resync on reset
        await this.syncAllTools();
      }
    });
  }

  /**
   * Stop auto-syncing
   */
  stopAutoSync(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /**
   * Sync all tools from the registry to the vector database
   */
  async syncAllTools(): Promise<void> {
    const tools = this.registry.getTools(true); // Include hidden tools

    const toolsToAdd = tools.map((toolInstance) => {
      const instance = toolInstance as ToolInstance;
      const toolData = this.extractToolData(instance);
      const metadata = this.extractMetadata(instance);

      return {
        id: this.getToolId(instance),
        toolData,
        metadata,
      };
    });

    // Clear existing embeddings and add all tools
    this.vectorDb.clear();
    await this.vectorDb.addTools(toolsToAdd);
  }

  /**
   * Sync a single tool to the vector database
   */
  async syncTool(toolInstance: ToolInstance): Promise<void> {
    const id = this.getToolId(toolInstance);
    const toolData = this.extractToolData(toolInstance);
    const metadata = this.extractMetadata(toolInstance);

    await this.vectorDb.addTool(id, toolData, metadata);
  }

  /**
   * Remove a tool from the vector database
   */
  removeTool(toolInstance: ToolInstance): boolean {
    const id = this.getToolId(toolInstance);
    return this.vectorDb.remove(id);
  }

  /**
   * Search for tools using semantic similarity
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this.vectorDb.search(query, options);
  }

  /**
   * Search and return ToolInstance objects
   */
  async searchTools(query: string, options?: SearchOptions): Promise<Array<{ tool: ToolInstance; score: number }>> {
    const results = await this.search(query, options);

    return results
      .map((result) => {
        const tool = this.findToolByMetadata(result.metadata);
        return {
          tool: tool!,
          score: result.score,
        };
      })
      .filter((r) => r.tool !== null);
  }

  /**
   * Get tools by filter without semantic search
   */
  getToolsByFilter(filter: SearchOptions['filter']): ToolInstance[] {
    const embeddings = this.vectorDb.getByFilter(filter || {});
    return embeddings.map((e) => this.findToolByMetadata(e.metadata)).filter((t): t is ToolInstance => t !== null);
  }

  /**
   * Extract tool data for embedding
   */
  private extractToolData(instance: ToolInstance): ToolData {
    const metadata = instance.metadata;

    return {
      name: metadata.name,
      description: metadata.description,
      inputSchema: metadata.rawInputSchema || metadata.inputSchema,
      outputSchema: metadata.outputSchema,
      tags: metadata.tags,
    };
  }

  /**
   * Extract metadata for filtering and identification
   */
  private extractMetadata(instance: ToolInstance): ToolEmbeddingMetadata {
    const metadata = instance.metadata;

    // Try to extract appId, providerId, etc. from the registry
    const allIndexed = (this.registry as any).listAllIndexed?.() || [];
    const indexed = allIndexed.find((r: any) => r.instance === instance);

    return {
      toolId: metadata.id || this.getToolId(instance),
      toolName: metadata.name,
      appId: this.extractAppId(indexed),
      providerId: this.extractProviderId(indexed),
      ownerKey: indexed?.ownerKey,
      qualifiedName: indexed?.qualifiedName,
      tags: metadata.tags,
    };
  }

  /**
   * Extract appId from indexed tool
   */
  private extractAppId(indexed: any): string | undefined {
    if (!indexed?.lineage) return undefined;

    const appOwner = indexed.lineage.find((l: any) => l.kind === 'app');
    return appOwner?.id;
  }

  /**
   * Extract providerId from indexed tool
   */
  private extractProviderId(indexed: any): string | undefined {
    if (!indexed?.lineage) return undefined;

    const providerOwner = indexed.lineage.find((l: any) => l.kind === 'plugin' || l.kind === 'adapter');
    return providerOwner?.id;
  }

  /**
   * Get unique tool ID
   */
  private getToolId(instance: ToolInstance): string {
    const metadata = instance.metadata;

    // Use metadata.id if available
    if (metadata.id) {
      return metadata.id;
    }

    // Try to find qualified ID from registry
    const allIndexed = (this.registry as any).listAllIndexed?.() || [];
    const indexed = allIndexed.find((r: any) => r.instance === instance);

    if (indexed?.qualifiedId) {
      return indexed.qualifiedId;
    }

    // Fallback to name (not ideal for uniqueness)
    return metadata.name;
  }

  /**
   * Find tool instance by metadata
   */
  private findToolByMetadata(metadata: ToolEmbeddingMetadata): ToolInstance | null {
    const tools = this.registry.getTools(true);

    // Try to find by qualifiedId first
    if (metadata.qualifiedName) {
      const found = tools.find((t) => {
        const allIndexed = (this.registry as any).listAllIndexed?.() || [];
        const indexed = allIndexed.find((r: any) => r.instance === t);
        return indexed?.qualifiedName === metadata.qualifiedName;
      });

      if (found) {
        return found as ToolInstance;
      }
    }

    // Fallback to name matching
    const found = tools.find((t) => (t as ToolInstance).metadata.name === metadata.toolName);

    return found ? (found as ToolInstance) : null;
  }

  /**
   * Get the underlying vector database
   */
  getVectorDb(): ToolVectorDatabase {
    return this.vectorDb;
  }

  /**
   * Get database statistics
   */
  getStats() {
    return this.vectorDb.getStats();
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.vectorDb.isInitialized();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopAutoSync();
    this.vectorDb.clear();
  }
}
