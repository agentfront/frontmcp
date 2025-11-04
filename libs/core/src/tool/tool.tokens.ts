// libs/core/src/tool/tool.tokens.ts
import { Token } from '@frontmcp/sdk';
import { FilterMethodMeta, HookMethodMeta } from './tool.decorators';
import { ToolRegistryContract } from './tool.types';

export const TOOL_REGISTRY: Token<ToolRegistryContract> = Symbol('TOOL_REGISTRY');

export const HOOKS_META: Token<HookMethodMeta[]> = Symbol('mcp.tool.hooks'); // per-stage method list
export const CAN_ACTIVATE_META: Token<FilterMethodMeta[]> = Symbol('mcp.tool.canActivate');
export const HOOK_FILTERS_META: Token<FilterMethodMeta[]> = Symbol('mcp.tool.hookFilters');
