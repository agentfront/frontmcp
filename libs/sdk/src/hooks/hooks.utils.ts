import { getMetadata, isClass, type Token } from '@frontmcp/di';

import { FrontMcpFlowHookTokens, HookKind, type HookEntry, type HookMetadata, type HookRecord } from '../common';
import { resolvePendingTC39HooksForClass } from '../common/decorators/hook.decorator';

export function collectHook(cls: Token): HookMetadata[] {
  return (getMetadata(FrontMcpFlowHookTokens.hooks, cls) ?? []) as HookMetadata[];
}

/**
 * Hook records declared on a class, from either the class itself (an entry class such as a
 * `@Tool`, whose methods run on each call's instance) or an instance of it (a plugin or provider).
 */
export function normalizeHooksFromCls(source: any): HookRecord[] {
  const cls = isClass(source) ? source : source?.constructor;
  if (!isClass(cls)) {
    return [];
  }
  const methodHolder = cls === source ? cls.prototype : source;

  // Legacy decorators store hooks as metadata; TC39 decorators (tsx/esbuild) keep them pending.
  const allHooks = [...collectHook(cls), ...resolvePendingTC39HooksForClass(cls)];

  return allHooks.map((hook) => ({
    kind: HookKind.METHOD_TOKEN,
    provide: hook.static ? cls[hook.method] : methodHolder[hook.method],
    metadata: {
      ...hook,
      target: hook.static ? cls : methodHolder,
    },
  }));
}

/** Hook records declared on the instances a provider registry holds. */
export function normalizeHooksFromProviders(providers: {
  getAllSingletons(): ReadonlyMap<Token, unknown>;
}): HookRecord[] {
  return [...providers.getAllSingletons().values()]
    .filter((instance) => typeof instance === 'object' && instance !== null)
    .flatMap((instance) => normalizeHooksFromCls(instance));
}

/** An entry class's hooks aimed at one call's instance, so each call runs them on its own instance. */
export function hooksBoundTo(entries: readonly HookEntry[], instance: object): Array<Pick<HookEntry, 'metadata'>> {
  const target = instance as HookMetadata['target'];
  return entries.map((entry) => ({
    metadata: entry.metadata.static ? entry.metadata : { ...entry.metadata, target },
  }));
}
