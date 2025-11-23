/**
 * Tool-specific adapter for VectoriaDB
 * Provides FrontMCP-specific integration with the generic VectoriaDB
 */

import { VectoriaDB, DocumentMetadata } from '@frontmcp/vectoria';
import type { ToolInstance } from '../tool.instance';
import type ToolRegistry from '../tool.registry';

/**
 * Tool-specific metadata for vector database
 */
export interface ToolEmbeddingMetadata extends DocumentMetadata {
  id: string;
  toolId: string;
  toolName: string;
  appId?: string;
  providerId?: string;
  ownerKey?: string;
  qualifiedName?: string;
  tags?: string[];
}

/**
 * Configuration for ToolVectorDB
 */
export interface ToolVectorDBConfig {
  modelName?: string;
  defaultTopK?: number;
  defaultSimilarityThreshold?: number;
  autoSync?: boolean;
}

/**
 * Tool-specific wrapper around VectoriaDB
 * Provides automatic tool-to-text conversion and registry integration
 */
export class ToolVectorDB {
  private db: VectoriaDB<ToolEmbeddingMetadata>;
  private registry?: ToolRegistry;
  private autoSync: boolean;
  private unsubscribe?: () => void;

  constructor(config: ToolVectorDBConfig = {}) {
    this.db = new VectoriaDB<ToolEmbeddingMetadata>({
      modelName: config.modelName,
      defaultTopK: config.defaultTopK,
      defaultSimilarityThreshold: config.defaultSimilarityThreshold,
    });
    this.autoSync = config.autoSync ?? false;
  }

  /**
   * Initialize the database
   */
  async initialize(): Promise<void> {
    await this.db.initialize();
  }

  /**
   * Connect to a ToolRegistry for automatic synchronization
   */
  async connectRegistry(registry: ToolRegistry, syncImmediately: boolean = true): Promise<void> {
    this.registry = registry;

    if (syncImmediately) {
      await this.syncAllTools();
    }

    if (this.autoSync) {
      this.startAutoSync();
    }
  }

  /**
   * Start auto-syncing with registry
   */
  private startAutoSync(): void {
    if (!this.registry || this.unsubscribe) {
      return;
    }

    this.unsubscribe = this.registry.subscribe({ immediate: false }, async (event) => {
      if (event.kind === 'reset') {
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
   * Sync all tools from the registry
   */
  async syncAllTools(): Promise<void> {
    if (!this.registry) {
      throw new Error('No registry connected. Call connectRegistry() first.');
    }

    const tools = this.registry.getTools(true);

    const documents = tools.map((tool) => {
      const instance = tool as ToolInstance;
      return {
        id: this.getToolId(instance),
        text: this.toolToText(instance),
        metadata: this.extractMetadata(instance),
      };
    });

    this.db.clear();
    await this.db.addMany(documents);
  }

  /**
   * Add a single tool
   */
  async addTool(toolInstance: ToolInstance): Promise<void> {
    const id = this.getToolId(toolInstance);
    const text = this.toolToText(toolInstance);
    const metadata = this.extractMetadata(toolInstance);

    await this.db.add(id, text, metadata);
  }

  /**
   * Search for tools
   */
  async search(
    query: string,
    options?: {
      topK?: number;
      threshold?: number;
      appId?: string | string[];
      providerId?: string | string[];
      toolNames?: string[];
      tags?: string[];
    },
  ) {
    return this.db.search(query, {
      topK: options?.topK,
      threshold: options?.threshold,
      filter: this.buildFilter(options),
    });
  }

  /**
   * Build filter function from options
   */
  private buildFilter(options?: {
    appId?: string | string[];
    providerId?: string | string[];
    toolNames?: string[];
    tags?: string[];
  }): ((metadata: ToolEmbeddingMetadata) => boolean) | undefined {
    if (!options) return undefined;

    return (metadata: ToolEmbeddingMetadata) => {
      // Filter by appId
      if (options.appId) {
        const appIds = Array.isArray(options.appId) ? options.appId : [options.appId];
        if (metadata.appId && !appIds.includes(metadata.appId)) {
          return false;
        }
      }

      // Filter by providerId
      if (options.providerId) {
        const providerIds = Array.isArray(options.providerId) ? options.providerId : [options.providerId];
        if (metadata.providerId && !providerIds.includes(metadata.providerId)) {
          return false;
        }
      }

      // Filter by toolNames (authorization)
      if (options.toolNames && options.toolNames.length > 0) {
        if (!options.toolNames.includes(metadata.toolName)) {
          return false;
        }
      }

      // Filter by tags (OR - must have at least one)
      if (options.tags && options.tags.length > 0) {
        if (!metadata.tags || !options.tags.some((tag) => metadata.tags!.includes(tag))) {
          return false;
        }
      }

      return true;
    };
  }

  /**
   * Convert tool to searchable text
   */
  private toolToText(instance: ToolInstance): string {
    const metadata = instance.metadata;
    const parts: string[] = [];

    // Add name
    if (metadata.name) {
      parts.push(`Tool: ${metadata.name}`);
    }

    // Add description
    if (metadata.description) {
      parts.push(`Description: ${metadata.description}`);
    }

    // Add input schema info
    if (metadata.rawInputSchema) {
      const inputInfo = this.schemaToText(metadata.rawInputSchema, 'Input');
      if (inputInfo) {
        parts.push(inputInfo);
      }
    }

    // Add output schema info
    if (metadata.outputSchema) {
      const outputInfo = this.schemaToText(metadata.outputSchema, 'Output');
      if (outputInfo) {
        parts.push(outputInfo);
      }
    }

    // Add tags
    if (metadata.tags && metadata.tags.length > 0) {
      parts.push(`Tags: ${metadata.tags.join(', ')}`);
    }

    return parts.join('. ');
  }

  /**
   * Convert JSON Schema to text
   */
  private schemaToText(schema: any, prefix: string): string {
    if (!schema) return '';

    const parts: string[] = [];

    if (typeof schema === 'string') {
      return `${prefix}: ${schema}`;
    }

    if (typeof schema === 'object') {
      if (schema.type === 'object' && schema.properties) {
        const fields = Object.entries(schema.properties)
          .map(([key, value]: [string, any]) => {
            const description = value.description || key;
            return description;
          })
          .join(', ');

        if (fields) {
          parts.push(`${prefix} fields: ${fields}`);
        }
      } else if (schema.description) {
        parts.push(`${prefix}: ${schema.description}`);
      } else if (schema.title) {
        parts.push(`${prefix}: ${schema.title}`);
      }
    }

    return parts.join('. ');
  }

  /**
   * Extract metadata from tool instance
   */
  private extractMetadata(instance: ToolInstance): ToolEmbeddingMetadata {
    const metadata = instance.metadata;
    const indexed = this.findIndexedTool(instance);

    return {
      id: this.getToolId(instance),
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
   * Find indexed tool from registry
   */
  private findIndexedTool(instance: ToolInstance): any {
    if (!this.registry) return undefined;

    const allIndexed = (this.registry as any).listAllIndexed?.() || [];
    return allIndexed.find((r: any) => r.instance === instance);
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
   * Get tool ID
   */
  private getToolId(instance: ToolInstance): string {
    const metadata = instance.metadata;

    if (metadata.id) {
      return metadata.id;
    }

    const indexed = this.findIndexedTool(instance);
    if (indexed?.qualifiedId) {
      return indexed.qualifiedId;
    }

    return metadata.name;
  }

  /**
   * Get the underlying VectoriaDB instance
   */
  getDB(): VectoriaDB<ToolEmbeddingMetadata> {
    return this.db;
  }

  /**
   * Get statistics
   */
  getStats() {
    return this.db.getStats();
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.db.isInitialized();
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.stopAutoSync();
    this.db.clear();
  }
}
