import {FlowInputOf, FlowName, FlowOutputOf, FlowRecord, FlowType, ScopeEntry, Token, Type} from "@frontmcp/sdk";
import {RegistryAbstract, RegistryBuildMapResult} from "../../regsitry";
import {FlowInstance} from "../flow.instance";
import ProviderRegistry from "../../provider/provider.registry";
import {normalizeFlow} from "../flow.utils";
import {tokenName} from "../../utils/token.utils";

export default class HookRegistry extends RegistryAbstract<HookInstance<FlowName>, HookRecord, HookType[]> {
  constructor(providers: ProviderRegistry, list: HookType[]) {
    super('HookRegistry', providers, list);
  }

  protected override buildMap(list: FlowType[]): RegistryBuildMapResult<FlowRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, FlowRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const raw of list) {
      const rec = normalizeHook(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }

    return {tokens, defs, graph};
  }


  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = rec.metadata.dependsOn ?? [];

      for (const d of deps) {
        if (d == ScopeEntry) {
          this.graph.get(token)!.add(ScopeEntry);
        } else {
          if (!this.providers.get(d)) {
            throw new Error(`Adapter ${tokenName(token)} depends on ${tokenName(d)}, which is not registered.`);
          }
          this.graph.get(token)!.add(d);
        }
      }
    }
  }

  /** Instantiate adapters, run fetch/transform, and populate registries. */
  protected async initialize(): Promise<void> {

    const readyArr: Promise<void>[] = [];
    for (const token of this.tokens) {
      const instance = this.initializeOne(token);
      readyArr.push(instance.ready);
    }
    await Promise.all(readyArr);
  }

  private initializeOne(token: Token) {
    const rec = this.defs.get(token)!;
    const deps = this.graph.get(token)!;

    const instance = new FlowInstance(this.providers.getActiveScope(), rec, deps, this.providers);
    this.instances.set(rec.metadata.name, instance);
    return instance;
  }


  async registryFlows(rawFlows: FlowType[]): Promise<void> {
    const readyArr: Promise<void>[] = [];
    for (const raw of rawFlows) {
      const rec = normalizeFlow(raw);
      const provide = rec.provide;
      this.tokens.add(provide);
      this.defs.set(provide, rec);
      this.graph.set(provide, new Set());
      readyArr.push(this.initializeOne(provide).ready);
    }
    await Promise.all(readyArr);
  }


  runFlow<Name extends FlowName>(name: Name, input: FlowInputOf<Name>, deps?: Map<Token, Type>): Promise<FlowOutputOf<Name> | undefined> {
    const flow = this.instances.get(name);
    if (!flow) {
      throw new Error(`Flow ${name} is not registered`);
    }
    return flow.run(input, deps ?? new Map());
  }
}