import {FrontMcpFlowHookTokens, HookKind, HookMetadata, HookRecord, Token} from "../common";
import {getMetadata} from "../utils/metadata.utils";
import {isClass} from "../utils/token.utils";


export function collectHook(cls: Token): HookMetadata[] {
  return (getMetadata(FrontMcpFlowHookTokens.hooks, cls) ?? []) as HookMetadata[];
}


export function normalizeHooksFromCls(instance: any): HookRecord[] {
  const item = instance.constructor;
  if (isClass(item)) {
    const hooks = collectHook(item);
    return hooks.map(hook => ({
      kind: HookKind.METHOD_TOKEN,
      provide: hook.static ? item[hook.method] : instance[hook.method],
      metadata: {
        ...hook,
        target: hook.static ? item : instance,
      }
    }))
  }
  // ignore hooks from non-class items
  return []
}