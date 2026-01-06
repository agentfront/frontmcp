/**
 * @file instance-factories.ts
 * @description Factory functions that create standard instances for remote MCP entities.
 *
 * These factories use the record-builders to create records with dynamically generated
 * context classes, then instantiate standard ToolInstance, ResourceInstance, and PromptInstance.
 * This allows remote entities to use the same hook lifecycle and registry infrastructure
 * as local entities.
 */

import type { Tool, Resource, ResourceTemplate, Prompt } from '@modelcontextprotocol/sdk/types.js';
import type { EntryOwnerRef } from '../../common';
import type ProviderRegistry from '../../provider/provider.registry';
import type { McpClientService } from '../mcp-client.service';
import { ToolInstance } from '../../tool/tool.instance';
import { ResourceInstance } from '../../resource/resource.instance';
import { PromptInstance } from '../../prompt/prompt.instance';
import {
  buildRemoteToolRecord,
  buildRemoteResourceRecord,
  buildRemoteResourceTemplateRecord,
  buildRemotePromptRecord,
} from './record-builders';

/**
 * Create a standard ToolInstance for a remote tool.
 *
 * Uses factory-created context class via buildRemoteToolRecord, which returns
 * a ToolClassTokenRecord. The resulting ToolInstance participates fully in the
 * hook lifecycle.
 *
 * @param remoteTool - The tool definition from the remote MCP server
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @param providers - The provider registry for DI and scope access
 * @param owner - The entry owner reference (app owner)
 * @param namespace - Optional namespace prefix for the tool name
 * @returns A standard ToolInstance that executes on the remote server
 */
export function createRemoteToolInstance(
  remoteTool: Tool,
  mcpClient: McpClientService,
  remoteAppId: string,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
  namespace?: string,
): ToolInstance {
  const record = buildRemoteToolRecord(remoteTool, mcpClient, remoteAppId, namespace);
  return new ToolInstance(record, providers, owner);
}

/**
 * Create a standard ResourceInstance for a remote resource.
 *
 * Uses factory-created context class via buildRemoteResourceRecord, which returns
 * a ResourceClassTokenRecord. The resulting ResourceInstance participates fully in the
 * hook lifecycle.
 *
 * @param remoteResource - The resource definition from the remote MCP server
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @param providers - The provider registry for DI and scope access
 * @param owner - The entry owner reference (app owner)
 * @param namespace - Optional namespace prefix for the resource name
 * @returns A standard ResourceInstance that reads from the remote server
 */
export function createRemoteResourceInstance(
  remoteResource: Resource,
  mcpClient: McpClientService,
  remoteAppId: string,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
  namespace?: string,
): ResourceInstance {
  const record = buildRemoteResourceRecord(remoteResource, mcpClient, remoteAppId, namespace);
  return new ResourceInstance(record, providers, owner);
}

/**
 * Create a standard ResourceInstance for a remote resource template.
 *
 * Uses factory-created context class via buildRemoteResourceTemplateRecord, which returns
 * a ResourceTemplateClassTokenRecord. The resulting ResourceInstance participates fully in the
 * hook lifecycle.
 *
 * @param remoteTemplate - The resource template definition from the remote MCP server
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @param providers - The provider registry for DI and scope access
 * @param owner - The entry owner reference (app owner)
 * @param namespace - Optional namespace prefix for the resource template name
 * @returns A standard ResourceInstance that reads from the remote server
 */
export function createRemoteResourceTemplateInstance(
  remoteTemplate: ResourceTemplate,
  mcpClient: McpClientService,
  remoteAppId: string,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
  namespace?: string,
): ResourceInstance {
  const record = buildRemoteResourceTemplateRecord(remoteTemplate, mcpClient, remoteAppId, namespace);
  return new ResourceInstance(record, providers, owner);
}

/**
 * Create a standard PromptInstance for a remote prompt.
 *
 * Uses factory-created context class via buildRemotePromptRecord, which returns
 * a PromptClassTokenRecord. The resulting PromptInstance participates fully in the
 * hook lifecycle.
 *
 * @param remotePrompt - The prompt definition from the remote MCP server
 * @param mcpClient - The MCP client service for remote communication
 * @param remoteAppId - The ID of the remote app
 * @param providers - The provider registry for DI and scope access
 * @param owner - The entry owner reference (app owner)
 * @param namespace - Optional namespace prefix for the prompt name
 * @returns A standard PromptInstance that gets prompts from the remote server
 */
export function createRemotePromptInstance(
  remotePrompt: Prompt,
  mcpClient: McpClientService,
  remoteAppId: string,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
  namespace?: string,
): PromptInstance {
  const record = buildRemotePromptRecord(remotePrompt, mcpClient, remoteAppId, namespace);
  return new PromptInstance(record, providers, owner);
}
