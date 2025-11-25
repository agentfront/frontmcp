// file: libs/plugins/src/codecall/services/tool-search.service.ts

import { ToolEntry, ScopeEntry } from '@frontmcp/sdk';
import { TFIDFVectoria, VectoriaDB, DocumentMetadata } from 'vectoriadb';
import type { EmbeddingStrategy, CodeCallEmbeddingOptions } from '../codecall.types';
import type {
  ToolSearch,
  ToolSearchResult as SymbolToolSearchResult,
  ToolSearchOptions as SymbolToolSearchOptions,
} from '../codecall.symbol';

/**
 * Metadata structure for tool documents in the vector database
 */
interface ToolMetadata extends DocumentMetadata {
  id: string;
  toolName: string;
  qualifiedName: string;
  appId?: string;
  toolInstance: ToolEntry<any, any>;
}

/**
 * Search result for tool search
 */
export interface SearchResult {
  tool: ToolEntry<any, any>;
  score: number;
  toolName: string;
  qualifiedName: string;
  appId?: string;
}

/**
 * Search options for tool search
 */
export interface SearchOptions {
  topK?: number;
  appIds?: string[];
  excludeToolNames?: string[];
  minScore?: number;
}

/**
 * Configuration for tool search service
 */
export interface ToolSearchServiceConfig {
  /**
   * Embedding strategy to use
   * @default 'tfidf'
   */
  strategy?: EmbeddingStrategy;

  /**
   * Full embedding options (alternative to just strategy)
   */
  embeddingOptions?: CodeCallEmbeddingOptions;

  /**
   * Default number of results to return
   * @default 8
   */
  defaultTopK?: number;

  /**
   * Default similarity threshold
   * @default 0.0
   */
  defaultSimilarityThreshold?: number;
}

/**
 * Service that maintains a searchable index of tools from the ToolRegistry
 * Supports both TF-IDF (lightweight, synchronous) and ML-based (semantic) embeddings
 * Implements the ToolSearch interface for dependency injection
 */
export class ToolSearchService implements ToolSearch {
  private vectorDB: TFIDFVectoria<ToolMetadata> | VectoriaDB<ToolMetadata>;
  private strategy: EmbeddingStrategy;
  private initialized = false;
  private config: Required<ToolSearchServiceConfig>;
  private scope: ScopeEntry;

  constructor(config: ToolSearchServiceConfig = {}, scope: ScopeEntry) {
    this.scope = scope;
    const embeddingOptions: CodeCallEmbeddingOptions = config.embeddingOptions || {
      strategy: 'tfidf',
      modelName: 'Xenova/all-MiniLM-L6-v2',
      cacheDir: './.cache/transformers',
      useHNSW: false,
    };
    this.strategy = config.strategy || embeddingOptions.strategy || 'tfidf';

    this.config = {
      strategy: this.strategy,
      embeddingOptions,
      defaultTopK: config.defaultTopK ?? 8,
      defaultSimilarityThreshold: config.defaultSimilarityThreshold ?? 0.0,
    };

    // Initialize the appropriate vector database
    if (this.strategy === 'ml') {
      this.vectorDB = new VectoriaDB<ToolMetadata>({
        modelName: embeddingOptions.modelName || 'Xenova/all-MiniLM-L6-v2',
        cacheDir: embeddingOptions.cacheDir || './.cache/transformers',
        defaultTopK: this.config.defaultTopK,
        defaultSimilarityThreshold: this.config.defaultSimilarityThreshold,
        useHNSW: embeddingOptions.useHNSW || false,
      });
    } else {
      this.vectorDB = new TFIDFVectoria<ToolMetadata>({
        defaultTopK: this.config.defaultTopK,
        defaultSimilarityThreshold: this.config.defaultSimilarityThreshold,
      });
    }
  }

  /**
   * Initializes the search service by indexing all tools from the registry
   * Implements the ToolSearch interface - takes no parameters, reads from scope
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize ML model if using ML strategy
    if (this.strategy === 'ml' && this.vectorDB instanceof VectoriaDB) {
      await this.vectorDB.initialize();
    }

    // Get all tools from the scope
    const tools = this.scope.tools.getTools(true);

    // Index all existing tools
    const documents = tools.map((tool) => {
      const searchableText = this.extractSearchableText(tool);
      const appId = this.extractAppId(tool);
      const toolName = tool.name;
      const qualifiedName = tool.fullName || toolName;

      return {
        id: toolName,
        text: searchableText,
        metadata: {
          id: toolName,
          toolName,
          qualifiedName,
          appId,
          toolInstance: tool,
        },
      };
    });

    // Add all documents
    if (this.strategy === 'ml' && this.vectorDB instanceof VectoriaDB) {
      // ML-based: use batch add
      await this.vectorDB.addMany(documents);
    } else if (this.vectorDB instanceof TFIDFVectoria) {
      // TF-IDF: add documents and reindex
      this.vectorDB.addDocuments(documents);
      this.vectorDB.reindex();
    }

    this.initialized = true;
  }

  /**
   * Extracts searchable text from a tool instance
   */
  private extractSearchableText(tool: ToolEntry<any, any>): string {
    const parts: string[] = [];

    // Add tool name (weighted more by repeating)
    if (tool.name) {
      parts.push(tool.name, tool.name, tool.name);
    }

    // Add description from metadata
    if (tool.metadata.description) {
      parts.push(tool.metadata.description);
    }

    // Add tags if available
    if (tool.metadata.tags && tool.metadata.tags.length > 0) {
      parts.push(...tool.metadata.tags);
    }

    // Add input schema property names if available
    if (tool.rawInputSchema && typeof tool.rawInputSchema === 'object') {
      const schema = tool.rawInputSchema as any;
      if (schema.properties) {
        parts.push(...Object.keys(schema.properties));
      }
    }

    return parts.join(' ');
  }

  /**
   * Extracts app ID from tool's owner lineage
   */
  private extractAppId(tool: ToolEntry<any, any>): string | undefined {
    if (!tool.owner) return undefined;

    // The owner structure has kind and id
    if (tool.owner.kind === 'app') {
      return tool.owner.id;
    }

    // If the tool is owned by a plugin, we need to look at its parent scope
    // For now, we'll return undefined and rely on the lineage if needed
    return undefined;
  }

  /**
   * Searches for tools matching the query
   * Implements the ToolSearch interface
   */
  async search(query: string, options: SymbolToolSearchOptions = {}): Promise<SymbolToolSearchResult[]> {
    const { topK = this.config.defaultTopK, appIds, excludeToolNames = [] } = options;
    const minScore = this.config.defaultSimilarityThreshold;

    // Build filter function
    const filter = (metadata: ToolMetadata): boolean => {
      // Exclude tools
      if (excludeToolNames.includes(metadata.toolName)) {
        return false;
      }

      // Filter by appId if specified
      if (appIds && appIds.length > 0) {
        if (!metadata.appId || !appIds.includes(metadata.appId)) {
          return false;
        }
      }

      return true;
    };

    // Search using vectoriadb
    const results = await this.vectorDB.search(query, {
      topK,
      threshold: minScore,
      filter,
    });

    // Transform results to match the ToolSearch interface
    return results.map((result) => ({
      toolName: result.metadata.toolName,
      appId: result.metadata.appId,
      description: result.metadata.toolInstance.metadata.description || '',
      relevanceScore: result.score,
    }));
  }

  /**
   * Gets all indexed tool names
   */
  getAllToolNames(): string[] {
    if (this.vectorDB instanceof VectoriaDB) {
      return this.vectorDB.getAll().map((doc) => doc.id);
    } else {
      return this.vectorDB.getAllDocumentIds();
    }
  }

  /**
   * Gets the total number of indexed tools
   */
  getTotalCount(): number {
    if (this.vectorDB instanceof VectoriaDB) {
      return this.vectorDB.size();
    } else {
      return this.vectorDB.getDocumentCount();
    }
  }

  /**
   * Checks if a tool exists in the index
   */
  hasTool(toolName: string): boolean {
    if (this.vectorDB instanceof VectoriaDB) {
      return this.vectorDB.has(toolName);
    } else {
      return this.vectorDB.hasDocument(toolName);
    }
  }

  /**
   * Clears the entire index
   */
  clear(): void {
    this.vectorDB.clear();
    this.initialized = false;
  }

  /**
   * Get the current embedding strategy
   */
  getStrategy(): EmbeddingStrategy {
    return this.strategy;
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
