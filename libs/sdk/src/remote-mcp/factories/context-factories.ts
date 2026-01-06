/**
 * @file context-factories.ts
 * @description Factory functions that create context classes with closed-over dependencies.
 *
 * These factories enable using standard ToolInstance, ResourceInstance, and PromptInstance
 * with remote MCP servers by creating dynamic context classes that capture the McpClientService
 * and remote identifiers via closure.
 */

import { Type } from '@frontmcp/di';
import { ToolContext, ToolInputType, ToolOutputType, ResourceContext, PromptContext } from '../../common';
import type { McpClientService } from '../mcp-client.service';
import type { CallToolResult, ReadResourceResult, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Creates a remote tool context class with closed-over dependencies.
 *
 * The returned class can be used with standard ToolInstance. The closure captures
 * mcpClient, remoteAppId, and remoteToolName, so the class constructor only needs
 * standard ToolCtorArgs.
 *
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @param remoteToolName - The name of the tool on the remote server
 * @returns A ToolContext class that executes tools on the remote server
 */
export function createRemoteToolContextClass(
  mcpClient: McpClientService,
  remoteAppId: string,
  remoteToolName: string,
): Type<ToolContext<ToolInputType, ToolOutputType, unknown, CallToolResult>> {
  return class DynamicRemoteToolContext extends ToolContext<ToolInputType, ToolOutputType, unknown, CallToolResult> {
    async execute(input: unknown): Promise<CallToolResult> {
      const authContext = { authInfo: this.getAuthInfo() };
      return mcpClient.callTool(remoteAppId, remoteToolName, input as Record<string, unknown>, authContext);
    }
  } as Type<ToolContext<ToolInputType, ToolOutputType, unknown, CallToolResult>>;
}

/**
 * Creates a remote resource context class with closed-over dependencies.
 *
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @returns A ResourceContext class that reads resources from the remote server
 */
export function createRemoteResourceContextClass<Params extends Record<string, string> = Record<string, string>>(
  mcpClient: McpClientService,
  remoteAppId: string,
): Type<ResourceContext<Params, ReadResourceResult>> {
  return class DynamicRemoteResourceContext extends ResourceContext<Params, ReadResourceResult> {
    async execute(uri: string, _params: Params): Promise<ReadResourceResult> {
      const authContext = { authInfo: this.getAuthInfo() };
      return mcpClient.readResource(remoteAppId, uri, authContext);
    }
  } as Type<ResourceContext<Params, ReadResourceResult>>;
}

/**
 * Creates a remote prompt context class with closed-over dependencies.
 *
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @param remotePromptName - The name of the prompt on the remote server
 * @returns A PromptContext class that gets prompts from the remote server
 */
export function createRemotePromptContextClass(
  mcpClient: McpClientService,
  remoteAppId: string,
  remotePromptName: string,
): Type<PromptContext> {
  return class DynamicRemotePromptContext extends PromptContext {
    async execute(args: Record<string, string>): Promise<GetPromptResult> {
      const authContext = { authInfo: this.authInfo };
      return mcpClient.getPrompt(remoteAppId, remotePromptName, args, authContext);
    }
  } as Type<PromptContext>;
}
