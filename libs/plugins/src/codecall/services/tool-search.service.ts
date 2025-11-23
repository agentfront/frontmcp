// file: libs/plugins/src/codecall/services/tool-search.service.ts

import { ToolEntry } from '@frontmcp/sdk';
import { VectorDBService, SearchResult, SearchOptions } from './vector-db.service';

/**
 * Service that maintains a searchable index of tools from the ToolRegistry
 * Automatically subscribes to registry changes and keeps the index up-to-date
 */
export class ToolSearchService {
  private vectorDB: VectorDBService;
  private initialized = false;

  constructor() {
    this.vectorDB = new VectorDBService();
  }

  /**
   * Initializes the search service by indexing all tools from the registry
   * Should be called once when the service is created
   */
  initialize(tools: readonly ToolEntry<any, any>[]): void {
    if (this.initialized) {
      return;
    }

    // Index all existing tools
    for (const tool of tools) {
      this.addTool(tool);
    }

    this.initialized = true;
  }

  /**
   * Adds a tool to the search index
   */
  private addTool(tool: ToolEntry<any, any>): void {
    // Use fullName as the qualified name, fallback to name
    const qualifiedName = tool.fullName || tool.name;
    this.vectorDB.addTool(tool, qualifiedName);
  }

  /**
   * Removes a tool from the search index
   */
  private removeTool(toolName: string): void {
    this.vectorDB.removeTool(toolName);
  }

  /**
   * Searches for tools matching the query
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    return this.vectorDB.search(query, options);
  }

  /**
   * Gets all indexed tool names
   */
  getAllToolNames(): string[] {
    return this.vectorDB.getAllToolNames();
  }

  /**
   * Gets the total number of indexed tools
   */
  getTotalCount(): number {
    return this.vectorDB.getTotalCount();
  }

  /**
   * Checks if a tool exists in the index
   */
  hasTool(toolName: string): boolean {
    return this.vectorDB.hasTool(toolName);
  }

  /**
   * Clears the entire index
   */
  clear(): void {
    this.vectorDB.clear();
    this.initialized = false;
  }
}
