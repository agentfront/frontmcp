// file: libs/sdk/src/skill/skill.events.ts

import { SkillEntry } from '../common';
import type { SkillValidationReport } from './errors/skill-validation.error';
import type { SyncResult } from './sync/sync-state.interface';

/**
 * Kind of skill change event.
 */
export type SkillChangeKind = 'added' | 'updated' | 'removed' | 'reset' | 'validated' | 'synced';

/**
 * Scope of a skill change event.
 * - `global`: Change affects all sessions
 * - `session`: Change affects only a specific session
 */
export type SkillChangeScope = 'global' | 'session';

/**
 * Event emitted when skills change in the registry.
 */
export type SkillChangeEvent = {
  /**
   * Kind of change that occurred.
   */
  kind: SkillChangeKind;

  /**
   * Whether the change affects all sessions or a specific session.
   */
  changeScope: SkillChangeScope;

  /**
   * Session ID if changeScope is 'session'.
   */
  sessionId?: string;

  /**
   * Related request ID if available.
   */
  relatedRequestId?: string;

  /**
   * Version number of the registry after this change.
   */
  version: number;

  /**
   * Current snapshot of all skills after the change.
   */
  snapshot: readonly SkillEntry[];

  /**
   * Validation report when kind is 'validated'.
   * Contains validation results for all skills in the registry.
   */
  validationReport?: SkillValidationReport;

  /**
   * Sync result when kind is 'synced'.
   * Contains information about skills added/updated/removed from external storage.
   */
  syncResult?: SyncResult;
};

/**
 * Listener function type for skill change events.
 */
type SkillChangeListener = (event: SkillChangeEvent) => void;

/**
 * Event emitter for skill changes.
 *
 * Used by SkillRegistry to notify subscribers of skill additions,
 * removals, updates, and resets.
 */
export class SkillEmitter {
  private listeners = new Set<SkillChangeListener>();

  /**
   * Register a listener for skill change events.
   *
   * @param listener - The listener function
   * @returns Unsubscribe function
   */
  on(listener: SkillChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit a skill change event to all listeners.
   *
   * @param event - The change event
   */
  emit(event: SkillChangeEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  /**
   * Get the number of active listeners.
   */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Remove all listeners.
   */
  clear(): void {
    this.listeners.clear();
  }
}
