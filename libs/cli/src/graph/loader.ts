/**
 * MCP loader for graph extraction.
 * Spawns a child process to load the entry file and extract graph data.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { GraphData } from './types';

/**
 * Result of loading an MCP server for graph extraction.
 */
export interface LoadResult {
  graphData: GraphData;
}

/**
 * Load an MCP entry file and extract graph data.
 * This spawns a subprocess to isolate the MCP server loading.
 */
export async function loadMcpForGraph(entryPath: string): Promise<GraphData> {
  const absoluteEntryPath = path.resolve(entryPath);
  const projectDir = path.dirname(absoluteEntryPath);

  // Create a temporary loader script in the project directory (so it can find node_modules)
  const loaderScript = createLoaderScript(absoluteEntryPath);
  const scriptPath = path.join(projectDir, `.frontmcp-graph-loader-${Date.now()}.ts`);

  try {
    await fs.writeFile(scriptPath, loaderScript);

    // Run the loader script with tsx (same as frontmcp dev)
    const result = await runLoaderScript(scriptPath, projectDir);

    return result;
  } finally {
    // Cleanup temp script
    try {
      await fs.unlink(scriptPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Create the loader script content.
 * This embeds the extraction logic directly to avoid import issues.
 */
function createLoaderScript(entryPath: string): string {
  const entryPathEscaped = entryPath.replace(/\\/g, '/');

  return `
/**
 * Auto-generated loader script for FrontMCP graph extraction.
 * Run with: npx tsx <this-file>
 */

import 'reflect-metadata';

// ============== Embedded Graph Types ==============
type GraphNodeType =
  | 'server' | 'scope' | 'app' | 'plugin' | 'adapter'
  | 'tool' | 'resource' | 'resource-template' | 'prompt' | 'auth';

interface GraphOwnerRef {
  kind: string;
  id: string;
}

interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  data: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'contains' | 'provides' | 'uses';
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    serverName: string;
    serverVersion?: string;
    generatedAt: string;
    entryFile: string;
    nodeCount: number;
    edgeCount: number;
  };
}

// ============== Embedded Extractor ==============
function extractGraphData(scopes: any[], config: any, entryFile: string): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const addedNodeIds = new Set<string>();

  const addNode = (node: GraphNode): void => {
    if (!addedNodeIds.has(node.id)) {
      nodes.push(node);
      addedNodeIds.add(node.id);
    }
  };

  const addEdge = (source: string, target: string, type: GraphEdge['type'] = 'contains'): void => {
    edges.push({ id: \`\${source}->\${target}\`, source, target, type });
  };

  // Server root node
  const serverNodeId = 'server:root';
  const serverName = config.name || config.info?.name || 'FrontMCP Server';
  const serverVersion = config.version || config.info?.version;
  addNode({
    id: serverNodeId,
    type: 'server',
    label: serverName,
    data: { name: serverName, description: \`FrontMCP Server v\${serverVersion || 'unknown'}\` },
  });

  // Process each scope
  for (const scope of scopes) {
    const scopeId = scope.id || 'default';
    const scopeNodeId = \`scope:\${scopeId}\`;

    // Check auth first to determine hierarchy
    // Scope-level auth: server -> auth -> scope -> apps
    // Public/no auth: server -> scope -> apps
    let authMode = 'public';
    let authNodeId: string | null = null;
    try {
      const auth = scope.authProviders?.getPrimary?.();
      if (auth && auth.options) {
        const mode = auth.options.mode || 'unknown';
        authMode = mode;

        // Only create auth node for non-public auth
        if (mode !== 'public') {
          const fullType = auth.options.type ? \`\${mode}:\${auth.options.type}\` : mode;
          const authLabel = \`Auth: \${fullType}\`;
          authNodeId = \`auth:\${scopeId}\`;

          addNode({
            id: authNodeId,
            type: 'auth',
            label: authLabel,
            data: {
              name: authLabel,
              authMode: mode,
              authType: fullType,
              protects: 'scope',
            },
          });

          // server -> auth (auth wraps the scope)
          addEdge(serverNodeId, authNodeId, 'contains');
        }
      }
    } catch {}

    // Add scope node
    addNode({
      id: scopeNodeId,
      type: 'scope',
      label: scope.metadata?.name || scopeId,
      data: { name: scope.metadata?.name || scopeId },
    });

    // Connect scope to parent (auth if non-public, otherwise server)
    if (authNodeId) {
      addEdge(authNodeId, scopeNodeId, 'contains');
    } else {
      addEdge(serverNodeId, scopeNodeId, 'contains');
    }

    // Extract apps - always connect to scope (auth is above scope)
    const appIds: string[] = [];
    try {
      const apps = scope.apps?.getApps?.() || [];
      for (const app of apps) {
        const appId = app.id || app.metadata?.id || 'unknown';
        const appNodeId = \`app:\${appId}\`;
        appIds.push(appId);
        addNode({
          id: appNodeId,
          type: 'app',
          label: app.metadata?.name || appId,
          data: { name: app.metadata?.name || appId },
        });
        // Apps are always under scope
        addEdge(scopeNodeId, appNodeId, 'contains');
      }
    } catch {}

    // First pass: Extract plugins from tool owners and create plugin nodes
    const pluginNodes = new Map<string, { id: string; name: string; parentId: string }>();
    try {
      const tools = scope.tools?.getTools?.(true) || [];
      for (const tool of tools) {
        if (tool.owner?.kind === 'plugin' && tool.owner?.id) {
          const pluginId = \`plugin:\${tool.owner.id}\`;
          if (!pluginNodes.has(pluginId)) {
            // Determine plugin parent (app or scope)
            const lineage = tool.lineage || [];
            let parentId = scopeNodeId;
            for (const ancestor of lineage) {
              if (ancestor.kind === 'app' && addedNodeIds.has(\`app:\${ancestor.id}\`)) {
                parentId = \`app:\${ancestor.id}\`;
                break;
              }
            }
            pluginNodes.set(pluginId, {
              id: pluginId,
              name: tool.owner.id,
              parentId: parentId,
            });
          }
        }
      }
    } catch {}

    // Create plugin nodes
    for (const [pluginId, plugin] of pluginNodes) {
      addNode({
        id: pluginId,
        type: 'plugin',
        label: plugin.name,
        data: { name: plugin.name },
      });
      addEdge(plugin.parentId, pluginId, 'contains');
    }

    // Extract tools (now plugins exist so tools can connect to them)
    try {
      const tools = scope.tools?.getTools?.(true) || [];
      for (const tool of tools) {
        const toolName = tool.name || tool.metadata?.name || 'unknown';
        let ownerId = scopeNodeId;

        // Determine owner: plugin > app > scope
        if (tool.owner?.kind === 'plugin' && tool.owner?.id) {
          ownerId = \`plugin:\${tool.owner.id}\`;
        } else if (tool.owner?.kind === 'app' && tool.owner?.id) {
          ownerId = \`app:\${tool.owner.id}\`;
        }

        const toolNodeId = \`tool:\${ownerId}:\${toolName}\`;
        if (!addedNodeIds.has(toolNodeId)) {
          addNode({
            id: toolNodeId,
            type: 'tool',
            label: toolName,
            data: {
              name: toolName,
              description: tool.metadata?.description,
              tags: tool.metadata?.tags,
            },
          });
          addEdge(addedNodeIds.has(ownerId) ? ownerId : scopeNodeId, toolNodeId, 'provides');
        }
      }
    } catch {}

    // Extract resources
    try {
      const resources = scope.resources?.getResources?.(true) || [];
      for (const resource of resources) {
        const resourceName = resource.name || resource.metadata?.name || 'unknown';
        const ownerId = resource.owner?.id ? \`\${resource.owner.kind}:\${resource.owner.id}\` : scopeNodeId;
        const resourceNodeId = \`resource:\${ownerId}:\${resourceName}\`;
        if (!addedNodeIds.has(resourceNodeId)) {
          addNode({
            id: resourceNodeId,
            type: 'resource',
            label: resourceName,
            data: {
              name: resourceName,
              description: resource.metadata?.description,
              uri: resource.metadata?.uri,
              mimeType: resource.metadata?.mimeType,
            },
          });
          addEdge(addedNodeIds.has(ownerId) ? ownerId : scopeNodeId, resourceNodeId, 'provides');
        }
      }
    } catch {}

    // Extract prompts
    try {
      const prompts = scope.prompts?.getPrompts?.(true) || [];
      for (const prompt of prompts) {
        const promptName = prompt.name || prompt.metadata?.name || 'unknown';
        const ownerId = prompt.owner?.id ? \`\${prompt.owner.kind}:\${prompt.owner.id}\` : scopeNodeId;
        const promptNodeId = \`prompt:\${ownerId}:\${promptName}\`;
        if (!addedNodeIds.has(promptNodeId)) {
          addNode({
            id: promptNodeId,
            type: 'prompt',
            label: promptName,
            data: {
              name: promptName,
              description: prompt.metadata?.description,
              arguments: prompt.metadata?.arguments,
            },
          });
          addEdge(addedNodeIds.has(ownerId) ? ownerId : scopeNodeId, promptNodeId, 'provides');
        }
      }
    } catch {}

  }

  return {
    nodes,
    edges,
    metadata: {
      serverName,
      serverVersion,
      generatedAt: new Date().toISOString(),
      entryFile,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };
}

// ============== Main Loader ==============
async function main() {
  try {
    // Import SDK first to get tokens and FrontMcpInstance
    const sdk = await import('@frontmcp/sdk');
    const { FrontMcpInstance, FrontMcpTokens } = sdk;

    // Import the entry file (this triggers @FrontMcp decorator)
    const entryModule = await import('${entryPathEscaped}');

    // Get the config - handle different export patterns
    let config: any = null;
    const defaultExport = entryModule.default || entryModule;

    // Case 1: Default export is a class decorated with @FrontMcp
    if (typeof defaultExport === 'function' && Reflect.hasMetadata(FrontMcpTokens.type, defaultExport)) {
      config = {
        info: Reflect.getMetadata(FrontMcpTokens.info, defaultExport),
        apps: Reflect.getMetadata(FrontMcpTokens.apps, defaultExport) || [],
        providers: Reflect.getMetadata(FrontMcpTokens.providers, defaultExport),
        logging: Reflect.getMetadata(FrontMcpTokens.logging, defaultExport),
        http: Reflect.getMetadata(FrontMcpTokens.http, defaultExport),
        auth: Reflect.getMetadata(FrontMcpTokens.auth, defaultExport),
        transport: Reflect.getMetadata(FrontMcpTokens.transport, defaultExport),
        serve: false,
      };
      if (config.info?.name) config.name = config.info.name;
      if (config.info?.version) config.version = config.info.version;
    }
    // Case 2: Default export is already a config object
    else if (defaultExport && typeof defaultExport === 'object') {
      config = { ...defaultExport, serve: false };
    }
    // Case 3: Named export 'config'
    else if (entryModule.config && typeof entryModule.config === 'object') {
      config = { ...entryModule.config, serve: false };
    }

    if (!config || typeof config !== 'object') {
      throw new Error('Could not find FrontMCP configuration. Expected @FrontMcp decorated class or config object.');
    }

    config.serve = false;

    // Create instance and extract graph
    const instance = await FrontMcpInstance.createForGraph(config);
    const scopes = instance.getScopes();
    const graphData = extractGraphData(scopes, config, '${entryPathEscaped}');

    // Output JSON (this is captured by parent process)
    console.log('__GRAPH_DATA_START__');
    console.log(JSON.stringify(graphData));
    console.log('__GRAPH_DATA_END__');
    process.exit(0);
  } catch (error: any) {
    console.error('Graph extraction error:', error?.message || error);
    process.exit(1);
  }
}

main();
`;
}

/**
 * Run the loader script and capture output.
 */
async function runLoaderScript(scriptPath: string, cwd: string): Promise<GraphData> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['-y', 'tsx', scriptPath], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: {
        ...process.env,
        // Prevent @FrontMcp decorator from starting the server
        FRONTMCP_SERVERLESS: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Graph extraction failed (exit code ${code}): ${stderr || stdout}`));
        return;
      }

      try {
        // Parse the JSON output between markers
        const startMarker = '__GRAPH_DATA_START__';
        const endMarker = '__GRAPH_DATA_END__';
        const startIdx = stdout.indexOf(startMarker);
        const endIdx = stdout.indexOf(endMarker);

        let jsonStr = '';
        if (startIdx !== -1 && endIdx !== -1) {
          jsonStr = stdout.substring(startIdx + startMarker.length, endIdx).trim();
        } else {
          // Fallback: try to find JSON in output
          const lines = stdout.trim().split('\n');
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.startsWith('{') && line.includes('"nodes"')) {
              jsonStr = line;
              break;
            }
          }
        }

        if (!jsonStr) {
          throw new Error('No graph data found in output');
        }

        const graphData = JSON.parse(jsonStr) as GraphData;
        resolve(graphData);
      } catch (parseError) {
        reject(new Error(`Failed to parse graph data: ${parseError}\n\nOutput: ${stdout}\n\nStderr: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to spawn loader process: ${error.message}`));
    });
  });
}
