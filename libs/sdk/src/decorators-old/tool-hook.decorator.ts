import 'reflect-metadata';
import { MCP_TOOL_HOOKS } from '../constants';
import { ToolHookStage } from '../interfaces/tool-hook.interface';

export type ToolHookOptions = {
  priority?: number;
  /** Name of a filter method on same class (static or instance) */
  filter?: string;
};

/**
 * Decorator for declaring global Tool hooks on plugin classes.
 * Usage:
 *   @ToolHook('willReadCache')
 *   static willReadCache(ctx: ToolInvokeContext) { ... }
 */
export function ToolHook(stage: ToolHookStage, opts?: ToolHookOptions) {
  return function (target: any, propertyKey: string, _desc: PropertyDescriptor) {
    const isStatic = typeof target === 'function'; // static methods receive constructor as target
    const clazz = isStatic ? target : target.constructor;
    const arr: any[] = Reflect.getOwnMetadata(MCP_TOOL_HOOKS, clazz) ?? [];
    arr.push({
      stage,
      methodName: propertyKey,
      isStatic,
      priority: opts?.priority,
      filterKey: opts?.filter,
    });
    Reflect.defineMetadata(MCP_TOOL_HOOKS, arr, clazz);
  };
}
