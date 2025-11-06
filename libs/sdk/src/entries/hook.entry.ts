import {ScopeEntry} from "./scope.entry";
import {HookOptions, HookMetadata, FlowName} from "../metadata";
import {HookRecord} from "../records";
import {HookBase, ProviderRegistryInterface, Token} from "../interfaces";
import {BaseEntry} from "./base.entry";

export abstract class HookEntry<In = never, Stage = never, Ctx = never> extends BaseEntry<HookRecord, HookBase<In, Ctx>, HookMetadata<Stage>> {
  readonly scope: ScopeEntry;
  readonly providers: ProviderRegistryInterface;
  readonly options: HookOptions<Ctx>;

  protected constructor(scope: ScopeEntry, providers: ProviderRegistryInterface, record: HookRecord, token: Token, metadata: HookMetadata<Stage>) {
    super(record, token, metadata);
    this.scope = scope;
    this.providers = providers;
  }

  abstract run(input: In, ctx: Ctx): Promise<void>;
}