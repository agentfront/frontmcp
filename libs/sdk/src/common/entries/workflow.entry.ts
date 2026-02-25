import { BaseEntry, EntryOwnerRef } from './base.entry';
import { WorkflowRecord, WorkflowKind } from '../records';
import { WorkflowMetadata, WorkflowStep } from '../metadata/workflow.metadata';

export abstract class WorkflowEntry extends BaseEntry<WorkflowRecord, unknown, WorkflowMetadata> {
  owner: EntryOwnerRef;
  name: string;
  fullName: string;

  isDynamic(): boolean {
    return this.record.kind === WorkflowKind.DYNAMIC;
  }

  isHidden(): boolean {
    return this.metadata.hideFromDiscovery === true;
  }

  getTags(): string[] {
    return this.metadata.tags ?? [];
  }

  getLabels(): Record<string, string> {
    return this.metadata.labels ?? {};
  }

  getSteps(): WorkflowStep[] {
    return this.metadata.steps;
  }

  getTrigger(): string {
    return this.metadata.trigger ?? 'manual';
  }
}
