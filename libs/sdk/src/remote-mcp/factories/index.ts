/**
 * @file remote/index.ts
 * @description Barrel exports for the remote app instances module.
 *
 * This module provides factory functions for creating standard instances
 * (ToolInstance, ResourceInstance, PromptInstance) that forward execution
 * to remote MCP servers via the McpClientService.
 */

// Context factories - create dynamic context classes with closed-over dependencies
export {
  createRemoteToolContextClass,
  createRemoteResourceContextClass,
  createRemotePromptContextClass,
} from './context-factories';

// Record builders - build standard records with factory-created context classes
export {
  buildRemoteToolRecord,
  buildRemoteResourceRecord,
  buildRemoteResourceTemplateRecord,
  buildRemotePromptRecord,
} from './record-builders';

// Instance factories - create standard instances for remote entities
export {
  createRemoteToolInstance,
  createRemoteResourceInstance,
  createRemoteResourceTemplateInstance,
  createRemotePromptInstance,
} from './instance-factories';
