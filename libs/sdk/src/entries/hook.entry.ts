import {ScopeEntry} from "./scope.entry";
import {HookOptions, HookMetadata, FlowName} from "../metadata";
import {HookRecord} from "../records";
import {HookBase, ProviderRegistryInterface, Token} from "../interfaces";
import {BaseEntry} from "./base.entry";

export abstract class HookEntry<In = any, Name extends FlowName = FlowName, Stage = string, Ctx = any> extends BaseEntry<HookRecord, HookBase<In, Ctx>, HookMetadata<Name, Stage, Ctx>> {
  readonly scope: ScopeEntry;
  readonly providers: ProviderRegistryInterface;
  readonly options: HookOptions<Ctx>;

  protected constructor(scope: ScopeEntry, providers: ProviderRegistryInterface, record: HookRecord, token: Token, metadata: HookMetadata) {
    super(record, token, metadata as HookMetadata<Name, Stage, Ctx>);
    this.scope = scope;
    this.providers = providers;
  }

  abstract run(input: In, ctx: Ctx): Promise<void>;
}