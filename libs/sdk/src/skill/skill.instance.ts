// file: libs/sdk/src/skill/skill.instance.ts

import { EntryOwnerRef, SkillEntry, SkillKind, SkillRecord, SkillToolRef, normalizeToolRef } from '../common';
import { SkillContent, SkillReferenceInfo, SkillExampleInfo } from '../common/interfaces';
import { SkillVisibility } from '../common/metadata/skill.metadata';
import ProviderRegistry from '../provider/provider.registry';
import { ScopeEntry } from '../common';
import { loadInstructions, buildSkillContent, resolveReferences, resolveExamples } from './skill.utils';
import { dirname, pathResolve } from '@frontmcp/utils';

/**
 * Extended SkillContent with additional metadata for caching.
 * These fields are useful for search but not part of the base SkillContent interface.
 */
interface CachedSkillContent extends SkillContent {
  tags?: string[];
  priority?: number;
  hideFromDiscovery?: boolean;
  visibility?: SkillVisibility;
  // Note: license, compatibility, specMetadata, allowedTools, resources
  // are already part of SkillContent and inherited automatically.
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
  readonly scope: ScopeEntry;

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
    } else if (this.record.kind === SkillKind.VALUE && this.record.callerDir) {
      // For inline skills created via skill(), use the caller's directory
      // so that relative paths like './docs/my-skill.md' resolve correctly
      basePath = this.record.callerDir;
    }

    // Load instructions from source
    try {
      this.cachedInstructions = await loadInstructions(this.metadata.instructions, basePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // In bundled/CLI environments, callerDir may resolve incorrectly.
        // Fall back to the build-time _skills/manifest.json which maps skill
        // names to their copied content files relative to the bundle directory.
        const resolved = resolveFromSkillManifest(this.metadata.name);
        if (resolved) {
          this.cachedInstructions = await loadInstructions({ file: resolved }, undefined);
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
    return this.cachedInstructions;
  }

  /**
   * Load the full skill content.
   * Results are cached after the first load.
   */
  /**
   * Resolve the base directory for this skill (for file/reference resolution).
   */
  getBaseDir(): string | undefined {
    if (this.record.kind === SkillKind.FILE) {
      return dirname(this.record.filePath) || undefined;
    }
    if (this.record.kind === SkillKind.VALUE && this.record.callerDir) {
      return this.record.callerDir;
    }
    return undefined;
  }

  override async load(): Promise<SkillContent> {
    if (this.cachedContent !== undefined) {
      return this.cachedContent;
    }

    const instructions = await this.loadInstructions();
    const baseDir = this.getBaseDir();

    // Resolve references from the references/ directory if it exists
    const refsPath = this.metadata.resources?.references;
    let resolvedRefs: SkillReferenceInfo[] | undefined;
    if (refsPath) {
      let refsDir = refsPath.startsWith('/') ? refsPath : baseDir ? pathResolve(baseDir, refsPath) : undefined;
      // Fall back to manifest for bundled environments
      if (refsDir) {
        try {
          resolvedRefs = await resolveReferences(refsDir);
        } catch {
          refsDir = resolveResourceFromManifest(this.metadata.name, 'references');
          if (refsDir) resolvedRefs = await resolveReferences(refsDir);
        }
      } else {
        refsDir = resolveResourceFromManifest(this.metadata.name, 'references');
        if (refsDir) resolvedRefs = await resolveReferences(refsDir);
      }
    }

    // Resolve examples from the examples/ directory if it exists
    const examplesPath = this.metadata.resources?.examples;
    let resolvedExs: SkillExampleInfo[] | undefined;
    if (examplesPath) {
      let exDir = examplesPath.startsWith('/')
        ? examplesPath
        : baseDir
          ? pathResolve(baseDir, examplesPath)
          : undefined;
      // Fall back to manifest for bundled environments
      if (exDir) {
        try {
          resolvedExs = await resolveExamples(exDir);
        } catch {
          exDir = resolveResourceFromManifest(this.metadata.name, 'examples');
          if (exDir) resolvedExs = await resolveExamples(exDir);
        }
      } else {
        exDir = resolveResourceFromManifest(this.metadata.name, 'examples');
        if (exDir) resolvedExs = await resolveExamples(exDir);
      }
    }

    const baseContent = buildSkillContent(this.metadata, instructions, resolvedRefs, resolvedExs);

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

// ─── Build-time skill manifest resolution ──────────────────────────────────

type SkillManifestEntry = {
  instructions?: string;
  references?: string;
  examples?: string;
  scripts?: string;
  assets?: string;
};

let skillManifestCache: Record<string, SkillManifestEntry> | null | undefined;

/**
 * Resolve a skill's instruction file path from the build-time `_skills/manifest.json`.
 *
 * During `frontmcp build -t cli`, skill content files are copied into a flat
 * `_skills/` directory with a manifest mapping skill names to their file paths.
 * This function reads that manifest at runtime to resolve paths that would
 * otherwise fail due to incorrect `callerDir` in bundled environments.
 *
 * @returns Absolute path to the instructions file, or undefined if not found.
 */
function resolveFromSkillManifest(skillName: string): string | undefined {
  if (skillManifestCache === null) return undefined; // Already tried, not found

  if (skillManifestCache === undefined) {
    // Try to load manifest from the main module's directory
    try {
      const fs = require('fs');
      const path = require('path');
      const mainDir = require.main?.filename ? path.dirname(require.main.filename) : process.cwd();
      const manifestPath = path.join(mainDir, '_skills', 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        skillManifestCache = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } else {
        skillManifestCache = null;
        return undefined;
      }
    } catch {
      skillManifestCache = null;
      return undefined;
    }
  }

  const entry = skillManifestCache![skillName];
  if (!entry?.instructions) return undefined;

  const path = require('path');
  const mainDir = require.main?.filename ? path.dirname(require.main.filename) : process.cwd();
  return path.resolve(mainDir, entry.instructions);
}

/**
 * Resolve a skill's resource directory from the build-time manifest.
 * @returns Absolute path to the resource directory, or undefined if not found.
 */
export function resolveResourceFromManifest(
  skillName: string,
  resourceType: 'references' | 'examples' | 'scripts' | 'assets',
): string | undefined {
  // Ensure manifest is loaded
  resolveFromSkillManifest(skillName);
  if (!skillManifestCache) return undefined;

  const entry = skillManifestCache[skillName];
  const relPath = entry?.[resourceType];
  if (!relPath) return undefined;

  const path = require('path');
  const mainDir = require.main?.filename ? path.dirname(require.main.filename) : process.cwd();
  return path.resolve(mainDir, relPath);
}
