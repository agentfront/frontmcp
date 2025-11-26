// file: libs/sdk/src/prompt/prompt.events.ts

import { PromptInstance } from './prompt.instance';

export type PromptChangeKind = 'added' | 'updated' | 'removed' | 'reset';

export type PromptChangeEvent = {
  kind: PromptChangeKind;
  scope: 'global' | 'session';
  sessionId?: string;
  relatedRequestId?: string;
  version: number;
  snapshot: readonly PromptInstance[];
};

type Listener = (e: PromptChangeEvent) => void;

export class PromptEmitter {
  private listeners = new Set<Listener>();

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit(e: PromptChangeEvent) {
    for (const l of [...this.listeners]) l(e);
  }
}
