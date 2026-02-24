import { JobEntry } from '../common/entries/job.entry';

export type JobChangeKind = 'added' | 'updated' | 'removed' | 'reset';

export type JobChangeScope = 'global' | 'session';

export type JobChangeEvent = {
  kind: JobChangeKind;
  changeScope: JobChangeScope;
  sessionId?: string;
  version: number;
  snapshot: readonly JobEntry[];
};

type Listener = (e: JobChangeEvent) => void;

export class JobEmitter {
  private listeners = new Set<Listener>();

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit(e: JobChangeEvent) {
    for (const l of [...this.listeners]) l(e);
  }
}
