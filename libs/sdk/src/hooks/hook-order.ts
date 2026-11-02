// file: libs/sdk/src/hooks/hook-order.ts

import type { HookMetadata } from '../common';
import { HookOrderCycleError } from '../errors';

/** The class that declares a hook: a static hook's target is the class, an instance hook's an instance or prototype. */
function declaringClassOf(hook: HookMetadata): unknown {
  const target: unknown = hook.target;
  if (typeof target === 'function') return target;
  return target && typeof target === 'object' ? target.constructor : undefined;
}

function classNameOf(hook: HookMetadata): string {
  const cls = declaringClassOf(hook);
  return typeof cls === 'function' ? cls.name : '';
}

/** The name the dev trace and the order messages give a hook's owner: its plugin's `name`, else its class's name. */
export function hookOwnerName(hook: HookMetadata): string {
  return hook.pluginName || classNameOf(hook);
}

function hookIdOf(hook: HookMetadata): string {
  return `${hookOwnerName(hook)}.${hook.method}`;
}

/** Whether `target`, from another hook's `before` or `after`, names `hook`. */
function namesHook(target: string, hook: HookMetadata): boolean {
  return [hook.pluginName, classNameOf(hook)].some(
    (name) => !!name && (target === name || target === `${name}.${hook.method}`),
  );
}

/** The same hook, or another instance of it (one plugin installed twice): a constraint never relates the two. */
function isSameHook(a: HookMetadata, b: HookMetadata): boolean {
  const cls = declaringClassOf(a);
  return a === b || (cls !== undefined && cls === declaringClassOf(b) && a.method === b.method);
}

function hasConstraints(hook: HookMetadata): boolean {
  return (hook.before?.length ?? 0) > 0 || (hook.after?.length ?? 0) > 0;
}

/** Every hook left waits for another hook left: follow them back to one that repeats, and name that cycle. */
function cycleError(hooks: HookMetadata[], waitsFor: Set<number>[], placed: Set<number>): HookOrderCycleError {
  const path: number[] = [];
  let current = hooks.findIndex((_hook, index) => !placed.has(index));
  while (!path.includes(current)) {
    path.push(current);
    current = [...waitsFor[current]].find((first) => !placed.has(first)) ?? current;
  }
  const cycle = path.slice(path.indexOf(current)).reverse();
  const start = cycle.indexOf(Math.min(...cycle));
  const inRunOrder = [...cycle.slice(start), ...cycle.slice(0, start)];
  const { flow, type, stage } = hooks[inRunOrder[0]];
  return new HookOrderCycleError(
    flow,
    type,
    String(stage),
    inRunOrder.map((index) => hookIdOf(hooks[index])),
  );
}

/**
 * `items`, already in priority order, reordered so each hook runs after the hooks its `after` names and before those
 * its `before` names: each place goes to the first item, in priority order, that no constraint holds back. An item
 * `canBeNamed` rejects (a flow's own step) is never a target. Throws a {@link HookOrderCycleError} when the
 * constraints contradict each other.
 */
export function orderByConstraints<T>(
  items: T[],
  hookOf: (item: T) => HookMetadata,
  canBeNamed: (item: T) => boolean = () => true,
): T[] {
  const hooks = items.map(hookOf);
  if (!hooks.some(hasConstraints)) return items;

  const waitsFor = hooks.map(() => new Set<number>());
  hooks.forEach((hook, index) => {
    hooks.forEach((other, otherIndex) => {
      if (isSameHook(hook, other) || !canBeNamed(items[otherIndex])) return;
      if (hook.before?.some((target) => namesHook(target, other))) waitsFor[otherIndex].add(index);
      if (hook.after?.some((target) => namesHook(target, other))) waitsFor[index].add(otherIndex);
    });
  });

  const placed = new Set<number>();
  const ordered: T[] = [];
  while (ordered.length < items.length) {
    const next = hooks.findIndex(
      (_hook, index) => !placed.has(index) && [...waitsFor[index]].every((first) => placed.has(first)),
    );
    if (next === -1) throw cycleError(hooks, waitsFor, placed);
    placed.add(next);
    ordered.push(items[next]);
  }
  return ordered;
}

function joinWithAnd(parts: string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join('');
}

/** What `hook` names that no other hook of its stage matches, as a warning, or `undefined` when everything matches. */
function unmatchedTargetsWarning(hook: HookMetadata, stageHooks: HookMetadata[]): string | undefined {
  const unmatched = (direction: 'before' | 'after') =>
    (hook[direction] ?? [])
      .filter((target) => !stageHooks.some((other) => !isSameHook(hook, other) && namesHook(target, other)))
      .map((target) => `'${target}' in ${direction}`);
  const listed = [...unmatched('before'), ...unmatched('after')];
  if (listed.length === 0) return undefined;
  const effect = listed.length === 1 ? 'it, so it changes' : 'them, so they change';
  return (
    `Hook ${hookIdOf(hook)} (${hook.type} '${String(hook.stage)}' of '${hook.flow}') names ${joinWithAnd(listed)}, ` +
    `but no hook on that stage matches ${effect} nothing. A target is a plugin name or the class that declares ` +
    'the hook, optionally followed by .method.'
  );
}

/**
 * The startup check of a scope's hooks: throws a {@link HookOrderCycleError} when the `before` / `after` options of
 * the hooks of one flow, stage and type form a cycle, and warns once per hook about the targets no hook there matches.
 */
export function checkHookOrder(hooks: readonly HookMetadata[], warn: (message: string) => void): void {
  const byStage = new Map<string, HookMetadata[]>();
  for (const hook of hooks) {
    const key = `${hook.flow} ${hook.type} ${String(hook.stage)}`;
    const stageHooks = byStage.get(key) ?? [];
    stageHooks.push(hook);
    byStage.set(key, stageHooks);
  }

  const warned = new Set<string>();
  for (const stageHooks of byStage.values()) {
    if (!stageHooks.some(hasConstraints)) continue;
    const byPriority = [...stageHooks].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    orderByConstraints(byPriority, (hook) => hook);
    for (const hook of stageHooks) {
      const warning = unmatchedTargetsWarning(hook, stageHooks);
      if (warning && !warned.has(warning)) {
        warned.add(warning);
        warn(warning);
      }
    }
  }
}
