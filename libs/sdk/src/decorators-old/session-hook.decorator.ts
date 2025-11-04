import 'reflect-metadata';
import { MCP_SESSION_HOOKS } from '../constants';
import { SessionHookStage } from '../interfaces/session-hook.interface';

export type SessionHookOptions = {
  priority?: number;
  /** Name of a filter method on same class (static or instance) */
  filter?: string;
};

/**
 * Decorator for declaring global Tool hooks on plugin classes.
 * Usage:
 *   @SessionHook('willCreateSession')
 *   static willCreateSession(ctx: SessionInvokeContext) { ... }
 */
export function SessionHook(stage: SessionHookStage, opts?: SessionHookOptions) {
  return function (target: any, propertyKey: string, _desc: PropertyDescriptor) {
    const isStatic = typeof target === 'function'; // static methods receive constructor as target
    const clazz = isStatic ? target : target.constructor;
    const arr: any[] = Reflect.getOwnMetadata(MCP_SESSION_HOOKS, clazz) ?? [];
    arr.push({
      stage,
      methodName: propertyKey,
      isStatic,
      priority: opts?.priority,
      filterKey: opts?.filter,
    });
    Reflect.defineMetadata(MCP_SESSION_HOOKS, arr, clazz);
  };
}
