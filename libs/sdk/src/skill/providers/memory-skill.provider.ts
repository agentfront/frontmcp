// file: libs/sdk/src/skill/providers/memory-skill.provider.ts

import { TFIDFVectoria, type DocumentMetadata } from 'vectoriadb/worker';

import { sha256Hex } from '@frontmcp/utils';

import { type SkillContent } from '../../common/interfaces';
import { type SkillMetadata, type SkillVisibility } from '../../common/metadata';
import { type SkillIndexCache, type SkillIndexScoring } from '../skill-index-cache.interface';
import {
  type MutableSkillStorageProvider,
  type SkillListOptions,
  type SkillListResult,
  type SkillLoadResult,
  type SkillSearchOptions,
  type SkillSearchResult,
  type SkillStorageProviderType,
} from '../skill-storage.interface';
import { type SkillToolValidator, type ToolValidationResult } from '../skill-validator';

/**
 * Stop words to filter from search queries and indexing.
 * Optimized for skill discovery context.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  // Articles & Determiners
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  // Prepositions
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'into',
  // Conjunctions
  'and',
  'or',
  'but',
  'so',
  'as',
  'if',
  'when',
  'where',
  // Pronouns
  'i',
  'me',
  'my',
  'you',
  'your',
  'it',
  'its',
  'we',
  'our',
  'they',
  'their',
  // Auxiliary verbs
  'is',
  'was',
  'are',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'can',
  'could',
  'should',
  'may',
  'might',
  // Common fillers
  'please',
  'help',
  'want',
  'need',
  'like',
  'just',
  'how',
  'what',
]);

/**
 * Metadata stored with each skill document in the vector database.
 */
interface SkillDocumentMetadata extends DocumentMetadata {
  id: string;
  skillId: string;
  skill: SkillContent;
}

/**
 * Extended SkillContent with additional metadata properties.
 * Used internally for storing skills with tags, priority, and visibility.
 */
interface StoredSkillContent extends SkillContent {
  tags?: string[];
  priority?: number;
  hideFromDiscovery?: boolean;
  visibility?: SkillVisibility;
}

/**
 * Configuration options for MemorySkillProvider.
 */
export interface MemorySkillProviderOptions {
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

  /**
   * Optional tool validator for enriching results.
   */
  toolValidator?: SkillToolValidator;

  /**
   * Ranking function for the underlying vector DB. `bm25` gives stronger keyword
   * relevance; `cosine` (default) preserves the historical behavior. Only takes
   * effect when the installed `vectoriadb` supports it (newer versions); older
   * versions silently ignore it and use cosine.
   * @default 'cosine'
   */
  scoring?: SkillIndexScoring;

  /**
   * Optional cache for the built index so a cold start can restore it instead of
   * recomputing IDF + embeddings for the whole corpus. Used only when the
   * installed `vectoriadb` exposes snapshot support.
   */
  indexCache?: SkillIndexCache;
}

/**
 * Structural subset of a snapshot-capable vector DB. Detected at runtime so the
 * SDK keeps compiling against `vectoriadb` versions that predate snapshots; on
 * such versions the cache is simply skipped (a rebuild happens instead).
 */
interface SnapshotCapableDb {
  toSnapshot(): unknown;
  loadSnapshot(snapshot: unknown): void;
}

function isSnapshotCapable(db: unknown): db is SnapshotCapableDb {
  const d = db as Partial<SnapshotCapableDb>;
  return typeof d.toSnapshot === 'function' && typeof d.loadSnapshot === 'function';
}

/**
 * In-memory skill storage provider using TF-IDF for search.
 *
 * This is the default provider used when no external storage is configured.
 * It stores skills in memory and uses TF-IDF vectorization for similarity search.
 */
export class MemorySkillProvider implements MutableSkillStorageProvider {
  readonly type: SkillStorageProviderType = 'memory';

  /** The search index, created the first time a search needs it. */
  private vectorDB?: TFIDFVectoria<SkillDocumentMetadata>;
  private skills: Map<string, SkillContent> = new Map();
  private defaultTopK: number;
  private defaultMinScore: number;
  private toolValidator?: SkillToolValidator;
  private initialized = false;

  /** Ranking mode passed to the vector DB (cosine | bm25). */
  private readonly scoring: SkillIndexScoring;

  /** Optional snapshot cache for fast cold-start (e.g. KV-backed on the edge). */
  private indexCache?: SkillIndexCache;

  /**
   * The index is rebuilt from `skills` when it is stale: adds/removes bump
   * `skillsVersion`, and the FIRST search after a mutation builds (or restores)
   * the index exactly once. This keeps the expensive IDF/embedding pass off the
   * registration hot-path.
   */
  private skillsVersion = 0;
  private indexedVersion = -1;

  constructor(options: MemorySkillProviderOptions = {}) {
    this.defaultTopK = options.defaultTopK ?? 10;
    this.defaultMinScore = options.defaultMinScore ?? 0.1;
    this.toolValidator = options.toolValidator;
    this.scoring = options.scoring ?? 'cosine';
    this.indexCache = options.indexCache;
  }

  private createVectorDB(): TFIDFVectoria<SkillDocumentMetadata> {
    // `scoring` is read by newer vectoriadb versions; older ones ignore the
    // extra field and use cosine. Built as a typed variable (not an object
    // literal) so passing it to the older constructor type isn't an excess-
    // property error.
    const dbConfig: { defaultTopK: number; defaultSimilarityThreshold: number; scoring?: SkillIndexScoring } = {
      defaultTopK: this.defaultTopK,
      defaultSimilarityThreshold: this.defaultMinScore,
    };
    if (this.scoring !== 'cosine') dbConfig.scoring = this.scoring;
    return new TFIDFVectoria<SkillDocumentMetadata>(dbConfig);
  }

  /**
   * Attach (or replace) the snapshot cache after construction — useful when the
   * cache binding only exists at request time (e.g. a Cloudflare KV namespace on
   * `env`). Marks the index stale so the next search consults the new cache.
   */
  setIndexCache(cache: SkillIndexCache | undefined): void {
    this.indexCache = cache;
    this.markStale();
  }

  /** Whether the index reflects the current skill set. */
  private get indexReady(): boolean {
    return this.indexedVersion === this.skillsVersion;
  }

  /** Record a change to the skill set; the next search rebuilds the index. */
  private markStale(): void {
    this.skillsVersion++;
  }

  /**
   * Ensure the vector index reflects the current document set, building it AT
   * MOST once per mutation batch. When a snapshot cache is configured and the
   * vector DB supports snapshots, a content-hash hit restores the index without
   * recomputing IDF/embeddings (the cold-start fast path); a miss rebuilds and
   * persists the snapshot for next time. Cache failures degrade to a local
   * rebuild — they never block search.
   */
  private async ensureIndexed(): Promise<void> {
    if (this.indexReady) return;
    const db = this.db();
    // A mutation while this build awaits leaves the index stale for the next search.
    const version = this.skillsVersion;

    if (this.indexCache && isSnapshotCapable(db)) {
      const key = await this.computeIndexKey();
      try {
        const snapshot = await this.indexCache.get(key);
        if (snapshot !== undefined && snapshot !== null) {
          // The cache round-trips an opaque snapshot (`unknown`); the provider
          // owns its shape — it is exactly what `db.toSnapshot()` produced — so
          // cast back to the DB's own snapshot parameter type. (vectoriadb's
          // `loadSnapshot` is strictly typed as of 2.3.x.)
          db.loadSnapshot(snapshot as Parameters<typeof db.loadSnapshot>[0]);
          this.indexedVersion = version;
          return;
        }
      } catch {
        // Treat a cache failure as a miss and rebuild locally.
      }
      this.rebuildIndex(db);
      this.indexedVersion = version;
      try {
        await this.indexCache.set(key, db.toSnapshot());
      } catch {
        // Best-effort persist; a write failure must not fail the search.
      }
      return;
    }

    // No cache (or unsupported vectoriadb): just build locally.
    this.rebuildIndex(db);
    this.indexedVersion = version;
  }

  /**
   * Eagerly build (or restore from cache) the search index now, rather than on
   * the first search. A host calls this after registration completes to move the
   * one-time index build off the first request's critical path (e.g. the edge
   * does this right after attaching the KV cache).
   */
  async warm(): Promise<void> {
    await this.ensureIndexed();
  }

  /** Load every current skill into the vector DB and (re)compute its index. */
  private rebuildIndex(db: TFIDFVectoria<SkillDocumentMetadata>): void {
    db.clear();
    db.addDocuments(Array.from(this.skills.values(), (skill) => this.toDocument(skill)));
    (db as unknown as { reindex(): void }).reindex();
  }

  private toDocument(skill: SkillContent): { id: string; text: string; metadata: SkillDocumentMetadata } {
    return {
      id: skill.id,
      text: this.buildSearchableText(skill),
      metadata: { id: skill.id, skillId: skill.id, skill },
    };
  }

  /**
   * Stable content hash of the indexed skill set + scoring mode. Changing any
   * skill's searchable text, the set of skills, or the scoring mode changes the
   * key, so a stale snapshot is never restored.
   */
  private async computeIndexKey(): Promise<string> {
    const parts = Array.from(this.skills.values())
      .map((s) => `${s.id}\u0000${this.buildSearchableText(s)}`)
      .sort();
    const canonical = `frontmcp-skill-index:v1|${this.scoring}|${this.skills.size}|${parts.join('')}`;
    return sha256Hex(canonical);
  }

  private db(): TFIDFVectoria<SkillDocumentMetadata> {
    this.vectorDB ??= this.createVectorDB();
    return this.vectorDB;
  }

  /**
   * Set the tool validator after construction.
   * Useful when the validator isn't available at construction time.
   */
  setToolValidator(validator: SkillToolValidator): void {
    this.toolValidator = validator;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async search(query: string, options: SkillSearchOptions = {}): Promise<SkillSearchResult[]> {
    // An empty / whitespace-only query has no terms to rank: historically the
    // zero-score results were dropped by the score threshold (→ no results), and
    // vectoriadb >= 2.3 now THROWS on such a query. Short-circuit to preserve the
    // "empty query → no results" contract without hitting the vector DB.
    if (query.trim().length === 0) {
      return [];
    }
    const {
      topK = this.defaultTopK,
      tags,
      minScore = this.defaultMinScore,
      requireAllTools = false,
      excludeIds = [],
      tools,
    } = options;

    // Build filter function
    const filter = (metadata: SkillDocumentMetadata): boolean => {
      const skill = metadata.skill;

      // Exclude hidden skills from search results (unless explicitly requested)
      if (this.isHidden(skill)) {
        return false;
      }

      // Exclude specific IDs
      if (excludeIds.includes(skill.id)) {
        return false;
      }

      // Filter by tags
      if (tags && tags.length > 0) {
        const skillTags = this.getSkillTags(skill);
        if (!tags.some((t) => skillTags.includes(t))) {
          return false;
        }
      }

      // Filter by required tools
      if (tools && tools.length > 0) {
        const skillTools = skill.tools.map((t) => t.name);
        if (!tools.some((t) => skillTools.includes(t))) {
          return false;
        }
      }

      return true;
    };

    // Search using TF-IDF. Ensure the index is built/restored exactly once for
    // the current document set (cold-start fast path via the snapshot cache).
    const db = this.db();
    await this.ensureIndexed();
    let results = await db.search(query, {
      topK,
      threshold: minScore,
      filter,
      // `negativeQuery` (anti-query demotion) is honored by newer vectoriadb
      // versions; older ones ignore the extra field.
      ...(options.negativeQuery !== undefined ? { negativeQuery: options.negativeQuery } : {}),
      ...(options.negativeWeight !== undefined ? { negativeWeight: options.negativeWeight } : {}),
    } as Parameters<typeof db.search>[1]);

    // Fallback: if TF-IDF returns nothing (common with single-doc corpus where IDF=0),
    // do substring match against stored skills
    if (results.length === 0 && query.trim().length > 0 && this.skills.size > 0) {
      results = this.fallbackTextSearch(query, topK, filter);
    }

    // Transform and enrich results
    const searchResults: SkillSearchResult[] = [];

    for (const result of results) {
      const skill = result.metadata.skill;
      const toolNames = skill.tools.map((t) => t.name);

      // Validate tools if validator is available
      let validation: ToolValidationResult | undefined;
      if (this.toolValidator) {
        validation = this.toolValidator.validate(toolNames);

        // Skip if requireAllTools and not all tools are available
        if (requireAllTools && !validation.complete) {
          continue;
        }
      }

      searchResults.push({
        metadata: this.skillToMetadata(skill),
        score: result.score,
        availableTools: validation?.available ?? toolNames,
        missingTools: validation?.missing ?? [],
        source: 'local',
      });
    }

    return searchResults;
  }

  async load(skillId: string): Promise<SkillLoadResult | null> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return null;
    }

    const toolNames = skill.tools.map((t) => t.name);

    // Validate tools
    let availableTools = toolNames;
    let missingTools: string[] = [];
    let isComplete = true;
    let warning: string | undefined;

    if (this.toolValidator) {
      const validation = this.toolValidator.validate(toolNames);
      availableTools = validation.available;
      missingTools = validation.missing;
      isComplete = validation.complete;
      warning = this.toolValidator.formatWarning(validation, skill.name);
    }

    return {
      skill,
      availableTools,
      missingTools,
      isComplete,
      warning,
    };
  }

  async list(options: SkillListOptions = {}): Promise<SkillListResult> {
    const { offset = 0, limit = 50, tags, sortBy = 'name', sortOrder = 'asc', includeHidden = false } = options;

    // Get all skills and filter
    let skills = Array.from(this.skills.values());

    // Filter hidden
    if (!includeHidden) {
      skills = skills.filter((s) => !this.isHidden(s));
    }

    // Filter by tags
    if (tags && tags.length > 0) {
      skills = skills.filter((s) => {
        const skillTags = this.getSkillTags(s);
        return tags.some((t) => skillTags.includes(t));
      });
    }

    // Sort
    skills.sort((a, b) => {
      let comparison: number;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'priority':
          comparison = (this.getPriority(a) ?? 0) - (this.getPriority(b) ?? 0);
          break;
        default:
          comparison = a.name.localeCompare(b.name);
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    const total = skills.length;
    const hasMore = offset + limit < total;

    // Paginate
    skills = skills.slice(offset, offset + limit);

    return {
      skills: skills.map((s) => this.skillToMetadata(s)),
      total,
      hasMore,
    };
  }

  async exists(skillId: string): Promise<boolean> {
    return this.skills.has(skillId);
  }

  async count(options: { tags?: string[]; includeHidden?: boolean } = {}): Promise<number> {
    const { tags, includeHidden = false } = options;

    let count = 0;
    for (const skill of this.skills.values()) {
      // Skip hidden unless includeHidden
      if (!includeHidden && this.isHidden(skill)) {
        continue;
      }

      // Filter by tags
      if (tags && tags.length > 0) {
        const skillTags = this.getSkillTags(skill);
        if (!tags.some((t) => skillTags.includes(t))) {
          continue;
        }
      }

      count++;
    }

    return count;
  }

  async add(skill: SkillContent): Promise<void> {
    this.skills.set(skill.id, skill);
    this.markStale();
  }

  async update(skillId: string, skill: SkillContent): Promise<void> {
    // Normalize: ensure skill.id matches skillId so the index never holds an orphan
    const normalizedSkill = skill.id !== skillId ? { ...skill, id: skillId } : skill;
    this.skills.set(skillId, normalizedSkill);
    this.markStale();
  }

  async remove(skillId: string): Promise<void> {
    this.skills.delete(skillId);
    this.markStale();
  }

  async clear(): Promise<void> {
    this.skills.clear();
    this.vectorDB?.clear();
    this.markStale();
  }

  async dispose(): Promise<void> {
    this.skills.clear();
    this.vectorDB?.clear();
    this.markStale();
    this.initialized = false;
  }

  /**
   * Bulk add skills (more efficient than adding one by one).
   */
  async addMany(skills: SkillContent[]): Promise<void> {
    for (const skill of skills) this.skills.set(skill.id, skill);
    // Defer the expensive IDF/embedding pass to the next search (built once).
    this.markStale();
  }

  /**
   * Build searchable text for TF-IDF indexing.
   * Uses term weighting to improve relevance:
   * - Description: 3x weight (most important for matching)
   * - Tags: 2x weight
   * - Tools: 1x weight
   * - Name: 1x weight
   */
  private buildSearchableText(skill: SkillContent): string {
    const parts: string[] = [];

    // Name (tokenized)
    if (skill.name) {
      const nameParts = skill.name.split(/[:\-_.\s]/).filter(Boolean);
      parts.push(...nameParts);
    }

    // Description (3x weight)
    if (skill.description) {
      parts.push(skill.description, skill.description, skill.description);

      // Extract key terms from description
      const keyTerms = skill.description
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
      parts.push(...keyTerms);
    }

    // Tags (2x weight)
    const tags = this.getSkillTags(skill);
    for (const tag of tags) {
      parts.push(tag, tag);
    }

    // Tools (1x weight)
    for (const tool of skill.tools) {
      parts.push(tool.name);
      if (tool.purpose) {
        parts.push(tool.purpose);
      }
    }

    // Parameters (1x weight)
    if (skill.parameters) {
      for (const param of skill.parameters) {
        parts.push(param.name);
        if (param.description) {
          parts.push(param.description);
        }
      }
    }

    // Examples (1x weight)
    if (skill.examples) {
      for (const example of skill.examples) {
        parts.push(example.scenario);
        if (example.expectedOutcome) {
          parts.push(example.expectedOutcome);
        }
      }
    }

    return parts.join(' ');
  }

  /**
   * Fallback text search when TF-IDF produces no results (e.g., single-document corpus).
   * Performs case-insensitive substring matching on the searchable text.
   */
  private fallbackTextSearch(
    query: string,
    topK: number,
    filter: (metadata: SkillDocumentMetadata) => boolean,
  ): Array<{ id: string; text: string; score: number; metadata: SkillDocumentMetadata }> {
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOP_WORDS.has(t));

    if (queryTerms.length === 0) {
      return [];
    }

    const matches: Array<{ id: string; text: string; score: number; metadata: SkillDocumentMetadata }> = [];

    this.skills.forEach((skill) => {
      const metadata: SkillDocumentMetadata = { id: skill.id, skillId: skill.id, skill };

      if (!filter(metadata)) {
        return;
      }

      const searchableText = this.buildSearchableText(skill);
      const matchCount = queryTerms.filter((term) => searchableText.toLowerCase().includes(term)).length;

      if (matchCount > 0) {
        matches.push({
          id: skill.id,
          text: searchableText,
          score: matchCount / queryTerms.length,
          metadata,
        });
      }
    });

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, topK);
  }

  /**
   * Convert SkillContent to SkillMetadata.
   * This is needed because SkillContent doesn't store the original metadata format.
   */
  private skillToMetadata(skill: SkillContent): SkillMetadata {
    const tags = this.getSkillTags(skill);
    const priority = this.getPriority(skill);
    const hideFromDiscovery = this.isHidden(skill);
    const visibility = this.getVisibility(skill);

    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      tools: skill.tools.map((t) => {
        // Preserve all fields: name, purpose, and required
        if (t.purpose || t.required) {
          return {
            name: t.name,
            ...(t.purpose && { purpose: t.purpose }),
            ...(t.required && { required: t.required }),
          };
        }
        return t.name;
      }),
      parameters: skill.parameters,
      examples: skill.examples,
      // Include additional metadata for search results
      ...(tags.length > 0 && { tags }),
      ...(priority !== undefined && { priority }),
      ...(hideFromDiscovery && { hideFromDiscovery }),
      // Always include visibility for filtering
      visibility: visibility ?? 'both',
    };
  }

  /**
   * Get tags from a skill (stored in metadata but not in SkillContent directly).
   * We store them in a custom property for now.
   */
  private getSkillTags(skill: SkillContent): string[] {
    // Tags are stored in the metadata but not directly in SkillContent
    // We need to access them from the original metadata if available
    return (skill as StoredSkillContent).tags ?? [];
  }

  /**
   * Check if a skill is hidden from discovery.
   */
  private isHidden(skill: SkillContent): boolean {
    return (skill as StoredSkillContent).hideFromDiscovery === true;
  }

  /**
   * Get priority of a skill.
   */
  private getPriority(skill: SkillContent): number | undefined {
    return (skill as StoredSkillContent).priority;
  }

  /**
   * Get visibility of a skill.
   */
  private getVisibility(skill: SkillContent): SkillVisibility | undefined {
    return (skill as StoredSkillContent).visibility;
  }
}
