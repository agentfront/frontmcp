/**
 * Types for indexed registries with fast lookups.
 */

import type { Token } from '../interfaces/base.interface.js';

/**
 * Entry lineage segment describing the owner path.
 */
export interface LineageSegment {
  /** Type of owner (e.g., 'app', 'plugin', 'scope') */
  type: string;
  /** Identifier for this segment */
  id: string;
  /** Optional name for display purposes */
  name?: string;
}

/**
 * Complete lineage path from root to entry.
 */
export type EntryLineage = LineageSegment[];

/**
 * Reference to an entry owner for adoption tracking.
 */
export interface EntryOwnerRef {
  /** Lineage path to the owner */
  lineage: EntryLineage;
  /** String key representation of the owner */
  ownerKey: string;
}

/**
 * Base indexed entry interface.
 * Extended by specific registries with additional fields.
 */
export interface IndexedEntry<T> {
  /** Token for this entry */
  token: Token;
  /** Instantiated entry */
  instance: T;
  /** Base name without qualification */
  baseName: string;
  /** Full lineage path */
  lineage: EntryLineage;
  /** String key for owner lookup */
  ownerKey: string;
  /** Fully qualified name including owner path */
  qualifiedName: string;
  /** Fully qualified ID for unique lookup */
  qualifiedId: string;
}

/**
 * Change event kinds.
 */
export type ChangeKind = 'reset' | 'add' | 'remove' | 'update';

/**
 * Change event scope.
 */
export type ChangeScope = 'local' | 'global';

/**
 * Base change event for indexed registries.
 */
export interface ChangeEvent<TIndexed> {
  /** Type of change */
  kind: ChangeKind;
  /** Scope of the change */
  changeScope: ChangeScope;
  /** Version counter after change */
  version: number;
  /** Current snapshot of all entries */
  snapshot: TIndexed[];
}

/**
 * Subscription options for change events.
 */
export interface SubscribeOptions<T> {
  /** Emit immediately with current state */
  immediate?: boolean;
  /** Filter function for entries */
  filter?: (instance: T) => boolean;
}

/**
 * Event emitter interface for change notifications.
 */
export interface RegistryEmitter<TEvent> {
  /** Emit an event to all subscribers */
  emit(event: TEvent): void;
  /** Subscribe to events, returns unsubscribe function */
  on(handler: (event: TEvent) => void): () => void;
}
