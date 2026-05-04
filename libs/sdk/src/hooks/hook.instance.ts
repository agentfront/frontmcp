import {
  HookEntry,
  type FlowCtxOf,
  type FlowInputOf,
  type FlowName,
  type FlowStagesOf,
  type FrontMcpLogger,
  type HookMetadata,
  type HookRecord,
  type ProviderRegistryInterface,
  type ScopeEntry,
  type Token,
} from '../common';
import { HookTargetNotDefinedError } from '../errors';

export class HookInstance<
  Name extends FlowName,
  In = FlowInputOf<Name>,
  Stage = FlowStagesOf<Name>,
  Ctx = FlowCtxOf<Name>,
> extends HookEntry<In, Name, Stage, Ctx> {
  logger: FrontMcpLogger;

  constructor(scope: ScopeEntry, providers: ProviderRegistryInterface, record: HookRecord, token: Token) {
    super(scope, providers, record, token, record.metadata as HookMetadata<Name, Stage, Ctx>);

    const { flow, method, stage } = this.metadata;
    this.logger = scope.logger.child(`${flow}:hook:${stage}(${method})`);
  }

  protected initialize(): Promise<void> {
    return Promise.resolve(undefined);
  }

  async run(input: In, ctx: Ctx): Promise<void> {
    const { target, method } = this.metadata;
    if (!target) {
      throw new HookTargetNotDefinedError(method);
    }
    this.logger.verbose('start');
    await target[method](input, ctx);
    this.logger.verbose('done');
  }
}
