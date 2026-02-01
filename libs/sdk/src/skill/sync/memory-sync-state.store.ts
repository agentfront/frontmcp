// file: libs/sdk/src/skill/sync/memory-sync-state.store.ts

import type { SkillSyncState, SkillSyncStateStore } from './sync-state.interface';

/**
 * In-memory implementation of SkillSyncStateStore.
 *
 * Suitable for:
 * - Development and testing
 * - Single-instance deployments where persistence isn't required
 * - Stateless sync operations (re-sync on each startup)
 *
 * Note: State is lost when the process exits.
 *
 * @example
 * ```typescript
 * const store = new MemorySyncStateStore();
 *
 * // Save state
 * await store.save({ version: 1, lastFullSync: Date.now(), entries: new Map() });
 *
 * // Load state
 * const state = await store.load();
 * ```
 */
export class MemorySyncStateStore implements SkillSyncStateStore {
  private state: SkillSyncState | null = null;

  /**
   * Load the sync state from memory.
   * @returns The stored state or null if not set
   */
  async load(): Promise<SkillSyncState | null> {
    // Return a deep copy to prevent external mutations
    if (!this.state) {
      return null;
    }

    return {
      version: this.state.version,
      lastFullSync: this.state.lastFullSync,
      entries: new Map(this.state.entries),
    };
  }

  /**
   * Save the sync state to memory.
   * @param state - The state to store
   */
  async save(state: SkillSyncState): Promise<void> {
    // Store a deep copy to prevent external mutations
    this.state = {
      version: state.version,
      lastFullSync: state.lastFullSync,
      entries: new Map(state.entries),
    };
  }

  /**
   * Clear the sync state from memory.
   */
  async clear(): Promise<void> {
    this.state = null;
  }

  /**
   * Check if any state is stored.
   * Useful for determining if a full sync is needed.
   */
  hasState(): boolean {
    return this.state !== null;
  }

  /**
   * Get the number of tracked skills.
   */
  getEntryCount(): number {
    return this.state?.entries.size ?? 0;
  }
}
