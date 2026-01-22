// file: libs/sdk/src/skill/providers/external-skill.provider.ts

import type { FrontMcpLogger } from '../../common';
import type { SkillContent } from '../../common/interfaces';
import type { SkillMetadata } from '../../common/metadata';
import type {
  SkillStorageProvider,
  SkillSearchOptions,
  SkillSearchResult,
  SkillLoadResult,
  SkillListOptions,
  SkillListResult,
} from '../skill-storage.interface';
import type { SkillSyncState, SkillSyncStateStore, SyncResult, SkillSyncEntry } from '../sync/sync-state.interface';
import { createEmptySyncState } from '../sync/sync-state.interface';
import { computeSkillHash } from '../sync/skill-hash';

/**
 * Operating mode for external skill providers.
 *
 * - 'read-only': Skills are fetched from external storage, no local writes
 * - 'persistent': Local skills are synced to external storage with SHA-based change detection
 */
export type ExternalSkillMode = 'read-only' | 'persistent';

/**
 * Options for creating an external skill provider.
 */
export interface ExternalSkillProviderOptions {
  /**
   * Operating mode for the provider.
   * @see ExternalSkillMode
   */
  mode: ExternalSkillMode;

  /**
   * Store for persisting sync state.
   * Required for persistent mode, optional for read-only.
   */
  syncStateStore?: SkillSyncStateStore;

  /**
   * Logger instance for diagnostic output.
   */
  logger?: FrontMcpLogger;

  /**
   * Default number of search results.
   * @default 10
   */
  defaultTopK?: number;

  /**
   * Default minimum similarity threshold.
   * @default 0.1
   */
  defaultMinScore?: number;
}

/**
 * Options for skill search in external storage.
 */
export interface ExternalSkillSearchOptions extends SkillSearchOptions {
  /**
   * Include metadata like embeddings in results.
   */
  includeMetadata?: boolean;
}

/**
 * Options for listing skills from external storage.
 */
export interface ExternalSkillListOptions extends SkillListOptions {
  /**
   * Cursor for pagination (provider-specific).
   */
  cursor?: string;
}

/**
 * Abstract base class for external skill storage providers.
 *
 * Provides two operating modes:
 *
 * **Read-Only Mode:**
 * - All search/load operations fetch from external storage
 * - No local persistence or modification
 * - Use case: Pull skills from a shared skill repository
 *
 * **Persistent Mode:**
 * - Local skills are synced to external storage
 * - SHA-based change detection minimizes writes
 * - Tracks sync state to detect added/updated/removed skills
 * - Use case: Publish local skills to external vector DB
 *
 * @example Implementing a REST API provider
 * ```typescript
 * class RestSkillProvider extends ExternalSkillProviderBase {
 *   constructor(private apiUrl: string, options: ExternalSkillProviderOptions) {
 *     super(options);
 *   }
 *
 *   protected async fetchSkill(skillId: string): Promise<SkillContent | null> {
 *     const response = await fetch(`${this.apiUrl}/skills/${skillId}`);
 *     if (!response.ok) return null;
 *     return response.json();
 *   }
 *
 *   // ... implement other abstract methods
 * }
 * ```
 */
export abstract class ExternalSkillProviderBase implements SkillStorageProvider {
  readonly type = 'external' as const;

  /** Operating mode */
  protected readonly mode: ExternalSkillMode;

  /** Current sync state (loaded from store on init) */
  protected syncState: SkillSyncState | null = null;

  /** Store for persisting sync state */
  protected readonly syncStateStore?: SkillSyncStateStore;

  /** Logger instance */
  protected readonly logger?: FrontMcpLogger;

  /** Default search result count */
  protected readonly defaultTopK: number;

  /** Default minimum similarity threshold */
  protected readonly defaultMinScore: number;

  /** Whether the provider has been initialized */
  private initialized = false;

  constructor(options: ExternalSkillProviderOptions) {
    this.mode = options.mode;
    this.syncStateStore = options.syncStateStore;
    this.logger = options.logger;
    this.defaultTopK = options.defaultTopK ?? 10;
    this.defaultMinScore = options.defaultMinScore ?? 0.1;

    // Validate persistent mode requirements
    if (this.mode === 'persistent' && !this.syncStateStore) {
      this.logger?.warn(
        '[ExternalSkillProvider] Persistent mode without syncStateStore - sync state will not persist across restarts',
      );
    }
  }

  // ============================================
  // Abstract methods - must be implemented by subclasses
  // ============================================

  /**
   * Fetch a single skill from external storage.
   *
   * @param skillId - The skill identifier
   * @returns The skill content or null if not found
   */
  protected abstract fetchSkill(skillId: string): Promise<SkillContent | null>;

  /**
   * Fetch multiple skills from external storage.
   *
   * @param options - List options (pagination, filtering)
   * @returns Array of skill content
   */
  protected abstract fetchSkills(options?: ExternalSkillListOptions): Promise<SkillContent[]>;

  /**
   * Search for skills in external storage.
   *
   * @param query - Search query string
   * @param options - Search options
   * @returns Array of search results with scores
   */
  protected abstract searchExternal(query: string, options?: ExternalSkillSearchOptions): Promise<SkillSearchResult[]>;

  /**
   * Add or update a skill in external storage.
   *
   * @param skill - The skill content to upsert
   */
  protected abstract upsertSkill(skill: SkillContent): Promise<void>;

  /**
   * Delete a skill from external storage.
   *
   * @param skillId - The skill identifier to delete
   */
  protected abstract deleteSkill(skillId: string): Promise<void>;

  /**
   * Get the total count of skills in external storage.
   *
   * @param options - Filter options
   */
  protected abstract countExternal(options?: { tags?: string[]; includeHidden?: boolean }): Promise<number>;

  /**
   * Check if a skill exists in external storage.
   *
   * @param skillId - The skill identifier
   */
  protected abstract existsExternal(skillId: string): Promise<boolean>;

  // ============================================
  // SkillStorageProvider interface implementation
  // ============================================

  /**
   * Initialize the provider.
   * Loads sync state for persistent mode.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.mode === 'persistent' && this.syncStateStore) {
      this.syncState = await this.syncStateStore.load();
      this.logger?.debug('[ExternalSkillProvider] Loaded sync state', {
        entriesCount: this.syncState?.entries.size ?? 0,
        lastFullSync: this.syncState?.lastFullSync ?? 'never',
      });
    }

    this.initialized = true;
    this.logger?.info('[ExternalSkillProvider] Initialized', { mode: this.mode });
  }

  /**
   * Search for skills.
   * Delegates to the abstract searchExternal method.
   */
  async search(query: string, options?: SkillSearchOptions): Promise<SkillSearchResult[]> {
    return this.searchExternal(query, {
      ...options,
      topK: options?.topK ?? this.defaultTopK,
      minScore: options?.minScore ?? this.defaultMinScore,
    });
  }

  /**
   * Load a skill by ID.
   * Fetches from external storage and constructs a SkillLoadResult.
   */
  async load(skillId: string): Promise<SkillLoadResult | null> {
    const skill = await this.fetchSkill(skillId);
    if (!skill) {
      return null;
    }

    // All tools are "available" from external perspective
    // Actual tool validation happens at registry level
    const toolNames = skill.tools.map((t) => t.name);

    return {
      skill,
      availableTools: toolNames,
      missingTools: [],
      isComplete: true,
    };
  }

  /**
   * List skills with pagination.
   */
  async list(options?: SkillListOptions): Promise<SkillListResult> {
    const skills = await this.fetchSkills(options);
    const total = await this.countExternal({
      tags: options?.tags,
      includeHidden: options?.includeHidden,
    });

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;

    return {
      skills: skills.map((s) => this.skillToMetadata(s)),
      total,
      hasMore: offset + skills.length < total,
    };
  }

  /**
   * Check if a skill exists.
   */
  async exists(skillId: string): Promise<boolean> {
    return this.existsExternal(skillId);
  }

  /**
   * Count skills.
   */
  async count(options?: { tags?: string[]; includeHidden?: boolean }): Promise<number> {
    return this.countExternal(options);
  }

  /**
   * Dispose of resources.
   */
  async dispose(): Promise<void> {
    this.initialized = false;
    this.syncState = null;
    this.logger?.debug('[ExternalSkillProvider] Disposed');
  }

  // ============================================
  // Persistent mode methods
  // ============================================

  /**
   * Sync local skills to external storage.
   *
   * This method:
   * 1. Loads previous sync state
   * 2. Computes SHA-256 hash for each local skill
   * 3. Compares hashes to detect changes
   * 4. Upserts new/changed skills
   * 5. Deletes skills no longer present locally
   * 6. Saves updated sync state
   *
   * @param localSkills - Array of local skill content to sync
   * @returns Sync result with added/updated/unchanged/removed counts
   * @throws Error if called in read-only mode
   *
   * @example
   * ```typescript
   * const result = await provider.syncSkills(localSkills);
   * console.log(`Synced: ${result.added.length} added, ${result.updated.length} updated`);
   * ```
   */
  async syncSkills(localSkills: SkillContent[]): Promise<SyncResult> {
    if (this.mode !== 'persistent') {
      throw new Error('[ExternalSkillProvider] syncSkills is only available in persistent mode');
    }

    const startTime = Date.now();
    this.logger?.info('[ExternalSkillProvider] Starting skill sync', { skillCount: localSkills.length });

    // Load or create sync state
    const prevState = this.syncState ?? createEmptySyncState();
    const newState = createEmptySyncState();
    newState.version = prevState.version;

    const added: string[] = [];
    const updated: string[] = [];
    const unchanged: string[] = [];
    const removed: string[] = [];
    const failed: Array<{ skillId: string; error: string }> = [];

    // Track current skill IDs
    const currentIds = new Set(localSkills.map((s) => s.id));

    // Process each local skill
    for (const skill of localSkills) {
      const hash = computeSkillHash(skill);
      const prevEntry = prevState.entries.get(skill.id);

      try {
        if (!prevEntry) {
          // New skill - upsert to external
          await this.upsertSkill(skill);
          added.push(skill.id);
          this.logger?.debug('[ExternalSkillProvider] Added skill', { skillId: skill.id });
        } else if (prevEntry.hash !== hash) {
          // Changed skill - upsert to external
          await this.upsertSkill(skill);
          updated.push(skill.id);
          this.logger?.debug('[ExternalSkillProvider] Updated skill', { skillId: skill.id });
        } else {
          // Unchanged skill - no action needed
          unchanged.push(skill.id);
        }

        // Record successful sync
        const entry: SkillSyncEntry = {
          skillId: skill.id,
          hash,
          lastSyncedAt: Date.now(),
          status: 'synced',
          externalId: prevEntry?.externalId,
        };
        newState.entries.set(skill.id, entry);
      } catch (error) {
        // Record failed sync
        const errorMsg = error instanceof Error ? error.message : String(error);
        failed.push({ skillId: skill.id, error: errorMsg });

        const entry: SkillSyncEntry = {
          skillId: skill.id,
          hash,
          lastSyncedAt: prevEntry?.lastSyncedAt ?? 0,
          status: 'failed',
          error: errorMsg,
        };
        newState.entries.set(skill.id, entry);

        this.logger?.error('[ExternalSkillProvider] Failed to sync skill', { skillId: skill.id, error: errorMsg });
      }
    }

    // Find and remove deleted skills
    for (const [skillId, entry] of prevState.entries) {
      if (!currentIds.has(skillId)) {
        try {
          await this.deleteSkill(skillId);
          removed.push(skillId);
          this.logger?.debug('[ExternalSkillProvider] Removed skill', { skillId });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          failed.push({ skillId, error: errorMsg });
          // Keep the entry in new state with failed status
          newState.entries.set(skillId, {
            ...entry,
            status: 'failed',
            error: errorMsg,
          });
          this.logger?.error('[ExternalSkillProvider] Failed to remove skill', { skillId, error: errorMsg });
        }
      }
    }

    // Update and persist sync state
    newState.lastFullSync = Date.now();
    this.syncState = newState;

    if (this.syncStateStore) {
      await this.syncStateStore.save(newState);
    }

    const durationMs = Date.now() - startTime;

    this.logger?.info('[ExternalSkillProvider] Skill sync complete', {
      added: added.length,
      updated: updated.length,
      unchanged: unchanged.length,
      removed: removed.length,
      failed: failed.length,
      durationMs,
    });

    return {
      added,
      updated,
      unchanged,
      removed,
      failed,
      durationMs,
    };
  }

  /**
   * Get the current sync state.
   * Returns null if in read-only mode or never synced.
   */
  getSyncState(): SkillSyncState | null {
    return this.syncState ? { ...this.syncState, entries: new Map(this.syncState.entries) } : null;
  }

  /**
   * Clear the sync state.
   * Forces a full re-sync on next syncSkills call.
   */
  async clearSyncState(): Promise<void> {
    this.syncState = null;
    if (this.syncStateStore) {
      await this.syncStateStore.clear();
    }
    this.logger?.info('[ExternalSkillProvider] Sync state cleared');
  }

  /**
   * Check if the provider is operating in read-only mode.
   */
  isReadOnly(): boolean {
    return this.mode === 'read-only';
  }

  /**
   * Check if the provider is operating in persistent mode.
   */
  isPersistent(): boolean {
    return this.mode === 'persistent';
  }

  // ============================================
  // Helper methods
  // ============================================

  /**
   * Convert SkillContent to SkillMetadata.
   * Override in subclasses if additional metadata is available.
   */
  protected skillToMetadata(skill: SkillContent): SkillMetadata {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      tools: skill.tools.map((t) => (t.purpose ? { name: t.name, purpose: t.purpose } : t.name)),
      parameters: skill.parameters,
      examples: skill.examples,
    };
  }
}
