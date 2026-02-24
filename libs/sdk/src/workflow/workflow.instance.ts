import { EntryOwnerRef } from '../common';
import { WorkflowEntry } from '../common/entries/workflow.entry';
import { WorkflowMetadata } from '../common/metadata/workflow.metadata';
import { WorkflowRecord } from '../common/records/workflow.record';
import ProviderRegistry from '../provider/provider.registry';
import { Scope } from '../scope';
import HookRegistry from '../hooks/hook.registry';

/**
 * Concrete implementation of a workflow that can be executed.
 */
export class WorkflowInstance extends WorkflowEntry {
  private readonly _providers: ProviderRegistry;
  readonly scope: Scope;
  readonly hooks: HookRegistry;

  constructor(record: WorkflowRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this._providers = providers;
    this.name = record.metadata.id || record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this._providers.getActiveScope();
    this.hooks = this.scope.providers.getHooksRegistry();

    this.ready = this.initialize();
  }

  protected async initialize() {
    // Workflows don't have class-based hooks in the current design
    return Promise.resolve();
  }

  getMetadata(): WorkflowMetadata {
    return this.record.metadata;
  }

  get providers(): ProviderRegistry {
    return this._providers;
  }
}
