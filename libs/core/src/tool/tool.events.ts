import { ToolInstance } from './tool.instance';

export type ToolChangeKind = 'added' | 'updated' | 'removed' | 'reset';
export type ToolChangeEvent = {
  kind: ToolChangeKind;
  scope: 'global' | 'session';
  sessionId?: string;
  relatedRequestId?: string;
  version: number;
  snapshot: readonly ToolInstance[];
};

type Listener = (e: ToolChangeEvent) => void;

export class ToolEmitter {
  private listeners = new Set<Listener>();

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit(e: ToolChangeEvent) {
    for (const l of [...this.listeners]) l(e);
  }
}
