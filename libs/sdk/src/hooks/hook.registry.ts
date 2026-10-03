// src/hooks/hook.registry.ts

import {
  type FlowCtxOf,
  type FlowInputOf,
  type FlowName,
  type FlowStagesOf,
  type HookEntry,
  type HookRecord,
  type HookType,
  type ScopeEntry,
  type Token,
} from '../common';
import { UnsupportedHookOwnerKindError } from '../errors';
import type ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, type RegistryBuildMapResult } from '../regsitry';
import { HookInstance } from './hook.instance';

/** Whether a hook runs for an entry of `ownerId` by its owner alone. */
function appliesToOwner(hook: HookEntry, ownerId: string): boolean {
  const hookOwner = hook.metadata.owner;
  // Include hooks with no owner (global hooks)
  if (!hookOwner) return true;

  // Handle known owner kinds explicitly
  switch (hookOwner.kind) {
    case 'scope':
    case 'plugin':
      // Scope/plugin-level hooks apply globally to all tools
      return true;
    case 'app':
    case 'agent':
      // App-level hooks only apply to matching owner; so do the hooks of a plugin installed on an
      // `@Agent`, which run in the agent's private scope for the agent's own tools
      return hookOwner.id === ownerId;
    default:
      // Fail fast on unknown owner kinds to catch misconfigurations
      throw new UnsupportedHookOwnerKindError(hookOwner.kind);
  }
}

/** The class that declared a hook: instances of one plugin class installed in several places share it. */
export function hookClassOf(hook: HookEntry): unknown {
  const { target } = hook.metadata;
  if (target === null || target === undefined) return undefined;
  if (hook.metadata.static || typeof target !== 'object') return target;
  return (target as object).constructor;
}

/** Two registrations of the same hook method of the same class (e.g. one plugin installed on two apps). */
function isSameHook(a: HookEntry, b: HookEntry): boolean {
  const cls = hookClassOf(a);
  return (
    cls !== undefined &&
    cls === hookClassOf(b) &&
    a.metadata.flow === b.metadata.flow &&
    a.metadata.method === b.metadata.method
  );
}

export default class HookRegistry extends RegistryAbstract<HookEntry, HookRecord, HookType[]> {
  scope: ScopeEntry;

  /** Historical records by class (kept if you still want access to raw records) */
  recordsByCls: Map<Token, HookRecord[]> = new Map();

  /** Fast O(1) indexes of *instances*, sorted by priority (desc) */
  private entriesByCls: Map<Token, HookEntry[]> = new Map();
  private hooksByFlow: Map<FlowName, HookEntry[]> = new Map();
  private hooksByFlowStage: Map<FlowName, Map<string, HookEntry[]>> = new Map();

  /** The registry whose flow hooks this one serves too (see {@link inheritFrom}). */
  private inherited?: { registry: HookRegistry; ownerId: string };

  constructor(providers: ProviderRegistry, list: HookType[]) {
    super('HookRegistry', providers, list);
    this.scope = this.providers.getActiveScope();
  }

  protected override buildMap(): RegistryBuildMapResult<HookRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, HookRecord>();
    const graph = new Map<Token, Set<Token>>();
    /**
     * No need to build graph for hooks,
     * hooks are injected by other tokens
     */
    return { tokens, defs, graph };
  }

  protected buildGraph() {
    /**
     * Currently, hooks cannot be depended on other tokens,
     * in the future we can add this feature, so hooks can depends on:
     * - other hooks completions
     * - specific injected providers
     */
  }

  async initialize() {
    /**
     * No need to initialize hooks,
     * hooks are injected by other tokens
     */
  }

  /** Priority helper (default 0) */
  private getPriority(entry: Pick<HookEntry, 'metadata'> | Pick<HookRecord, 'metadata'>): number {
    return entry.metadata?.priority ?? 0;
  }

  /** Binary insert by priority (desc). Stable for equal priorities. */
  private insertSorted(arr: HookEntry[], item: HookEntry) {
    const p = this.getPriority(item);
    let lo = 0;
    let hi = arr.length;
    // Insert AFTER existing equal-priority items to keep stable order.
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const mp = this.getPriority(arr[mid]);
      if (mp < p) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    arr.splice(lo, 0, item);
  }

  private upsert<K, V>(map: Map<K, V>, key: K, init: () => V): V {
    let v = map.get(key);
    if (!v) {
      v = init();
      map.set(key, v);
    }
    return v;
  }

  private indexByClass(cls: Token, entry: HookEntry) {
    const list = this.upsert(this.entriesByCls, cls, () => []);
    this.insertSorted(list, entry);
  }

  private indexByFlow(flow: FlowName, entry: HookEntry) {
    const list = this.upsert(this.hooksByFlow, flow, () => []);
    this.insertSorted(list, entry);
  }

  private indexByFlowStage(flow: FlowName, stage: string, entry: HookEntry) {
    const stages = this.upsert(this.hooksByFlowStage, flow, () => new Map<string, HookEntry[]>());
    const list = this.upsert(stages, String(stage), () => []);
    this.insertSorted(list, entry);
  }

  private initializeOne(embedded: boolean, token: Token) {
    const rec = this.defs.get(token)!;
    const providers = this.providers; // nearest token provider registry
    const instance = new HookInstance(this.scope, providers, rec, token);
    this.instances.set(token, instance);

    // Keep raw records grouped by class (if needed elsewhere)
    const cls = rec.metadata.target;
    if (cls) {
      const recs = this.recordsByCls.get(cls) ?? [];
      recs.push(rec);
      this.recordsByCls.set(cls, recs);
    }

    // Build fast indexes of *instances*, sorted by priority
    const entry = this.instances.get(token)!;
    const { flow, stage, target } = rec.metadata;

    if (embedded && target) {
      this.indexByClass(rec.metadata.static ? target : target.constructor, entry);
    } else if (!embedded) {
      this.indexByFlowStage(flow, String(stage), entry);
      this.indexByFlow(flow, entry);
    }

    return instance.ready;
  }

  registerHooks(embedded: boolean, ...records: HookRecord[]) {
    const readyArr: Promise<void>[] = [];
    for (const record of records) {
      this.defs.set(record.provide, record);
      this.tokens.add(record.provide);
      this.graph.set(record.provide, new Set());
      readyArr.push(this.initializeOne(embedded, record.provide));
    }
    return Promise.all(readyArr);
  }

  /**
   * Also serve the flow hooks `parent` runs for entries of `ownerId`, after this registry's own hooks
   * of the same priority. An `@Agent` with `execution.inheritPlugins` uses it: its tools run in the
   * agent's private scope, and then get the hooks of the plugins installed on the agent's app and on
   * the server too. A hook of a plugin class installed both here and there runs once, as installed here.
   */
  inheritFrom(parent: HookRegistry, ownerId: string): void {
    this.inherited = { registry: parent, ownerId };
  }

  /** Hooks for a given *flow*, filtered by owner if provided, sorted by priority (desc). */
  getFlowHooksForOwner<Name extends FlowName>(
    flow: Name,
    ownerId?: string,
  ): HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[] {
    const own = this.getOwnFlowHooksForOwner(flow, ownerId);
    if (!this.inherited) return own;

    const inherited = this.inherited.registry
      .getFlowHooksForOwner(flow, this.inherited.ownerId)
      .filter((hook) => !own.some((ownHook) => isSameHook(ownHook, hook)));
    if (inherited.length === 0) return own;

    const merged = [...own];
    for (const hook of inherited) this.insertSorted(merged as HookEntry[], hook as HookEntry);
    return merged;
  }

  /** This registry's own hooks for a given *flow*, filtered by owner if provided, sorted by priority (desc). */
  private getOwnFlowHooksForOwner<Name extends FlowName>(
    flow: Name,
    ownerId?: string,
  ): HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[] {
    const allHooks = this.getFlowHooks(flow);
    if (!ownerId) {
      return allHooks;
    }
    // Filter hooks to include:
    // 1. Global hooks (no owner)
    // 2. Scope/plugin-level hooks (apply globally to all tools)
    // 3. App-level (or agent-level) hooks that match the tool's owner
    // 4. Another app's hooks marked `appliesTo: 'uncovered-apps'`, when no instance of the same
    //    hook applies to this owner by 1-3 (so a gate an entry asks for is never skipped just
    //    because the plugin sits on a different app)
    const ownHooks = allHooks.filter((hook) => appliesToOwner(hook, ownerId));
    if (!allHooks.some((hook) => hook.metadata.appliesTo === 'uncovered-apps')) return ownHooks;
    const own = new Set(ownHooks);
    return allHooks.filter(
      (hook) =>
        own.has(hook) ||
        (hook.metadata.appliesTo === 'uncovered-apps' && !ownHooks.some((ownHook) => isSameHook(ownHook, hook))),
    );
  }

  /** Hooks defined on a given *class* (metadata.target), sorted by priority (desc). */
  getClsHooks(token: Token): HookEntry[] {
    return this.entriesByCls.get(token) ?? [];
  }

  /** All hooks (instances, unordered) */
  getHooks(): HookEntry[] {
    return [...this.instances.values()];
  }

  /** Hooks for a given *flow*, sorted by priority (desc). */
  getFlowHooks<Name extends FlowName>(
    flow: Name,
  ): HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[] {
    return (this.hooksByFlow.get(flow) ?? []) as HookEntry<
      FlowInputOf<Name>,
      Name,
      FlowStagesOf<Name>,
      FlowCtxOf<Name>
    >[];
  }

  /** Hooks for a specific *flow + stage*, sorted by priority (desc). */
  getFlowStageHooks<Name extends FlowName>(
    flow: Name,
    stage: FlowStagesOf<Name> | string,
  ): HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[] {
    const byStage = this.hooksByFlowStage.get(flow);
    return (byStage?.get(String(stage)) ?? []) as HookEntry<
      FlowInputOf<Name>,
      Name,
      FlowStagesOf<Name>,
      FlowCtxOf<Name>
    >[];
  }
}
