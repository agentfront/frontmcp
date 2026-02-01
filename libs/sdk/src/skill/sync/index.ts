// file: libs/sdk/src/skill/sync/index.ts

/**
 * Skill Sync Module
 *
 * Provides utilities for synchronizing local skills with external vector databases.
 * Supports two modes:
 * - Read-only: Pull skills from external source (no local persistence)
 * - Persistent: SHA-based change detection, sync local skills to external store
 *
 * @module skill/sync
 */

// Hash utilities
export { computeSkillHash, computeSkillHashComponents, areSkillsEqual } from './skill-hash';
export type { SkillHashComponents } from './skill-hash';

// Sync state types
export { createEmptySyncState, serializeSyncState, deserializeSyncState } from './sync-state.interface';
export type {
  SkillSyncStatus,
  SkillSyncEntry,
  SkillSyncState,
  SerializedSkillSyncState,
  SkillSyncStateStore,
  SyncResult,
} from './sync-state.interface';

// Sync state stores
export { MemorySyncStateStore } from './memory-sync-state.store';
