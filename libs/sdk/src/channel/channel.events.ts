// file: libs/sdk/src/channel/channel.events.ts

import type { ChannelEntry } from '../common';

export type ChannelChangeKind = 'added' | 'updated' | 'removed' | 'reset';

/**
 * The scope of a change event.
 * - `global`: Change affects all sessions
 * - `session`: Change affects only a specific session
 */
export type ChannelChangeScope = 'global' | 'session';

export type ChannelChangeEvent = {
  kind: ChannelChangeKind;
  /** Whether the change affects all sessions or a specific session */
  changeScope: ChannelChangeScope;
  sessionId?: string;
  relatedRequestId?: string;
  version: number;
  snapshot: readonly ChannelEntry[];
};

type Listener = (e: ChannelChangeEvent) => void;

export class ChannelEmitter {
  private listeners = new Set<Listener>();

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit(e: ChannelChangeEvent) {
    for (const l of [...this.listeners]) l(e);
  }
}
