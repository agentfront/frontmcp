import {
  BaseEntry,
  FlowBase,
  FlowHookOptions,
  FlowMetadata,
  FlowRecord,
  ScopeEntry,
  Token,
} from "@frontmcp/sdk";

export abstract class HookEntry<Stage, Ctx> extends BaseEntry<HookRecord, HookBase, HookMetadata<never>> {
  readonly scope: ScopeEntry;
  readonly options: FlowHookOptions<Ctx>;

  protected constructor(scope: ScopeEntry, record: FlowRecord, token?: Token<FlowBase>, metadata?: FlowMetadata<never>) {
    super(record, token, metadata);
    const {path, method} = record.metadata.middleware ?? metadata?.middleware ?? {};

    this.scope = scope;
  }

}