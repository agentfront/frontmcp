// file: libs/plugins/src/codecall/services/vector-db.service.ts

import { ToolEntry } from '@frontmcp/sdk';
import { EmbeddingService } from './embedding.service';

export interface ToolIndexEntry {
  toolInstance: ToolEntry<any, any>;
  vector: Map<string, number>;
  searchableText: string;
  appId?: string;
  toolName: string;
  qualifiedName: string;
}

export interface SearchResult {
  tool: ToolEntry<any, any>;
  score: number;
  toolName: string;
  qualifiedName: string;
  appId?: string;
}

export interface SearchOptions {
  topK?: number;
  appIds?: string[];
  excludeToolNames?: string[];
  minScore?: number;
}

/**
 * In-memory vector database for semantic tool search
 * Uses TF-IDF embeddings and cosine similarity
 */
export class VectorDBService {
  private embeddingService: EmbeddingService;
  private toolIndex: Map<string, ToolIndexEntry> = new Map();
  private needsReindex = false;

  constructor() {
    this.embeddingService = new EmbeddingService();
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
   * Adds or updates a tool in the index
   */
  addTool(tool: ToolEntry<any, any>, qualifiedName?: string): void {
    const searchableText = this.extractSearchableText(tool);
    const appId = this.extractAppId(tool);
    const toolName = tool.name;

    // Store tool entry (vector will be computed during reindex)
    this.toolIndex.set(tool.name, {
      toolInstance: tool,
      vector: new Map(),
      searchableText,
      appId,
      toolName,
      qualifiedName: qualifiedName || tool.fullName || toolName,
    });

    this.needsReindex = true;
  }

  /**
   * Removes a tool from the index
   */
  removeTool(toolName: string): void {
    this.toolIndex.delete(toolName);
    this.needsReindex = true;
  }

  /**
   * Rebuilds the IDF values and embeddings for all tools
   * Should be called after adding/removing tools
   */
  private reindexIfNeeded(): void {
    if (!this.needsReindex) return;

    const documents: string[][] = [];
    const entries = Array.from(this.toolIndex.values());

    // Tokenize all documents
    for (const entry of entries) {
      documents.push(this.embeddingService.tokenizeText(entry.searchableText));
    }

    // Update IDF values
    this.embeddingService.updateIDF(documents);

    // Recompute vectors for all tools
    for (const entry of entries) {
      entry.vector = this.embeddingService.embed(entry.searchableText);
    }

    this.needsReindex = false;
  }

  /**
   * Searches for tools matching the query
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const { topK = 8, appIds, excludeToolNames = [], minScore = 0.0 } = options;

    // Reindex if needed
    this.reindexIfNeeded();

    // Generate query vector
    const queryVector = this.embeddingService.embed(query);

    const excludeSet = new Set(excludeToolNames);
    const results: SearchResult[] = [];

    // Compute similarity for each tool
    for (const entry of this.toolIndex.values()) {
      // Skip excluded tools
      if (excludeSet.has(entry.toolName)) {
        continue;
      }

      // Filter by appId if specified
      if (appIds && appIds.length > 0) {
        if (!entry.appId || !appIds.includes(entry.appId)) {
          continue;
        }
      }

      // Compute similarity
      const score = this.embeddingService.cosineSimilarity(queryVector, entry.vector);

      if (score >= minScore) {
        results.push({
          tool: entry.toolInstance,
          score,
          toolName: entry.toolName,
          qualifiedName: entry.qualifiedName,
          appId: entry.appId,
        });
      }
    }

    // Sort by score (descending) and return top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Gets all indexed tool names
   */
  getAllToolNames(): string[] {
    return Array.from(this.toolIndex.keys());
  }

  /**
   * Gets the total number of indexed tools
   */
  getTotalCount(): number {
    return this.toolIndex.size;
  }

  /**
   * Checks if a tool exists in the index
   */
  hasTool(toolName: string): boolean {
    return this.toolIndex.has(toolName);
  }

  /**
   * Clears the entire index
   */
  clear(): void {
    this.toolIndex.clear();
    this.needsReindex = false;
  }
}
