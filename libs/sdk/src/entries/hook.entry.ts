import {ScopeEntry} from "./scope.entry";
import {HookOptions, HookMetadata} from "../metadata";
import {HookRecord} from "../records";
import {HookBase, Token} from "../interfaces";
import {BaseEntry} from "./base.entry";

export abstract class HookEntry<In, Stage, Ctx> extends BaseEntry<HookRecord, HookBase<In, Ctx>, HookMetadata<Stage>> {
  readonly scope: ScopeEntry;
  readonly options: HookOptions<Ctx>;

  protected constructor(scope: ScopeEntry, record: HookRecord, token: Token, metadata: HookMetadata<Stage>) {
    super(record, token, metadata);
    this.scope = scope;
  }

}