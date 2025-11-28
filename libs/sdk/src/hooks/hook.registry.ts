// src/hooks/hook.registry.ts

import {
  FlowCtxOf,
  FlowInputOf,
  FlowName,
  FlowStagesOf,
  HookEntry,
  HookRecord,
  HookRegistryInterface,
  HookType,
  ScopeEntry,
  Token,
} from '../common';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import ProviderRegistry from '../provider/provider.registry';
import { HookInstance } from './hook.instance';

export default class HookRegistry
  extends RegistryAbstract<HookEntry, HookRecord, HookType[]>
  implements HookRegistryInterface
{
  scope: ScopeEntry;

  /** Historical records by class (kept if you still want access to raw records) */
  recordsByCls: Map<Token, HookRecord[]> = new Map();

  /** Fast O(1) indexes of *instances*, sorted by priority (desc) */
  private entriesByCls: Map<Token, HookEntry[]> = new Map();
  private hooksByFlow: Map<FlowName, HookEntry[]> = new Map();
  private hooksByFlowStage: Map<FlowName, Map<string, HookEntry[]>> = new Map();

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
      this.indexByClass(target.constructor ?? target, entry);
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

  /** Hooks for a given *flow*, filtered by owner if provided, sorted by priority (desc). */
  getFlowHooksForOwner<Name extends FlowName>(
    flow: Name,
    ownerId?: string,
  ): HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[] {
    const allHooks = this.getFlowHooks(flow);
    if (!ownerId) {
      return allHooks;
    }
    // Filter hooks to only include those that belong to the same owner or have no owner (global hooks)
    return allHooks.filter((hook) => {
      const hookOwner = hook.metadata.owner;
      return !hookOwner || hookOwner.id === ownerId;
    });
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
    const list = this.hooksByFlow.get(flow) ?? [];
    return list as HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[];
  }

  /** Hooks for a specific *flow + stage*, sorted by priority (desc). */
  getFlowStageHooks<Name extends FlowName>(
    flow: Name,
    stage: FlowStagesOf<Name> | string,
  ): HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[] {
    const byStage = this.hooksByFlowStage.get(flow);
    const list = byStage?.get(String(stage)) ?? [];
    return list as HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[];
  }
}
