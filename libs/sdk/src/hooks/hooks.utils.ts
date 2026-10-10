import { getMetadata, isClass, type Token } from '@frontmcp/di';

import {
  FrontMcpFlowHookTokens,
  HookKind,
  type EntryOwnerRef,
  type FlowName,
  type HookContextRun,
  type HookEntry,
  type HookMetadata,
  type HookRecord,
  type ProviderType,
} from '../common';
import { resolvePendingTC39HooksForClass } from '../common/decorators/hook.decorator';
import type ProviderRegistry from '../provider/provider.registry';
import { normalizeProvider } from '../provider/provider.utils';

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

/**
 * Hook records declared on the providers a registry defines: on its singletons, and on the class of
 * each CONTEXT-scoped provider, whose hooks run on the instance built for each flow run.
 *
 * @param only - When given, only the providers with these tokens.
 */
export function normalizeHooksFromProviders(providers: ProviderRegistry, only?: ReadonlySet<Token>): HookRecord[] {
  const records: HookRecord[] = [];
  for (const [token, instance] of providers.getAllSingletons()) {
    if (only && !only.has(token)) continue;
    if (typeof instance === 'object' && instance !== null) records.push(...normalizeHooksFromCls(instance));
  }
  for (const { token, cls } of providers.getContextScopedClasses()) {
    if (only && !only.has(token)) continue;
    for (const record of normalizeHooksFromCls(cls)) {
      // A static hook needs no instance; an instance hook runs on the run's own instance.
      records.push(
        record.metadata.static
          ? record
          : { ...record, metadata: { ...record.metadata, contextTarget: contextInstanceOf(providers, token) } },
      );
    }
  }
  return records;
}

/**
 * Hook records of the providers a server declares (`@FrontMcp({ providers })`), owned by its scope so
 * they run for every app's entries. The framework's own scope providers are left out.
 */
export function serverProviderHooks(
  providers: ProviderRegistry,
  declared: readonly ProviderType[] | undefined,
  owner: EntryOwnerRef,
): HookRecord[] {
  if (!declared?.length) return [];
  const tokens = new Set(declared.map((provider) => normalizeProvider(provider).provide));
  return normalizeHooksFromProviders(providers, tokens).map((hook) => ({
    ...hook,
    metadata: { ...hook.metadata, owner },
  }));
}

/** Builds (or reuses) a CONTEXT-scoped provider's instance for a flow run, as the run's entries resolve it. */
function contextInstanceOf(providers: ProviderRegistry, token: Token): NonNullable<HookMetadata['contextTarget']> {
  return async ({ sessionKey, contextProviders, contextSource }: HookContextRun) => {
    const views = await providers.buildViews(sessionKey, new Map(contextProviders), contextSource);
    const instance = views.context.get(token);
    return typeof instance === 'object' && instance !== null ? instance : undefined;
  };
}

/**
 * Give each hook declared on a CONTEXT-scoped provider the instance of that provider for this flow run;
 * other hooks are returned as they are.
 */
export async function bindContextHookTargets<T extends Pick<HookEntry, 'metadata'>>(
  hooks: readonly T[],
  run: HookContextRun,
): Promise<Array<T | Pick<HookEntry, 'metadata'>>> {
  if (!hooks.some((hook) => hook.metadata.contextTarget)) return [...hooks];
  const bound: Array<T | Pick<HookEntry, 'metadata'>> = [];
  for (const hook of hooks) {
    const { contextTarget } = hook.metadata;
    if (!contextTarget) {
      bound.push(hook);
      continue;
    }
    const target = await contextTarget(run);
    // `target` holds the object a hook method runs on (an instance, here), as `hooksBoundTo` stores it.
    if (target)
      bound.push({
        metadata: { ...hook.metadata, target: target as HookMetadata['target'], contextTarget: undefined },
      });
  }
  return bound;
}

/**
 * An entry class's instance hooks aimed at one call's instance, so each call runs them on its own
 * instance. Its `static` hooks are left out: they joined the run when it started (see
 * {@link staticHooksFor}).
 */
export function hooksBoundTo(entries: readonly HookEntry[], instance: object): Array<Pick<HookEntry, 'metadata'>> {
  const target = instance as HookMetadata['target'];
  return entries
    .filter((entry) => !entry.metadata.static)
    .map((entry) => ({ metadata: { ...entry.metadata, target } }));
}

/**
 * The hooks an entry class declares as `static` methods for `flow`. They need no instance, so they
 * join a run of that flow for the entry when it starts, and can hook the stages before the entry's
 * instance exists (#701).
 */
export function staticHooksFor(entries: readonly HookEntry[], flow: FlowName): HookEntry[] {
  return entries.filter((entry) => entry.metadata.static === true && entry.metadata.flow === flow);
}
