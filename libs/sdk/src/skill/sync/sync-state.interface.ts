// file: libs/sdk/src/skill/sync/sync-state.interface.ts

/**
 * Status of a skill's synchronization with external storage.
 */
export type SkillSyncStatus = 'synced' | 'pending' | 'failed';

/**
 * Entry tracking the sync state of a single skill.
 */
export interface SkillSyncEntry {
  /**
   * The skill's unique identifier.
   */
  skillId: string;

  /**
   * SHA-256 hash of the skill content at last sync.
   */
  hash: string;

  /**
   * Timestamp of the last successful sync (epoch ms).
   */
  lastSyncedAt: number;

  /**
   * Current sync status.
   */
  status: SkillSyncStatus;

  /**
   * Error message if status is 'failed'.
   */
  error?: string;

  /**
   * External storage ID if different from skillId.
   * Used when external storage assigns its own identifiers.
   */
  externalId?: string;
}

/**
 * Full sync state tracking all skills.
 */
export interface SkillSyncState {
  /**
   * Version of the sync state format.
   * Allows for future migrations.
   */
  version: number;

  /**
   * Timestamp of the last complete sync operation (epoch ms).
   */
  lastFullSync: number;

  /**
   * Map of skill ID to sync entry.
   */
  entries: Map<string, SkillSyncEntry>;
}

/**
 * Serialized form of SkillSyncState for persistence.
 */
export interface SerializedSkillSyncState {
  version: number;
  lastFullSync: number;
  entries: Array<[string, SkillSyncEntry]>;
}

/**
 * Interface for persisting skill sync state.
 * Implementations can use memory, file system, or databases.
 */
export interface SkillSyncStateStore {
  /**
   * Load the sync state from storage.
   * @returns The sync state or null if not found
   */
  load(): Promise<SkillSyncState | null>;

  /**
   * Save the sync state to storage.
   * @param state - The state to persist
   */
  save(state: SkillSyncState): Promise<void>;

  /**
   * Clear the sync state from storage.
   */
  clear(): Promise<void>;
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  /**
   * IDs of newly added skills.
   */
  added: string[];

  /**
   * IDs of skills that were updated due to content changes.
   */
  updated: string[];

  /**
   * IDs of skills that were unchanged (hash matched).
   */
  unchanged: string[];

  /**
   * IDs of skills that were removed from external storage.
   */
  removed: string[];

  /**
   * IDs of skills that failed to sync with their errors.
   */
  failed: Array<{ skillId: string; error: string }>;

  /**
   * Total duration of the sync operation in milliseconds.
   */
  durationMs: number;
}

/**
 * Create an empty sync state with defaults.
 */
export function createEmptySyncState(): SkillSyncState {
  return {
    version: 1,
    lastFullSync: 0,
    entries: new Map(),
  };
}

/**
 * Serialize sync state for persistence.
 */
export function serializeSyncState(state: SkillSyncState): SerializedSkillSyncState {
  return {
    version: state.version,
    lastFullSync: state.lastFullSync,
    entries: Array.from(state.entries.entries()),
  };
}

/**
 * Deserialize sync state from persistence.
 */
export function deserializeSyncState(data: SerializedSkillSyncState): SkillSyncState {
  return {
    version: data.version,
    lastFullSync: data.lastFullSync,
    entries: new Map(data.entries),
  };
}
