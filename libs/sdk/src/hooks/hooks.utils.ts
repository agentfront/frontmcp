import { Token, getMetadata, isClass } from '@frontmcp/di';
import { FrontMcpFlowHookTokens, HookKind, HookMetadata, HookRecord } from '../common';
import { resolvePendingTC39HooksForClass } from '../common/decorators/hook.decorator';

export function collectHook(cls: Token): HookMetadata[] {
  return (getMetadata(FrontMcpFlowHookTokens.hooks, cls) ?? []) as HookMetadata[];
}

export function normalizeHooksFromCls(instance: any): HookRecord[] {
  const item = instance.constructor;
  if (isClass(item)) {
    // Get hooks from legacy decorators (Reflect.metadata)
    const legacyHooks = collectHook(item);

    // Get hooks from TC39 decorators (pending registry)
    // This is needed when running with tsx/esbuild which uses TC39 decorators
    const tc39Hooks = resolvePendingTC39HooksForClass(item);

    // Combine both sources
    const allHooks = [...legacyHooks, ...tc39Hooks];

    return allHooks.map((hook) => ({
      kind: HookKind.METHOD_TOKEN,
      provide: hook.static ? item[hook.method] : instance[hook.method],
      metadata: {
        ...hook,
        target: hook.static ? item : instance,
      },
    }));
  }
  // ignore hooks from non-class items
  return [];
}
