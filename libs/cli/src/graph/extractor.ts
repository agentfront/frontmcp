/**
 * Graph extractor for FrontMCP server structure.
 * Traverses all registries and builds a graph representation.
 */

import type { GraphData, GraphNode, GraphEdge, GraphOwnerRef } from './types';

/**
 * Minimal interface for scope entry to avoid SDK dependency in CLI.
 * The actual Scope class will satisfy this interface at runtime.
 */
interface ScopeInterface {
  id: string;
  metadata: {
    id: string;
    name?: string;
    version?: string;
  };
  tools: {
    getTools(includeHidden?: boolean): ToolEntryInterface[];
  };
  resources: {
    getResources(includeHidden?: boolean): ResourceEntryInterface[];
    getResourceTemplates?(): ResourceEntryInterface[];
  };
  prompts: {
    getPrompts(includeHidden?: boolean): PromptEntryInterface[];
  };
  apps: {
    getApps(): AppEntryInterface[];
  };
  authProviders?: {
    getPrimary?(): { mode?: string } | null;
  };
}

interface ToolEntryInterface {
  name: string;
  fullName?: string;
  owner?: { kind: string; id: string };
  metadata: {
    name: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    tags?: string[];
    annotations?: Record<string, unknown>;
  };
}

interface ResourceEntryInterface {
  name: string;
  owner?: { kind: string; id: string };
  metadata: {
    name: string;
    uri?: string;
    description?: string;
    mimeType?: string;
  };
}

interface PromptEntryInterface {
  name: string;
  owner?: { kind: string; id: string };
  metadata: {
    name: string;
    description?: string;
    arguments?: Array<{
      name: string;
      description?: string;
      required?: boolean;
    }>;
  };
}

interface AppEntryInterface {
  id: string;
  metadata: {
    id: string;
    name?: string;
  };
  tools?: {
    getTools(includeHidden?: boolean): ToolEntryInterface[];
  };
  resources?: {
    getResources(includeHidden?: boolean): ResourceEntryInterface[];
  };
  prompts?: {
    getPrompts(includeHidden?: boolean): PromptEntryInterface[];
  };
  plugins?: {
    getPlugins?(): PluginEntryInterface[];
  };
  adapters?: {
    getAdapters?(): AdapterEntryInterface[];
  };
}

interface PluginEntryInterface {
  id: string;
  metadata: {
    id: string;
    name?: string;
  };
}

interface AdapterEntryInterface {
  id: string;
  metadata: {
    id: string;
    name?: string;
    type?: string;
  };
}

interface ConfigInterface {
  name?: string;
  version?: string;
}

/**
 * Extract graph data from FrontMCP scopes.
 */
export function extractGraphData(scopes: ScopeInterface[], config: ConfigInterface, entryFile: string): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const addedNodeIds = new Set<string>();

  // Helper to add node if not already added
  const addNode = (node: GraphNode): void => {
    if (!addedNodeIds.has(node.id)) {
      nodes.push(node);
      addedNodeIds.add(node.id);
    }
  };

  // Helper to add edge
  const addEdge = (source: string, target: string, type: GraphEdge['type'] = 'contains'): void => {
    const edgeId = `${source}->${target}`;
    edges.push({
      id: edgeId,
      source,
      target,
      type,
    });
  };

  // Create server root node
  const serverNodeId = 'server:root';
  addNode({
    id: serverNodeId,
    type: 'server',
    label: config.name || 'FrontMCP Server',
    data: {
      name: config.name || 'FrontMCP Server',
      description: `FrontMCP Server v${config.version || 'unknown'}`,
    },
  });

  // Process each scope
  for (const scope of scopes) {
    const scopeNodeId = `scope:${scope.id}`;
    addNode({
      id: scopeNodeId,
      type: 'scope',
      label: scope.metadata.name || scope.id,
      data: {
        name: scope.metadata.name || scope.id,
      },
    });
    addEdge(serverNodeId, scopeNodeId);

    // Extract apps
    try {
      const apps = scope.apps.getApps();
      for (const app of apps) {
        const appNodeId = `app:${app.id}`;
        addNode({
          id: appNodeId,
          type: 'app',
          label: app.metadata.name || app.id,
          data: {
            name: app.metadata.name || app.id,
          },
        });
        addEdge(scopeNodeId, appNodeId);

        // Extract app-level tools
        if (app.tools) {
          const appTools = app.tools.getTools(true);
          for (const tool of appTools) {
            const toolNodeId = createToolNodeId(tool, appNodeId);
            addNode(createToolNode(toolNodeId, tool));
            addEdge(appNodeId, toolNodeId, 'provides');
          }
        }

        // Extract app-level resources
        if (app.resources) {
          const appResources = app.resources.getResources(true);
          for (const resource of appResources) {
            const resourceNodeId = createResourceNodeId(resource, appNodeId);
            addNode(createResourceNode(resourceNodeId, resource));
            addEdge(appNodeId, resourceNodeId, 'provides');
          }
        }

        // Extract app-level prompts
        if (app.prompts) {
          const appPrompts = app.prompts.getPrompts(true);
          for (const prompt of appPrompts) {
            const promptNodeId = createPromptNodeId(prompt, appNodeId);
            addNode(createPromptNode(promptNodeId, prompt));
            addEdge(appNodeId, promptNodeId, 'provides');
          }
        }

        // Extract plugins
        if (app.plugins?.getPlugins) {
          const plugins = app.plugins.getPlugins();
          for (const plugin of plugins) {
            const pluginNodeId = `plugin:${app.id}:${plugin.id}`;
            addNode({
              id: pluginNodeId,
              type: 'plugin',
              label: plugin.metadata.name || plugin.id,
              data: {
                name: plugin.metadata.name || plugin.id,
              },
            });
            addEdge(appNodeId, pluginNodeId);
          }
        }

        // Extract adapters
        if (app.adapters?.getAdapters) {
          const adapters = app.adapters.getAdapters();
          for (const adapter of adapters) {
            const adapterNodeId = `adapter:${app.id}:${adapter.id}`;
            addNode({
              id: adapterNodeId,
              type: 'adapter',
              label: adapter.metadata.name || adapter.id,
              data: {
                name: adapter.metadata.name || adapter.id,
                description: adapter.metadata.type ? `Type: ${adapter.metadata.type}` : undefined,
              },
            });
            addEdge(appNodeId, adapterNodeId);
          }
        }
      }
    } catch {
      // Apps registry may not be available
    }

    // Extract scope-level tools (includes adopted tools from apps)
    try {
      const tools = scope.tools.getTools(true);
      for (const tool of tools) {
        const parentId = getParentNodeId(tool.owner, scopeNodeId);
        const toolNodeId = createToolNodeId(tool, parentId);

        // Only add if not already added from app extraction
        if (!addedNodeIds.has(toolNodeId)) {
          addNode(createToolNode(toolNodeId, tool));
          addEdge(parentId, toolNodeId, 'provides');
        }
      }
    } catch {
      // Tools registry may not be available
    }

    // Extract scope-level resources
    try {
      const resources = scope.resources.getResources(true);
      for (const resource of resources) {
        const parentId = getParentNodeId(resource.owner, scopeNodeId);
        const resourceNodeId = createResourceNodeId(resource, parentId);

        if (!addedNodeIds.has(resourceNodeId)) {
          addNode(createResourceNode(resourceNodeId, resource));
          addEdge(parentId, resourceNodeId, 'provides');
        }
      }

      // Extract resource templates
      if (scope.resources.getResourceTemplates) {
        const templates = scope.resources.getResourceTemplates();
        for (const template of templates) {
          const parentId = getParentNodeId(template.owner, scopeNodeId);
          const templateNodeId = `resource-template:${parentId}:${template.name}`;

          if (!addedNodeIds.has(templateNodeId)) {
            addNode({
              id: templateNodeId,
              type: 'resource-template',
              label: template.name,
              data: {
                name: template.name,
                description: template.metadata.description,
                uri: template.metadata.uri,
                mimeType: template.metadata.mimeType,
              },
            });
            addEdge(parentId, templateNodeId, 'provides');
          }
        }
      }
    } catch {
      // Resources registry may not be available
    }

    // Extract scope-level prompts
    try {
      const prompts = scope.prompts.getPrompts(true);
      for (const prompt of prompts) {
        const parentId = getParentNodeId(prompt.owner, scopeNodeId);
        const promptNodeId = createPromptNodeId(prompt, parentId);

        if (!addedNodeIds.has(promptNodeId)) {
          addNode(createPromptNode(promptNodeId, prompt));
          addEdge(parentId, promptNodeId, 'provides');
        }
      }
    } catch {
      // Prompts registry may not be available
    }

    // Extract auth
    try {
      if (scope.authProviders?.getPrimary) {
        const auth = scope.authProviders.getPrimary();
        if (auth) {
          const authNodeId = `auth:${scope.id}`;
          addNode({
            id: authNodeId,
            type: 'auth',
            label: 'Authentication',
            data: {
              name: 'Authentication',
              authType: auth.mode || 'unknown',
            },
          });
          addEdge(scopeNodeId, authNodeId);
        }
      }
    } catch {
      // Auth may not be available
    }
  }

  return {
    nodes,
    edges,
    metadata: {
      serverName: config.name || 'FrontMCP Server',
      serverVersion: config.version,
      generatedAt: new Date().toISOString(),
      entryFile,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };
}

// Helper functions

function getParentNodeId(owner: GraphOwnerRef | undefined, defaultId: string): string {
  if (!owner) return defaultId;
  return `${owner.kind}:${owner.id}`;
}

function createToolNodeId(tool: ToolEntryInterface, parentId: string): string {
  return `tool:${parentId}:${tool.name}`;
}

function createToolNode(id: string, tool: ToolEntryInterface): GraphNode {
  return {
    id,
    type: 'tool',
    label: tool.name,
    data: {
      name: tool.name,
      description: tool.metadata.description,
      inputSchema: tool.metadata.inputSchema,
      outputSchema: tool.metadata.outputSchema,
      tags: tool.metadata.tags,
      annotations: tool.metadata.annotations,
      owner: tool.owner,
    },
  };
}

function createResourceNodeId(resource: ResourceEntryInterface, parentId: string): string {
  return `resource:${parentId}:${resource.name}`;
}

function createResourceNode(id: string, resource: ResourceEntryInterface): GraphNode {
  return {
    id,
    type: 'resource',
    label: resource.name,
    data: {
      name: resource.name,
      description: resource.metadata.description,
      uri: resource.metadata.uri,
      mimeType: resource.metadata.mimeType,
      owner: resource.owner,
    },
  };
}

function createPromptNodeId(prompt: PromptEntryInterface, parentId: string): string {
  return `prompt:${parentId}:${prompt.name}`;
}

function createPromptNode(id: string, prompt: PromptEntryInterface): GraphNode {
  return {
    id,
    type: 'prompt',
    label: prompt.name,
    data: {
      name: prompt.name,
      description: prompt.metadata.description,
      arguments: prompt.metadata.arguments,
      owner: prompt.owner,
    },
  };
}
