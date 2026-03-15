/**
 * createWrappedServer — wraps a DirectMcpServer with a DynamicRegistry overlay.
 *
 * Intercepts listTools/callTool/listResources/readResource to merge
 * dynamically registered entries. All other methods delegate directly.
 */

import type {
  DirectMcpServer,
  DirectClient,
  DirectCallOptions,
  ListToolsResult,
  ListResourcesResult,
} from '@frontmcp/sdk';
import type { DynamicRegistry } from './DynamicRegistry';
import type { ToolInfo, ResourceInfo } from '../types';

/**
 * Patch a DirectClient's callTool/readResource to check the DynamicRegistry first.
 * Modifies the client in-place to preserve identity (important for tests and onConnected).
 */
function patchClientWithDynamic(client: DirectClient, dynamicRegistry: DynamicRegistry): DirectClient {
  if (typeof client.callTool === 'function') {
    const originalCallTool = client.callTool.bind(client);
    client.callTool = async (name: string, args?: Record<string, unknown>) => {
      const dynamicTool = dynamicRegistry.findTool(name);
      if (dynamicTool) {
        return dynamicTool.execute(args ?? {});
      }
      return originalCallTool(name, args);
    };
  }

  if (typeof client.readResource === 'function') {
    const originalReadResource = client.readResource.bind(client);
    client.readResource = async (uri: string) => {
      const dynamicResource = dynamicRegistry.findResource(uri);
      if (dynamicResource) {
        return dynamicResource.read();
      }
      return originalReadResource(uri);
    };
  }

  return client;
}

/**
 * Create a wrapped DirectMcpServer that overlays dynamic tools and resources.
 * Dynamic entries take precedence over base server entries with the same name/uri.
 */
export function createWrappedServer(base: DirectMcpServer, dynamicRegistry: DynamicRegistry): DirectMcpServer {
  return {
    get ready() {
      return base.ready;
    },

    async listTools(options?: DirectCallOptions): Promise<ListToolsResult> {
      const baseResult = await base.listTools(options);
      const dynamicTools = dynamicRegistry.getTools();

      if (dynamicTools.length === 0) return baseResult;

      const dynamicNames = new Set(dynamicTools.map((t) => t.name));
      const baseTools = ((baseResult as { tools?: ToolInfo[] }).tools ?? []).filter((t) => !dynamicNames.has(t.name));

      const mergedTools = [
        ...baseTools,
        ...dynamicTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as {
            type: 'object';
            properties?: Record<string, object>;
            required?: string[];
          },
        })),
      ];

      return { ...baseResult, tools: mergedTools } as ListToolsResult;
    },

    async callTool(name: string, args?: Record<string, unknown>, options?: DirectCallOptions) {
      const dynamicTool = dynamicRegistry.findTool(name);
      if (dynamicTool) {
        return dynamicTool.execute(args ?? {});
      }
      return base.callTool(name, args, options);
    },

    async listResources(options?: DirectCallOptions): Promise<ListResourcesResult> {
      const baseResult = await base.listResources(options);
      const dynamicResources = dynamicRegistry.getResources();

      if (dynamicResources.length === 0) return baseResult;

      const dynamicUris = new Set(dynamicResources.map((r) => r.uri));
      const baseResources = ((baseResult as { resources?: ResourceInfo[] }).resources ?? []).filter(
        (r) => !dynamicUris.has(r.uri),
      );

      const mergedResources = [
        ...baseResources,
        ...dynamicResources.map((r) => ({
          uri: r.uri,
          name: r.name ?? r.uri,
          description: r.description,
          mimeType: r.mimeType,
        })),
      ];

      return { ...baseResult, resources: mergedResources } as ListResourcesResult;
    },

    async listResourceTemplates(options?: DirectCallOptions) {
      return base.listResourceTemplates(options);
    },

    async readResource(uri: string, options?: DirectCallOptions) {
      const dynamicResource = dynamicRegistry.findResource(uri);
      if (dynamicResource) {
        return dynamicResource.read();
      }
      return base.readResource(uri, options);
    },

    async listPrompts(options?: DirectCallOptions) {
      return base.listPrompts(options);
    },

    async getPrompt(name: string, args?: Record<string, string>, options?: DirectCallOptions) {
      return base.getPrompt(name, args, options);
    },

    async listJobs(options?: DirectCallOptions) {
      return base.listJobs(options);
    },

    async executeJob(
      name: string,
      input?: Record<string, unknown>,
      options?: DirectCallOptions & { background?: boolean },
    ) {
      return base.executeJob(name, input, options);
    },

    async getJobStatus(runId: string, options?: DirectCallOptions) {
      return base.getJobStatus(runId, options);
    },

    async listWorkflows(options?: DirectCallOptions) {
      return base.listWorkflows(options);
    },

    async executeWorkflow(
      name: string,
      input?: Record<string, unknown>,
      options?: DirectCallOptions & { background?: boolean },
    ) {
      return base.executeWorkflow(name, input, options);
    },

    async getWorkflowStatus(runId: string, options?: DirectCallOptions) {
      return base.getWorkflowStatus(runId, options);
    },

    async connect(sessionIdOrOptions?: string | Record<string, unknown>) {
      const client = await base.connect(sessionIdOrOptions as Parameters<typeof base.connect>[0]);
      return patchClientWithDynamic(client, dynamicRegistry);
    },

    async dispose() {
      return base.dispose();
    },
  };
}
