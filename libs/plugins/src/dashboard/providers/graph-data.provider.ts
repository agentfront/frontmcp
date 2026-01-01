import { Provider, ScopeEntry, ProviderRegistryInterface } from '@frontmcp/sdk';
import type { GraphData, GraphNode, GraphEdge, GraphMetadata } from '../shared/types';
import { GraphDataProviderToken } from '../dashboard.symbol';

// Re-export the token for convenience
export { GraphDataProviderToken };

/**
 * Provider that extracts graph data from all scopes at runtime.
 * Uses ScopeRegistry to get all scopes and excludes the dashboard scope.
 * Caches the extracted data to avoid expensive extraction on every request.
 */
@Provider({
  name: 'graph-data-provider',
})
export class GraphDataProvider {
  private cachedData: GraphData | null = null;
  private cacheTimestamp = 0;
  private readonly cacheTTL = 5000; // 5 seconds cache

  constructor(
    private readonly scope: ScopeEntry,
    private readonly serverName: string,
    private readonly serverVersion?: string,
  ) {}

  /**
   * Get graph data for the current scope.
   * Uses caching to avoid expensive extraction on every request.
   */
  async getGraphData(): Promise<GraphData> {
    const now = Date.now();

    // Return cached if still valid
    if (this.cachedData && now - this.cacheTimestamp < this.cacheTTL) {
      return this.cachedData;
    }

    // Extract fresh graph data
    this.cachedData = this.extractGraphData();
    this.cacheTimestamp = now;

    return this.cachedData;
  }

  /**
   * Invalidate the cache to force fresh extraction.
   */
  invalidateCache(): void {
    this.cachedData = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Get all scopes from the ScopeRegistry, excluding the dashboard scope.
   * Traverses up the provider hierarchy to find the ScopeRegistry if not found locally.
   */
  private getMonitoredScopes(): ScopeEntry[] {
    try {
      // Try to get ScopeRegistry from local providers first
      let scopeRegistries = this.scope.providers.getRegistries('ScopeRegistry');

      // If not found locally, traverse up the provider hierarchy
      // This is needed when dashboard is standalone (has its own isolated scope)
      // Access private parentProviders field via runtime cast
      if (!scopeRegistries || scopeRegistries.length === 0) {
        let currentProviders = (this.scope.providers as any).parentProviders;
        while (currentProviders && (!scopeRegistries || scopeRegistries.length === 0)) {
          scopeRegistries = currentProviders.getRegistries?.('ScopeRegistry') || [];
          currentProviders = currentProviders.parentProviders;
        }
      }

      if (!scopeRegistries || scopeRegistries.length === 0) {
        // Fallback to current scope if registry not available
        return [this.scope];
      }

      const scopeRegistry = scopeRegistries[0];
      const allScopes = scopeRegistry.getScopes();

      // Filter out the dashboard scope
      return allScopes.filter((s) => s.id !== 'dashboard');
    } catch {
      // Fallback to current scope if something goes wrong
      return [this.scope];
    }
  }

  /**
   * Extract graph data from all monitored scopes.
   */
  private extractGraphData(): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const addedNodeIds = new Set<string>();

    // Helper to add node and avoid duplicates
    const addNode = (node: GraphNode) => {
      if (!addedNodeIds.has(node.id)) {
        nodes.push(node);
        addedNodeIds.add(node.id);
      }
    };

    // Add server node
    const serverId = `server:${this.serverName}`;
    addNode({
      id: serverId,
      type: 'server',
      label: this.serverName,
      data: {
        name: this.serverName,
        description: `FrontMCP Server v${this.serverVersion || 'unknown'}`,
      },
    });

    // Get all scopes (excluding dashboard)
    const scopes = this.getMonitoredScopes();

    // Extract data from each scope
    for (const scope of scopes) {
      const scopeId = `scope:${scope.id}`;
      addNode({
        id: scopeId,
        type: 'scope',
        label: scope.id,
        data: {
          name: scope.id,
        },
      });

      edges.push({
        id: `${serverId}->${scopeId}`,
        source: serverId,
        target: scopeId,
        type: 'contains',
      });

      // Extract tools from this scope
      this.extractToolsFromScope(scope, scopeId, edges, addNode);

      // Extract resources from this scope
      this.extractResourcesFromScope(scope, scopeId, edges, addNode);

      // Extract resource templates from this scope
      this.extractResourceTemplatesFromScope(scope, scopeId, edges, addNode);

      // Extract prompts from this scope
      this.extractPromptsFromScope(scope, scopeId, edges, addNode);

      // Extract apps from this scope
      this.extractAppsFromScope(scope, scopeId, edges, addNode);
    }

    return {
      nodes,
      edges,
      metadata: this.createMetadata(nodes.length, edges.length),
    };
  }

  private extractToolsFromScope(
    scope: ScopeEntry,
    scopeId: string,
    edges: GraphEdge[],
    addNode: (node: GraphNode) => void,
  ): void {
    try {
      const tools = scope.tools?.getTools?.(true) || [];
      for (const tool of tools) {
        // Skip dashboard tools
        if (tool.fullName?.startsWith('dashboard:')) {
          continue;
        }
        const toolId = `tool:${tool.fullName}`;
        addNode({
          id: toolId,
          type: 'tool',
          label: tool.name,
          data: {
            name: tool.fullName,
            description: tool.metadata?.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            tags: tool.metadata?.tags,
            annotations: tool.metadata?.annotations,
          },
        });

        edges.push({
          id: `${scopeId}->${toolId}`,
          source: scopeId,
          target: toolId,
          type: 'provides',
        });
      }
    } catch {
      // Tools registry may not be available
    }
  }

  private extractResourcesFromScope(
    scope: ScopeEntry,
    scopeId: string,
    edges: GraphEdge[],
    addNode: (node: GraphNode) => void,
  ): void {
    try {
      const resources = scope.resources?.getResources?.(true) || [];
      for (const resource of resources) {
        const resourceId = `resource:${resource.uri}`;
        addNode({
          id: resourceId,
          type: 'resource',
          label: resource.name,
          data: {
            name: resource.name,
            description: resource.metadata?.description,
            uri: resource.uri,
            mimeType: resource.metadata?.mimeType,
          },
        });

        edges.push({
          id: `${scopeId}->${resourceId}`,
          source: scopeId,
          target: resourceId,
          type: 'provides',
        });
      }
    } catch {
      // Resources registry may not be available
    }
  }

  private extractResourceTemplatesFromScope(
    scope: ScopeEntry,
    scopeId: string,
    edges: GraphEdge[],
    addNode: (node: GraphNode) => void,
  ): void {
    try {
      const templates = scope.resources?.getResourceTemplates?.() || [];
      for (const template of templates) {
        const templateId = `resource-template:${template.uriTemplate}`;
        addNode({
          id: templateId,
          type: 'resource-template',
          label: template.name,
          data: {
            name: template.name,
            description: template.metadata?.description,
            uri: template.uriTemplate,
            mimeType: template.metadata?.mimeType,
          },
        });

        edges.push({
          id: `${scopeId}->${templateId}`,
          source: scopeId,
          target: templateId,
          type: 'provides',
        });
      }
    } catch {
      // Resource templates may not be available
    }
  }

  private extractPromptsFromScope(
    scope: ScopeEntry,
    scopeId: string,
    edges: GraphEdge[],
    addNode: (node: GraphNode) => void,
  ): void {
    try {
      const prompts = scope.prompts?.getPrompts?.(true) || [];
      for (const prompt of prompts) {
        const promptId = `prompt:${prompt.name}`;
        addNode({
          id: promptId,
          type: 'prompt',
          label: prompt.name,
          data: {
            name: prompt.name,
            description: prompt.metadata?.description,
            arguments: prompt.metadata?.arguments,
          },
        });

        edges.push({
          id: `${scopeId}->${promptId}`,
          source: scopeId,
          target: promptId,
          type: 'provides',
        });
      }
    } catch {
      // Prompts registry may not be available
    }
  }

  private extractAppsFromScope(
    scope: ScopeEntry,
    scopeId: string,
    edges: GraphEdge[],
    addNode: (node: GraphNode) => void,
  ): void {
    try {
      const apps = scope.apps?.getApps?.() || [];
      for (const app of apps) {
        // Skip dashboard app
        const appName = app.metadata?.name || 'unknown';
        if (appName === 'dashboard') {
          continue;
        }
        const appId = `app:${appName}`;
        addNode({
          id: appId,
          type: 'app',
          label: appName,
          data: {
            name: appName,
            description: app.metadata?.description,
          },
        });

        edges.push({
          id: `${scopeId}->${appId}`,
          source: scopeId,
          target: appId,
          type: 'contains',
        });
      }
    } catch {
      // Apps registry may not be available
    }
  }

  private createMetadata(nodeCount: number, edgeCount: number): GraphMetadata {
    return {
      serverName: this.serverName,
      serverVersion: this.serverVersion,
      generatedAt: new Date().toISOString(),
      entryFile: 'runtime',
      nodeCount,
      edgeCount,
    };
  }
}
