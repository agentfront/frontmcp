// file: libs/sdk/src/resource/resource.events.ts

import { ResourceInstance } from './resource.instance';

export type ResourceChangeKind = 'added' | 'updated' | 'removed' | 'reset';

/**
 * The scope of a change event.
 * - `global`: Change affects all sessions
 * - `session`: Change affects only a specific session
 */
export type ResourceChangeScope = 'global' | 'session';

export type ResourceChangeEvent = {
  kind: ResourceChangeKind;
  /** Whether the change affects all sessions or a specific session */
  changeScope: ResourceChangeScope;
  sessionId?: string;
  relatedRequestId?: string;
  version: number;
  snapshot: readonly ResourceInstance[];
};

type Listener = (e: ResourceChangeEvent) => void;

export class ResourceEmitter {
  private listeners = new Set<Listener>();

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit(e: ResourceChangeEvent) {
    for (const l of [...this.listeners]) l(e);
  }
}
