// file: libs/sdk/src/skill/skill.instance.ts

import { EntryOwnerRef, SkillEntry, SkillKind, SkillRecord, SkillToolRef, normalizeToolRef } from '../common';
import { SkillContent } from '../common/interfaces';
import { SkillVisibility } from '../common/metadata/skill.metadata';
import ProviderRegistry from '../provider/provider.registry';
import { Scope } from '../scope';
import { loadInstructions, buildSkillContent } from './skill.utils';

/**
 * Extended SkillContent with additional metadata for caching.
 * These fields are useful for search but not part of the base SkillContent interface.
 */
interface CachedSkillContent extends SkillContent {
  tags?: string[];
  priority?: number;
  hideFromDiscovery?: boolean;
  visibility?: SkillVisibility;
}

/**
 * Concrete implementation of a skill that can be loaded and searched.
 *
 * SkillInstance handles:
 * - Loading instructions from inline strings, files, or URLs
 * - Building full SkillContent for LLM consumption
 * - Caching loaded instructions for performance
 */
export class SkillInstance extends SkillEntry {
  /** The provider registry this skill is bound to */
  private readonly providersRef: ProviderRegistry;

  /** The scope this skill operates in */
  readonly scope: Scope;

  /** Cached instructions (loaded lazily) */
  private cachedInstructions?: string;

  /** Cached skill content (built lazily) */
  private cachedContent?: CachedSkillContent;

  /** Tags for search indexing */
  private readonly tags: string[];

  /** Priority for search ranking */
  private readonly priority: number;

  /** Whether skill is hidden from discovery */
  private readonly hidden: boolean;

  /** Visibility mode for skill discovery */
  private readonly skillVisibility: SkillVisibility;

  constructor(record: SkillRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this.providersRef = providers;

    // Set name and fullName
    this.name = record.metadata.id ?? record.metadata.name;
    this.fullName = `${this.owner.id}:${this.name}`;

    // Cache metadata properties for faster access
    this.tags = record.metadata.tags ?? [];
    this.priority = record.metadata.priority ?? 0;
    this.hidden = record.metadata.hideFromDiscovery ?? false;
    this.skillVisibility = record.metadata.visibility ?? 'both';

    // Get scope reference
    this.scope = this.providersRef.getActiveScope();

    // Start initialization
    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    // Skills don't have hooks like tools do, so initialization is minimal
    // We could pre-load instructions here if we wanted to fail fast,
    // but lazy loading is more efficient for large skill sets
    return Promise.resolve();
  }

  /**
   * Get a short description of the skill.
   */
  override getDescription(): string {
    return this.metadata.description;
  }

  /**
   * Load the skill's instructions from the configured source.
   * Results are cached after the first load.
   */
  override async loadInstructions(): Promise<string> {
    if (this.cachedInstructions !== undefined) {
      return this.cachedInstructions;
    }

    // Determine base path for file resolution
    let basePath: string | undefined;
    if (this.record.kind === SkillKind.FILE) {
      // For file-based skills, use the directory of the skill file
      const filePath = this.record.filePath;
      const lastSlash = filePath.lastIndexOf('/');
      basePath = lastSlash > 0 ? filePath.substring(0, lastSlash) : undefined;
    }

    // Load instructions from source
    this.cachedInstructions = await loadInstructions(this.metadata.instructions, basePath);
    return this.cachedInstructions;
  }

  /**
   * Load the full skill content.
   * Results are cached after the first load.
   */
  override async load(): Promise<SkillContent> {
    if (this.cachedContent !== undefined) {
      return this.cachedContent;
    }

    const instructions = await this.loadInstructions();
    const baseContent = buildSkillContent(this.metadata, instructions);

    // Add additional metadata that's useful for search but not in base SkillContent
    this.cachedContent = {
      ...baseContent,
      tags: this.tags,
      priority: this.priority,
      hideFromDiscovery: this.hidden,
      visibility: this.skillVisibility,
    };

    return this.cachedContent;
  }

  /**
   * Get tool references with normalized format.
   */
  override getToolRefs(): SkillToolRef[] {
    const tools = this.metadata.tools;
    if (!tools) return [];
    return tools.map((t) => normalizeToolRef(t));
  }

  /**
   * Get tool names only.
   */
  override getToolNames(): string[] {
    return this.getToolRefs().map((t) => t.name);
  }

  /**
   * Get the skill's tags.
   */
  override getTags(): string[] {
    return this.tags;
  }

  /**
   * Check if the skill is hidden from discovery.
   */
  override isHidden(): boolean {
    return this.hidden;
  }

  /**
   * Get the skill's priority for search ranking.
   */
  override getPriority(): number {
    return this.priority;
  }

  /**
   * Get the provider registry.
   */
  get providers(): ProviderRegistry {
    return this.providersRef;
  }

  /**
   * Clear cached content (useful for hot-reload scenarios).
   */
  clearCache(): void {
    this.cachedInstructions = undefined;
    this.cachedContent = undefined;
  }

  /**
   * Create a SkillContent from metadata without async loading.
   * Returns cached content if available, builds from inline instructions,
   * or returns undefined if instructions require async loading.
   *
   * @returns SkillContent if available synchronously, undefined otherwise
   */
  getContentSync(): SkillContent | undefined {
    if (this.cachedContent) {
      return this.cachedContent;
    }

    // Only works with inline instructions
    if (typeof this.metadata.instructions === 'string') {
      return buildSkillContent(this.metadata, this.metadata.instructions);
    }

    // Can't load synchronously
    return undefined;
  }
}

/**
 * Create a SkillInstance from a SkillRecord.
 *
 * @param record - The skill record
 * @param providers - Provider registry
 * @param owner - Owner reference
 * @returns A new SkillInstance
 */
export function createSkillInstance(
  record: SkillRecord,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
): SkillInstance {
  return new SkillInstance(record, providers, owner);
}
