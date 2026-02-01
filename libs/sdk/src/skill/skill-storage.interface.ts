// file: libs/sdk/src/skill/skill-storage.interface.ts

import { SkillMetadata } from '../common/metadata';
import { SkillContent } from '../common/interfaces';

/**
 * Options for searching skills.
 */
export interface SkillSearchOptions {
  /**
   * Maximum number of results to return.
   * @default 10
   */
  topK?: number;

  /**
   * Filter by specific tags.
   */
  tags?: string[];

  /**
   * Minimum similarity score threshold (0-1).
   * @default 0.1
   */
  minScore?: number;

  /**
   * Only return skills where all referenced tools are available.
   * @default false
   */
  requireAllTools?: boolean;

  /**
   * Skill IDs to exclude from results.
   */
  excludeIds?: string[];

  /**
   * Filter by specific tools (skills must reference these tools).
   */
  tools?: string[];
}

/**
 * Options for listing skills.
 */
export interface SkillListOptions {
  /**
   * Number of skills to skip (for pagination).
   * @default 0
   */
  offset?: number;

  /**
   * Maximum number of skills to return.
   * @default 50
   */
  limit?: number;

  /**
   * Filter by specific tags.
   */
  tags?: string[];

  /**
   * Field to sort by.
   * @default 'name'
   */
  sortBy?: 'name' | 'priority' | 'createdAt';

  /**
   * Sort order.
   * @default 'asc'
   */
  sortOrder?: 'asc' | 'desc';

  /**
   * Include hidden skills in results.
   * @default false
   */
  includeHidden?: boolean;
}

/**
 * Result from a skill search operation.
 */
export interface SkillSearchResult {
  /**
   * The skill metadata.
   */
  metadata: SkillMetadata;

  /**
   * Relevance score (0-1).
   */
  score: number;

  /**
   * Tools that are available in the current scope.
   */
  availableTools: string[];

  /**
   * Tools that are referenced but not available.
   */
  missingTools: string[];

  /**
   * Source of the skill ('local' or 'external').
   */
  source: 'local' | 'external';
}

/**
 * Result from loading a skill.
 */
export interface SkillLoadResult {
  /**
   * The loaded skill content.
   */
  skill: SkillContent;

  /**
   * Tools that are available in the current scope.
   */
  availableTools: string[];

  /**
   * Tools that are referenced but not available.
   */
  missingTools: string[];

  /**
   * True if all required tools are available.
   */
  isComplete: boolean;

  /**
   * Warning message if tools are missing.
   */
  warning?: string;
}

/**
 * Result from listing skills.
 */
export interface SkillListResult {
  /**
   * List of skill metadata.
   */
  skills: SkillMetadata[];

  /**
   * Total number of skills matching the filter.
   */
  total: number;

  /**
   * Whether there are more skills beyond this page.
   */
  hasMore: boolean;
}

/**
 * Provider type identifier.
 */
export type SkillStorageProviderType = 'memory' | 'vectordb' | 'postgres' | 'external' | 'custom';

/**
 * Interface for skill storage providers.
 *
 * Storage providers handle persistence and retrieval of skills,
 * enabling both local (in-memory) and external (database) storage.
 */
export interface SkillStorageProvider {
  /**
   * Provider type identifier.
   */
  readonly type: SkillStorageProviderType;

  /**
   * Initialize the storage provider.
   * Called once during startup.
   */
  initialize(): Promise<void>;

  /**
   * Search for skills matching a query.
   *
   * @param query - Search query string
   * @param options - Search options
   * @returns Array of matching skills with scores
   */
  search(query: string, options?: SkillSearchOptions): Promise<SkillSearchResult[]>;

  /**
   * Load a skill by ID.
   *
   * @param skillId - The skill identifier
   * @returns The loaded skill or null if not found
   */
  load(skillId: string): Promise<SkillLoadResult | null>;

  /**
   * List skills with optional filtering and pagination.
   *
   * @param options - List options
   * @returns Paginated list of skills
   */
  list(options?: SkillListOptions): Promise<SkillListResult>;

  /**
   * Check if a skill exists.
   *
   * @param skillId - The skill identifier
   * @returns True if the skill exists
   */
  exists(skillId: string): Promise<boolean>;

  /**
   * Count skills matching optional criteria.
   *
   * @param options - Filter options
   * @returns Number of matching skills
   */
  count(options?: { tags?: string[]; includeHidden?: boolean }): Promise<number>;

  /**
   * Dispose of resources.
   * Called during shutdown.
   */
  dispose(): Promise<void>;
}

/**
 * Interface for skill storage providers that support adding skills.
 * Used by providers that can dynamically add skills (e.g., file watchers).
 */
export interface MutableSkillStorageProvider extends SkillStorageProvider {
  /**
   * Add a skill to the storage.
   *
   * @param skill - The skill content to add
   */
  add(skill: SkillContent): Promise<void>;

  /**
   * Update an existing skill.
   *
   * @param skillId - The skill identifier
   * @param skill - The updated skill content
   */
  update(skillId: string, skill: SkillContent): Promise<void>;

  /**
   * Remove a skill from the storage.
   *
   * @param skillId - The skill identifier
   */
  remove(skillId: string): Promise<void>;

  /**
   * Clear all skills from the storage.
   */
  clear(): Promise<void>;
}
