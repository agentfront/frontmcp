import 'reflect-metadata';
import { MCP_AUTH_HOOKS } from '../constants';
import { AuthHookStage } from '../interfaces/auth-hook.interface';

export type AuthHookOptions = {
  priority?: number;
  /** Name of a filter method on same class (static or instance) */
  filter?: string;
};

/**
 * Decorator for declaring global Tool hooks on plugin classes.
 * Usage:
 *   @AuthHook('willExchangeToken')
 *   static willExchangeToken(ctx: AuthInvokeContext) { ... }
 */
export function AuthHook(stage: AuthHookStage, opts?: AuthHookOptions) {
  return function (target: any, propertyKey: string, _desc: PropertyDescriptor) {
    const isStatic = typeof target === 'function'; // static methods receive constructor as target
    const clazz = isStatic ? target : target.constructor;
    const arr: any[] = Reflect.getOwnMetadata(MCP_AUTH_HOOKS, clazz) ?? [];
    arr.push({
      stage,
      methodName: propertyKey,
      isStatic,
      priority: opts?.priority,
      filterKey: opts?.filter,
    });
    Reflect.defineMetadata(MCP_AUTH_HOOKS, arr, clazz);
  };
}
