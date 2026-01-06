/**
 * @file record-builders.ts
 * @description Functions that build standard records using factory-created context classes.
 *
 * These builders create ToolClassTokenRecord, ResourceClassTokenRecord, and PromptClassTokenRecord
 * with dynamically created context classes that forward execution to remote MCP servers.
 */

import type { Type } from '@frontmcp/di';
import type { Tool, Resource, ResourceTemplate, Prompt } from '@modelcontextprotocol/sdk/types.js';
import {
  ToolKind,
  ToolClassTokenRecord,
  ToolMetadata,
  ToolContext,
  ResourceKind,
  ResourceClassTokenRecord,
  ResourceMetadata,
  ResourceEntry,
  ResourceTemplateKind,
  ResourceTemplateClassTokenRecord,
  ResourceTemplateMetadata,
  PromptKind,
  PromptClassTokenRecord,
  PromptMetadata,
  PromptEntry,
} from '../../common';
import type { McpClientService } from '../mcp-client.service';
import {
  createRemoteToolContextClass,
  createRemoteResourceContextClass,
  createRemotePromptContextClass,
} from './context-factories';

/**
 * Build a ToolClassTokenRecord for a remote tool.
 *
 * Uses CLASS_TOKEN kind with a dynamically created context class.
 * The context class closes over mcpClient, remoteAppId, and the tool name.
 *
 * @param remoteTool - The tool definition from the remote MCP server
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @param namespace - Optional namespace prefix for the tool name
 */
export function buildRemoteToolRecord(
  remoteTool: Tool,
  mcpClient: McpClientService,
  remoteAppId: string,
  namespace?: string,
): ToolClassTokenRecord {
  const toolName = namespace ? `${namespace}:${remoteTool.name}` : remoteTool.name;

  const ContextClass = createRemoteToolContextClass(mcpClient, remoteAppId, remoteTool.name);

  const metadata: ToolMetadata = {
    name: toolName,
    id: toolName,
    description: remoteTool.description || `Remote tool: ${remoteTool.name}`,
    inputSchema: {},
    rawInputSchema: remoteTool.inputSchema as ToolMetadata['rawInputSchema'],
    outputSchema: 'json' as ToolMetadata['outputSchema'],
    annotations: {
      ...remoteTool.annotations,
      'frontmcp:remote': true,
      'frontmcp:remoteAppId': remoteAppId,
      'frontmcp:remoteTool': remoteTool.name,
    },
  };

  return {
    kind: ToolKind.CLASS_TOKEN,
    // Cast to Type<ToolContext> - the factory creates a class that extends ToolContext
    provide: ContextClass as Type<ToolContext>,
    metadata,
  };
}

/**
 * Build a ResourceClassTokenRecord for a remote resource.
 *
 * @param remoteResource - The resource definition from the remote MCP server
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @param namespace - Optional namespace prefix for the resource name
 */
export function buildRemoteResourceRecord(
  remoteResource: Resource,
  mcpClient: McpClientService,
  remoteAppId: string,
  namespace?: string,
): ResourceClassTokenRecord {
  const resourceName = namespace ? `${namespace}:${remoteResource.name}` : remoteResource.name;

  const ContextClass = createRemoteResourceContextClass(mcpClient, remoteAppId);

  const metadata: ResourceMetadata = {
    name: resourceName,
    description: remoteResource.description || `Remote resource: ${remoteResource.name}`,
    uri: remoteResource.uri,
    mimeType: remoteResource.mimeType,
  };

  return {
    kind: ResourceKind.CLASS_TOKEN,
    // Cast to Type<ResourceEntry> - the factory creates a context class that's instantiated by ResourceInstance
    provide: ContextClass as unknown as Type<ResourceEntry>,
    metadata,
  };
}

/**
 * Build a ResourceTemplateClassTokenRecord for a remote resource template.
 *
 * @param remoteTemplate - The resource template definition from the remote MCP server
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @param namespace - Optional namespace prefix for the resource name
 */
export function buildRemoteResourceTemplateRecord(
  remoteTemplate: ResourceTemplate,
  mcpClient: McpClientService,
  remoteAppId: string,
  namespace?: string,
): ResourceTemplateClassTokenRecord {
  const resourceName = namespace ? `${namespace}:${remoteTemplate.name}` : remoteTemplate.name;

  const ContextClass = createRemoteResourceContextClass(mcpClient, remoteAppId);

  const metadata: ResourceTemplateMetadata = {
    name: resourceName,
    description: remoteTemplate.description || `Remote resource template: ${remoteTemplate.name}`,
    uriTemplate: remoteTemplate.uriTemplate,
    mimeType: remoteTemplate.mimeType,
  };

  return {
    kind: ResourceTemplateKind.CLASS_TOKEN,
    // Cast to Type<ResourceEntry> - the factory creates a context class that's instantiated by ResourceInstance
    provide: ContextClass as unknown as Type<ResourceEntry>,
    metadata,
  };
}

/**
 * Build a PromptClassTokenRecord for a remote prompt.
 *
 * @param remotePrompt - The prompt definition from the remote MCP server
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @param namespace - Optional namespace prefix for the prompt name
 */
export function buildRemotePromptRecord(
  remotePrompt: Prompt,
  mcpClient: McpClientService,
  remoteAppId: string,
  namespace?: string,
): PromptClassTokenRecord {
  const promptName = namespace ? `${namespace}:${remotePrompt.name}` : remotePrompt.name;

  const ContextClass = createRemotePromptContextClass(mcpClient, remoteAppId, remotePrompt.name);

  const metadata: PromptMetadata = {
    name: promptName,
    description: remotePrompt.description || `Remote prompt: ${remotePrompt.name}`,
    arguments:
      remotePrompt.arguments?.map((arg) => ({
        name: arg.name,
        description: arg.description,
        required: arg.required,
      })) || [],
  };

  return {
    kind: PromptKind.CLASS_TOKEN,
    // Cast to Type<PromptEntry> - the factory creates a context class that's instantiated by PromptInstance
    provide: ContextClass as unknown as Type<PromptEntry>,
    metadata,
  };
}
