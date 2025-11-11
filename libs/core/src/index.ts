import 'reflect-metadata';
import {FlowHooksOf} from "@frontmcp/sdk";

export { FrontMcpInstance } from './front-mcp';


export const ToolHook = FlowHooksOf('tools:call-tool')
export const ListToolsHook = FlowHooksOf('tools:list-tools')
export const HttpHook = FlowHooksOf('http:request')