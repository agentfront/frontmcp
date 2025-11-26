import { ToolInstance } from './tool.instance';

export type ToolChangeKind = 'added' | 'updated' | 'removed' | 'reset';

/**
 * The scope of a change event.
 * - `global`: Change affects all sessions
 * - `session`: Change affects only a specific session
 */
export type ToolChangeScope = 'global' | 'session';

export type ToolChangeEvent = {
  kind: ToolChangeKind;
  /** Whether the change affects all sessions or a specific session */
  changeScope: ToolChangeScope;
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
