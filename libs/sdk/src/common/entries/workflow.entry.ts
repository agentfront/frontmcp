import { type WorkflowMetadata, type WorkflowStep } from '../metadata/workflow.metadata';
import { WorkflowKind, type WorkflowRecord } from '../records';
import { BaseEntry, type EntryOwnerRef } from './base.entry';

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
