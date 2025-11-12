import {
  FlowCtxOf,
  FlowInputOf,
  FlowName,
  FlowStagesOf, FrontMcpLogger,
  HookEntry, HookMetadata, HookRecord,
  ProviderRegistryInterface,
  ScopeEntry, Token
} from "../common";


export class HookInstance<Name extends FlowName, In = FlowInputOf<Name>, Stage = FlowStagesOf<Name>, Ctx = FlowCtxOf<Name>>
  extends HookEntry<In, Name, Stage, Ctx> {
  logger: FrontMcpLogger;

  constructor(scope: ScopeEntry, providers: ProviderRegistryInterface, record: HookRecord, token: Token) {
    super(scope, providers, record, token, record.metadata as HookMetadata<Name, Stage, Ctx>);

    const {flow, method, stage} = this.metadata
    this.logger = scope.logger.child(`${flow}:hook:${stage}(${method})`)
  }

  protected initialize(): Promise<void> {
    return Promise.resolve(undefined);
  }

  async run(input: In, ctx: Ctx): Promise<void> {
    const {target, method} = this.metadata;
    this.logger.verbose("start")
    await target[method](input, ctx);
    this.logger.verbose("start")
  }
}