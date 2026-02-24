import { WorkflowEntry } from '../common/entries/workflow.entry';

export type WorkflowChangeKind = 'added' | 'updated' | 'removed' | 'reset';

export type WorkflowChangeScope = 'global' | 'session';

export type WorkflowChangeEvent = {
  kind: WorkflowChangeKind;
  changeScope: WorkflowChangeScope;
  sessionId?: string;
  version: number;
  snapshot: readonly WorkflowEntry[];
};

type Listener = (e: WorkflowChangeEvent) => void;

export class WorkflowEmitter {
  private listeners = new Set<Listener>();

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit(e: WorkflowChangeEvent) {
    for (const l of [...this.listeners]) l(e);
  }
}
