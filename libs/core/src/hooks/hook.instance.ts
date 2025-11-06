import {
  FlowCtxOf,
  FlowInputOf,
  FlowName,
  FlowStagesOf,
  HookEntry, HookRecord,
  ProviderRegistryInterface,
  ScopeEntry, Token
} from "@frontmcp/sdk";


export class HookInstance<Name extends FlowName, In = FlowInputOf<Name>, Stage = FlowStagesOf<Name>, Ctx = FlowCtxOf<Name>>
  extends HookEntry<In, Stage, Ctx> {

  constructor(scope: ScopeEntry, providers: ProviderRegistryInterface, record: HookRecord, token: Token) {
    super(scope, providers, record, token, record.metadata);
  }

  protected initialize(): Promise<void> {
    return Promise.resolve(undefined);
  }

  async run(input: In, ctx: Ctx): Promise<void> {

  }
}