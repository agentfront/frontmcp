import 'reflect-metadata';
import { FlowHooksOf } from './common';

export { FrontMcpInstance } from './front-mcp';
export * from './common';

export const ToolHook = FlowHooksOf('tools:call-tool');
export const ListToolsHook = FlowHooksOf('tools:list-tools');
export const HttpHook = FlowHooksOf('http:request');
