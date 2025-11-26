import 'reflect-metadata';
import { FlowHooksOf } from './common';

export { FrontMcpInstance } from './front-mcp';
export * from './common';

export const ToolHook = FlowHooksOf('tools:call-tool');
export const ListToolsHook = FlowHooksOf('tools:list-tools');
export const HttpHook = FlowHooksOf('http:request');

// Resource hooks
export const ResourceHook = FlowHooksOf('resources:read-resource');
export const ListResourcesHook = FlowHooksOf('resources:list-resources');
export const ListResourceTemplatesHook = FlowHooksOf('resources:list-resource-templates');

// Prompt hooks
export const PromptHook = FlowHooksOf('prompts:get-prompt');
export const ListPromptsHook = FlowHooksOf('prompts:list-prompts');
