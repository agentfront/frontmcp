// file: libs/sdk/src/skill/providers/memory-skill.provider.ts

import { TFIDFVectoria, DocumentMetadata } from 'vectoriadb';
import { SkillContent } from '../../common/interfaces';
import { SkillMetadata, extractToolNames } from '../../common/metadata';
import { SkillToolValidator, ToolValidationResult } from '../skill-validator';
import {
  SkillStorageProvider,
  SkillStorageProviderType,
  SkillSearchOptions,
  SkillSearchResult,
  SkillLoadResult,
  SkillListOptions,
  SkillListResult,
  MutableSkillStorageProvider,
} from '../skill-storage.interface';

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
}

/**
 * In-memory skill storage provider using TF-IDF for search.
 *
 * This is the default provider used when no external storage is configured.
 * It stores skills in memory and uses TF-IDF vectorization for similarity search.
 */
export class MemorySkillProvider implements MutableSkillStorageProvider {
  readonly type: SkillStorageProviderType = 'memory';

  private vectorDB: TFIDFVectoria<SkillDocumentMetadata>;
  private skills: Map<string, SkillContent> = new Map();
  private defaultTopK: number;
  private defaultMinScore: number;
  private toolValidator?: SkillToolValidator;
  private initialized = false;

  constructor(options: MemorySkillProviderOptions = {}) {
    this.defaultTopK = options.defaultTopK ?? 10;
    this.defaultMinScore = options.defaultMinScore ?? 0.1;
    this.toolValidator = options.toolValidator;

    this.vectorDB = new TFIDFVectoria<SkillDocumentMetadata>({
      defaultTopK: this.defaultTopK,
      defaultSimilarityThreshold: this.defaultMinScore,
    });
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

    // Search using TF-IDF
    const results = await this.vectorDB.search(query, {
      topK,
      threshold: minScore,
      filter,
    });

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
      let comparison = 0;
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
    this.indexSkill(skill);
  }

  async update(skillId: string, skill: SkillContent): Promise<void> {
    // Remove old entry
    if (this.vectorDB.hasDocument(skillId)) {
      this.vectorDB.removeDocument(skillId);
    }

    // Add updated skill
    this.skills.set(skillId, skill);
    this.indexSkill(skill);
  }

  async remove(skillId: string): Promise<void> {
    this.skills.delete(skillId);
    if (this.vectorDB.hasDocument(skillId)) {
      this.vectorDB.removeDocument(skillId);
    }
  }

  async clear(): Promise<void> {
    this.skills.clear();
    this.vectorDB.clear();
  }

  async dispose(): Promise<void> {
    this.skills.clear();
    this.vectorDB.clear();
    this.initialized = false;
  }

  /**
   * Bulk add skills (more efficient than adding one by one).
   */
  async addMany(skills: SkillContent[]): Promise<void> {
    const documents = skills.map((skill) => {
      this.skills.set(skill.id, skill);
      return {
        id: skill.id,
        text: this.buildSearchableText(skill),
        metadata: {
          id: skill.id,
          skillId: skill.id,
          skill,
        },
      };
    });

    this.vectorDB.addDocuments(documents);
    this.vectorDB.reindex();
  }

  /**
   * Index a single skill in the vector database.
   */
  private indexSkill(skill: SkillContent): void {
    const document = {
      id: skill.id,
      text: this.buildSearchableText(skill),
      metadata: {
        id: skill.id,
        skillId: skill.id,
        skill,
      },
    };

    this.vectorDB.addDocuments([document]);
    this.vectorDB.reindex();
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
   * Convert SkillContent to SkillMetadata.
   * This is needed because SkillContent doesn't store the original metadata format.
   */
  private skillToMetadata(skill: SkillContent): SkillMetadata {
    const tags = this.getSkillTags(skill);
    const priority = this.getPriority(skill);
    const hideFromDiscovery = this.isHidden(skill);

    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      tools: skill.tools.map((t) => (t.purpose ? { name: t.name, purpose: t.purpose } : t.name)),
      parameters: skill.parameters,
      examples: skill.examples,
      // Include additional metadata for search results
      ...(tags.length > 0 && { tags }),
      ...(priority !== undefined && { priority }),
      ...(hideFromDiscovery && { hideFromDiscovery }),
    };
  }

  /**
   * Get tags from a skill (stored in metadata but not in SkillContent directly).
   * We store them in a custom property for now.
   */
  private getSkillTags(skill: SkillContent): string[] {
    // Tags are stored in the metadata but not directly in SkillContent
    // We need to access them from the original metadata if available
    return (skill as SkillContent & { tags?: string[] }).tags ?? [];
  }

  /**
   * Check if a skill is hidden from discovery.
   */
  private isHidden(skill: SkillContent): boolean {
    return (skill as SkillContent & { hideFromDiscovery?: boolean }).hideFromDiscovery === true;
  }

  /**
   * Get priority of a skill.
   */
  private getPriority(skill: SkillContent): number | undefined {
    return (skill as SkillContent & { priority?: number }).priority;
  }
}
