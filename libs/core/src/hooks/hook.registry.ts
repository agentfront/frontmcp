import {
  FlowCtxOf,
  FlowInputOf,
  FlowName, FlowStagesOf, HookEntry,
  HookRecord, HookRegistryInterface,
  HookType,
  ScopeEntry,
  Token,
} from "@frontmcp/sdk";
import {RegistryAbstract, RegistryBuildMapResult} from "../regsitry";
import ProviderRegistry from "../provider/provider.registry";
import {HookInstance} from "./hook.instance";

export default class HookRegistry extends RegistryAbstract<HookInstance<FlowName>, HookRecord, HookType[]> implements HookRegistryInterface {
  scope: ScopeEntry;


  recordsByCls: Map<Token, HookRecord[]> = new Map();

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
    return {tokens, defs, graph};
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

  private initializeOne(token: Token) {
    const rec = this.defs.get(token)!;
    const providers = this.providers; // must be nearest token provider registry;
    const instance = new HookInstance(this.scope, providers, rec, token);
    this.instances.set(`${rec.metadata.flow}-${rec.metadata.stage}`, instance);

    // append hook to recordsByCls
    const cls = rec.metadata.target;
    let records = this.recordsByCls.get(cls);
    if (!records) {
      records = [];
    }
    records.push(rec);
    this.recordsByCls.set(cls, records);

    return instance.ready;
  }

  registerHooks(...records: HookRecord[]) {
    const readyArr: Promise<void>[] = []
    for (const record of records) {
      this.defs.set(record.provide, record);
      this.tokens.add(record.provide);
      this.graph.set(record.provide, new Set());
      readyArr.push(this.initializeOne(record.provide));
    }
    return Promise.all(readyArr);
  }

  getClsHooks(token: Token): HookEntry[] {
    const records = this.recordsByCls.get(token);
    if (!records) {
      return [];
    }
    return records.map(rec => this.instances.get(`${rec.metadata.flow}-${rec.metadata.stage}`)!);
  }

  getHooks(): HookEntry[] {
    return [...this.instances.values()];
  }

  getFlowHooks<Name extends FlowName>(flow: Name): HookEntry<FlowInputOf<Name>, FlowStagesOf<Name>, FlowCtxOf<Name>>[] {
    return this.getHooks().filter(h => h.metadata.flow === flow) as HookEntry<FlowInputOf<Name>, FlowStagesOf<Name>, FlowCtxOf<Name>>[];
  }
}