import { type Token } from '@frontmcp/di';

import { type HookBase, type ProviderRegistryInterface } from '../interfaces';
import { type FlowName, type HookMetadata, type HookOptions } from '../metadata';
import { type HookRecord } from '../records';
import { BaseEntry } from './base.entry';
import { type ScopeEntry } from './scope.entry';

export abstract class HookEntry<
  In = any,
  Name extends FlowName = FlowName,
  Stage = string,
  Ctx = any,
> extends BaseEntry<HookRecord, HookBase<In, Ctx>, HookMetadata<Name, Stage, Ctx>> {
  readonly scope: ScopeEntry;
  readonly providers: ProviderRegistryInterface;
  readonly options: HookOptions<Ctx>;

  protected constructor(
    scope: ScopeEntry,
    providers: ProviderRegistryInterface,
    record: HookRecord,
    token: Token,
    metadata: HookMetadata<Name, Stage, Ctx>,
  ) {
    super(record, token, metadata);
    this.scope = scope;
    this.providers = providers;
    this.options = {
      filter: metadata.filter,
      priority: metadata.priority,
    };
  }

  abstract run(input: In, ctx: Ctx): Promise<void>;
}
