// file: libs/sdk/src/skill/skill.registry.ts

import { tokenName, type Token } from '@frontmcp/di';
import { type ServerCapabilities } from '@frontmcp/protocol';
import { getRuntimeContext, isEntryAvailable } from '@frontmcp/utils';

import {
  type EntryLineage,
  type EntryOwnerRef,
  type ScopeEntry,
  type SkillEntry,
  type SkillToolValidationMode,
  type SkillType,
} from '../common';
import { logAvailabilityFiltering } from '../common/availability';
import { type SkillContent } from '../common/interfaces';
import type { SkillMetadata } from '../common/metadata';
import { SkillKind, type SkillRecord, type SkillValueRecord } from '../common/records';
import { PublicMcpError } from '../errors';
import type ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, type RegistryBuildMapResult } from '../regsitry';
import { ownerKeyOf, qualifiedNameOf } from '../utils/lineage.utils';
import {
  SkillValidationError,
  type SkillValidationReport,
  type SkillValidationResult,
} from './errors/skill-validation.error';
import type { ExternalSkillProviderBase } from './providers/external-skill.provider';
import { MemorySkillProvider } from './providers/memory-skill.provider';
import { SEP_2640_EXTENSION_ID, type SkillIndexEntry } from './sep-2640';
import {
  type MutableSkillStorageProvider,
  type SkillListOptions,
  type SkillListResult,
  type SkillLoadResult,
  type SkillSearchOptions,
  type SkillSearchResult,
  type SkillStorageProvider,
} from './skill-storage.interface';
import { SkillToolValidator } from './skill-validator';
import { SkillEmitter, type SkillChangeEvent } from './skill.events';
import { createSkillInstance, type SkillInstance } from './skill.instance';
import { normalizeSkill, skillDiscoveryDeps } from './skill.utils';
import type { SyncResult } from './sync/sync-state.interface';

/**
 * Indexed skill for efficient lookup.
 */
export interface IndexedSkill {
  token: Token;
  instance: SkillInstance;
  baseName: string;
  lineage: EntryLineage;
  ownerKey: string;
  qualifiedName: string;
  qualifiedId: string;
  source: SkillRegistry;
}

/**
 * Options for configuring SkillRegistry behavior.
 */
export interface SkillRegistryOptions {
  /**
   * Default validation mode for all skills in this registry.
   * Can be overridden per-skill via SkillMetadata.toolValidation.
   *
   * @default 'warn'
   */
  defaultToolValidation?: SkillToolValidationMode;

  /**
   * Whether to fail the entire registry initialization if any skill fails validation.
   * Only applies when toolValidation is 'strict'.
   *
   * @default false
   */
  failOnInvalidSkills?: boolean;
}

/**
 * Options for getting skills from the registry.
 */
export interface GetSkillsOptions {
  /**
   * Whether to include hidden skills.
   * @default false
   */
  includeHidden?: boolean;

  /**
   * Filter by visibility context.
   * - 'mcp': Only skills visible via MCP (visibility = 'mcp' or 'both')
   * - 'http': Only skills visible via HTTP (visibility = 'http' or 'both')
   * - 'all': All skills regardless of visibility (default)
   */
  visibility?: 'mcp' | 'http' | 'all';
}

/**
 * Interface for SkillRegistry consumers.
 */
export interface SkillRegistryInterface {
  owner: EntryOwnerRef;

  /**
   * Get all skills in the registry.
   * @param options - Options for filtering skills (or boolean for backwards compatibility)
   */
  getSkills(options?: boolean | GetSkillsOptions): SkillEntry[];

  /**
   * Get the "executable" subset — skills that declare at least one tool OR
   * at least one referenced openapi operation. Drives `codecall:searchSkills`.
   */
  getExecutableSkills(options?: GetSkillsOptions): SkillEntry[];

  /**
   * Get the "knowledge-only" subset — skills with no tools and no referenced
   * openapi operations. Drives `codecall:searchKnowledge`.
   */
  getKnowledgeOnlySkills(options?: GetSkillsOptions): SkillEntry[];

  /**
   * Find a skill by name.
   * @param name - The skill name
   */
  findByName(name: string): SkillEntry | undefined;

  /**
   * Find a skill by qualified name (includes owner prefix).
   * @param qualifiedName - The qualified name (e.g., "my-app:review-pr")
   */
  findByQualifiedName(qualifiedName: string): SkillEntry | undefined;

  /**
   * Search for skills matching a query.
   * @param query - Search query string
   * @param options - Search options
   */
  search(query: string, options?: SkillSearchOptions): Promise<SkillSearchResult[]>;

  /**
   * Load a skill by ID.
   * @param skillId - The skill identifier
   */
  loadSkill(skillId: string): Promise<SkillLoadResult | undefined>;

  /**
   * List skills with pagination.
   * @param options - List options
   */
  listSkills(options?: SkillListOptions): Promise<SkillListResult>;

  /**
   * Check if any skills exist.
   */
  hasAny(): boolean;

  /**
   * Get total skill count.
   * @param options - Count options
   */
  count(options?: { tags?: string[]; includeHidden?: boolean }): Promise<number>;

  /**
   * Subscribe to skill change events.
   * @param opts - Subscription options
   * @param cb - Callback function
   */
  subscribe(
    opts: { immediate?: boolean; filter?: (skill: SkillEntry) => boolean },
    cb: (event: SkillChangeEvent) => void,
  ): () => void;

  /**
   * Get MCP capabilities for skills.
   */
  getCapabilities(): Partial<ServerCapabilities>;

  /**
   * SEP-2640 §Discovery — extra resource-template entries for the
   * `skill://index.json` document.
   */
  getSep2640IndexTemplates?(): SkillIndexEntry[];

  /**
   * SEP-2640 ADR — extra archive entries for the `skill://index.json`
   * document.
   */
  getSep2640IndexArchives?(): SkillIndexEntry[];

  /**
   * SEP-2640 §Discovery — opt-in extra `skill://` URIs to surface in the
   * server `instructions` field.
   */
  getSep2640InstructionUris?(): string[];

  /**
   * Validate all skills against the current tool registry.
   * Should be called after all tools (including from plugins/adapters) are registered.
   *
   * @returns Validation report for all skills
   * @throws SkillValidationError if failOnInvalidSkills is true and any skill fails
   */
  validateAllTools(): Promise<SkillValidationReport>;

  /**
   * Register a skill at runtime from a fully-resolved SkillContent.
   *
   * Used by plugins (e.g. plugin-skilled-openapi) that ingest skill bundles after
   * the registry has booted. Returns a handle whose `unregister()` removes the
   * skill again and fires another change event. Re-registering the same `id`
   * replaces the previous content.
   *
   * Dynamically-registered skills appear in {@link search}, {@link loadSkill},
   * {@link listSkills}, {@link count}, and {@link getSkills}. They participate
   * in `notifications/skills/list_changed` broadcasts.
   *
   * @param content - The skill content to register
   * @param opts - Optional registration metadata (e.g. source identifier for diagnostics)
   * @returns Handle exposing `unregister()` and the resolved skill id
   */
  registerSkillContent(
    content: SkillContent,
    opts?: { source?: string },
  ): Promise<{ id: string; unregister: () => Promise<void> }>;

  /**
   * Remove a previously-registered dynamic skill by id.
   * No-op (returns false) if the id was not registered dynamically.
   */
  unregisterSkill(id: string): Promise<boolean>;

  /**
   * Sync local skills to external storage.
   * Only available when an external provider in persistent mode is set.
   *
   * @returns Sync result with added/updated/unchanged/removed counts, or null if no external provider
   */
  syncToExternal(): Promise<SyncResult | null>;

  /**
   * Get the external provider if one is configured.
   */
  getExternalProvider(): ExternalSkillProviderBase | undefined;

  /**
   * Check if the registry has an external provider.
   */
  hasExternalProvider(): boolean;
}

/**
 * Registry for managing skills.
 *
 * The SkillRegistry is the main facade for:
 * - Managing local skills (registered via @Skill decorator or skill() helper)
 * - Searching skills using TF-IDF
 * - Loading skill content (including fetching from URLs)
 * - Tracking skill changes
 */
export default class SkillRegistry
  extends RegistryAbstract<SkillInstance, SkillRecord, SkillType[]>
  implements SkillRegistryInterface
{
  /** Owner of this registry */
  owner: EntryOwnerRef;

  /** Local skills indexed for lookup */
  private localRows: IndexedSkill[] = [];

  /** Skills registered dynamically at runtime via {@link registerSkillContent} */
  private dynamicRows: IndexedSkill[] = [];

  /**
   * Original SkillContent preserved verbatim for dynamic skills, so loadSkill
   * returns the exact content (including `actions[]` and `bundleVersion`) that
   * was registered, rather than a metadata-rebuild that loses extra fields.
   */
  private dynamicContents = new Map<string, SkillContent>();

  /**
   * Per-id generation counter for dynamic registrations. Bumped on every
   * registerSkillContent call so a stale unregister handle held by an earlier
   * caller cannot remove a replacement registration.
   */
  private dynamicGenerations = new Map<string, number>();

  /** Adopted skills from child registries */
  private adopted = new Map<SkillRegistry, IndexedSkill[]>();

  /** Children registries */
  private children = new Set<SkillRegistry>();

  /** O(1) indexes */
  private byQualifiedId = new Map<string, IndexedSkill>();
  private byName = new Map<string, IndexedSkill[]>();
  private byOwnerAndName = new Map<string, IndexedSkill>();

  /** Version and emitter for change tracking */
  private version = 0;
  private emitter = new SkillEmitter();

  /** Internal storage provider for search */
  private storageProvider: SkillStorageProvider;

  /** External skill provider for sync operations */
  private externalProvider?: ExternalSkillProviderBase;

  /** Tool validator for checking tool availability */
  private toolValidator?: SkillToolValidator;

  /** The scope this registry operates in */
  readonly scope: ScopeEntry;

  /** Registry-level options for validation behavior */
  private readonly options: SkillRegistryOptions;

  /** SEP-2640 §Discovery — additional `mcp-resource-template` index entries. */
  private sep2640IndexTemplates: SkillIndexEntry[] = [];

  /** SEP-2640 ADR — additional `archive` index entries. */
  private sep2640IndexArchives: SkillIndexEntry[] = [];

  /** SEP-2640 §Discovery — extra `skill://` URIs to surface in server `instructions`. */
  private sep2640InstructionUris: string[] = [];

  constructor(providers: ProviderRegistry, list: SkillType[], owner: EntryOwnerRef, options?: SkillRegistryOptions) {
    super('SkillRegistry', providers, list, false);
    this.owner = owner;
    this.scope = providers.getActiveScope();
    this.options = options ?? {};

    // Create storage provider (will set tool validator later after tools are available)
    this.storageProvider = new MemorySkillProvider({
      defaultTopK: 10,
      defaultMinScore: 0.1,
    });

    // Build dependency graph
    this.buildGraph();

    // Start initialization
    this.ready = this.initialize();
  }

  /* -------------------- Build-time -------------------- */

  protected override buildMap(list: SkillType[]): RegistryBuildMapResult<SkillRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, SkillRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const raw of list) {
      const rec = normalizeSkill(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }

    return { tokens, defs, graph };
  }

  protected buildGraph(): void {
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) continue;

      const deps = skillDiscoveryDeps(rec);
      for (const d of deps) {
        // Validate against hierarchical providers
        this.providers.get(d);
        this.graph.get(token)?.add(d);
      }
    }
  }

  /* -------------------- Initialize -------------------- */

  protected override async initialize(): Promise<void> {
    // Create tool validator if tools registry is available
    try {
      const toolRegistry = this.scope.tools;
      if (toolRegistry) {
        this.toolValidator = new SkillToolValidator(toolRegistry);
        (this.storageProvider as MemorySkillProvider).setToolValidator(this.toolValidator);
      }
    } catch {
      // Tools registry not available yet, continue without validator
    }

    // Initialize storage provider
    await this.storageProvider.initialize();

    // Create instances for each local skill
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) continue;

      const instance = createSkillInstance(rec, this.providers, this.owner);
      this.instances.set(token as Token<SkillInstance>, instance);

      const lineage: EntryLineage = this.owner ? [this.owner] : [];
      const row = this.makeRow(token, instance, lineage, this);
      this.localRows.push(row);

      // Load skill content and add to storage provider for search
      try {
        const content = await instance.load();
        await (this.storageProvider as MemorySkillProvider).add(content);
      } catch (error) {
        this.scope.logger.warn(`Failed to load skill ${instance.name}: ${(error as Error).message}`);
      }
    }

    // Adopt skills from apps
    const childAppRegistries = this.providers.getRegistries('AppRegistry');
    for (const appRegistry of childAppRegistries) {
      const apps = appRegistry.getApps();
      for (const app of apps) {
        // Adopt skills from app's skill registry
        const appSkillsRegistry = app.skills;
        if (appSkillsRegistry && 'adoptFromChild' in this && appSkillsRegistry !== this) {
          // For local apps, adopt from their SkillRegistry
          if (!app.isRemote && appSkillsRegistry instanceof SkillRegistry) {
            await this.adoptFromChild(appSkillsRegistry, appSkillsRegistry.owner);
          }
        }
      }
    }

    // Adopt from other child registries
    const childRegistries = this.providers.getRegistries('SkillRegistry');
    for (const child of childRegistries) {
      if (child !== this) {
        await this.adoptFromChild(child as SkillRegistry, child.owner);
      }
    }

    // Build indexes
    this.reindex();

    // Log availability filtering at boot (registry-level, not HTTP/flow-level auth)
    logAvailabilityFiltering(
      'SkillRegistry',
      this.listAllIndexed().map((r) => r.instance),
      this.scope.logger,
    );

    this.bump('reset');
  }

  /* -------------------- Adoption -------------------- */

  /**
   * Adopt skills from a child registry.
   */
  async adoptFromChild(child: SkillRegistry, _childOwner: EntryOwnerRef): Promise<void> {
    if (this.children.has(child)) return;

    const childRows = child.listAllIndexed();
    const prepend: EntryLineage = this.owner ? [this.owner] : [];

    const adoptedRows = childRows.map((r) => this.relineage(r, prepend));

    this.adopted.set(child, adoptedRows);
    this.children.add(child);

    // Subscribe to child changes
    child.subscribe({ immediate: false }, () => {
      const latest = child.listAllIndexed().map((r) => this.relineage(r, prepend));
      this.adopted.set(child, latest);
      this.reindex();
      this.bump('reset');
      // Re-add skills to storage provider on changes
      for (const row of latest) {
        row.instance
          .load()
          .then((content) => {
            (this.storageProvider as MemorySkillProvider).add(content);
          })
          .catch((error) => {
            this.scope.logger.warn(`Failed to reload adopted skill ${row.baseName}: ${(error as Error).message}`);
          });
      }
    });

    // Add adopted skills to storage provider - await to ensure they're searchable
    await Promise.all(
      adoptedRows.map(async (row) => {
        try {
          const content = await row.instance.load();
          await (this.storageProvider as MemorySkillProvider).add(content);
        } catch (error) {
          this.scope.logger.warn(`Failed to load adopted skill ${row.baseName}: ${(error as Error).message}`);
        }
      }),
    );

    this.reindex();
    this.bump('reset');
  }

  /* -------------------- Public API -------------------- */

  /**
   * Get all skills in the registry.
   * @param options - Options for filtering skills (or boolean for backwards compatibility)
   */
  getSkills(options?: boolean | GetSkillsOptions): SkillEntry[] {
    // Handle backwards compatibility with boolean argument
    const opts: GetSkillsOptions = typeof options === 'boolean' ? { includeHidden: options } : (options ?? {});

    const { includeHidden = false, visibility = 'all' } = opts;

    let skills = this.listAllIndexed().map((r) => r.instance);

    // Filter by hidden status
    if (!includeHidden) {
      skills = skills.filter((s) => !s.isHidden());
    }

    // Filter by visibility
    if (visibility !== 'all') {
      skills = skills.filter((s) => {
        const skillVis = s.metadata.visibility ?? 'both';
        if (skillVis === 'both') return true;
        return skillVis === visibility;
      });
    }

    // Filter by environment availability
    const ctx = getRuntimeContext();
    skills = skills.filter((s) => isEntryAvailable(s.metadata.availableWhen, ctx));

    return skills;
  }

  /**
   * Get inline (local) skills only.
   */
  getInlineSkills(): SkillInstance[] {
    return [...this.instances.values()];
  }

  /**
   * Get skills marked `alwaysLoad: true` in their metadata. The codecall
   * runtime merges these into every execute() invocation regardless of which
   * skills the agent passed, providing a per-server "standard library."
   *
   * Honours the same visibility and environment-availability gating as
   * {@link getSkills}; hidden skills CAN be always-loaded (a server may want
   * common helpers loaded without surfacing them in search).
   */
  getAlwaysLoadedSkills(): SkillEntry[] {
    let skills = this.listAllIndexed().map((r) => r.instance);
    skills = skills.filter((s) => s.isAlwaysLoaded());

    const ctx = getRuntimeContext();
    skills = skills.filter((s) => isEntryAvailable(s.metadata.availableWhen, ctx));

    return skills;
  }

  /**
   * Get the "executable" subset — skills that declare at least one tool OR
   * at least one referenced openapi operation. These are the skills
   * `codecall:searchSkills` ranks. Honours hidden-filtering + availability
   * gating like {@link getSkills}.
   */
  getExecutableSkills(opts?: GetSkillsOptions): SkillEntry[] {
    return this.getSkills(opts).filter((s) => s.isExecutable());
  }

  /**
   * Get the "knowledge-only" subset — skills with no tools and no
   * referenced openapi operations. These are the skills
   * `codecall:searchKnowledge` ranks. Honours hidden-filtering + availability
   * gating like {@link getSkills}.
   */
  getKnowledgeOnlySkills(opts?: GetSkillsOptions): SkillEntry[] {
    return this.getSkills(opts).filter((s) => s.isKnowledgeOnly());
  }

  /**
   * Find a skill by name.
   */
  findByName(name: string): SkillEntry | undefined {
    const rows = this.byName.get(name);
    return rows?.[0]?.instance;
  }

  /**
   * Find a skill by qualified name.
   */
  findByQualifiedName(qualifiedName: string): SkillEntry | undefined {
    for (const row of this.listAllIndexed()) {
      if (row.qualifiedName === qualifiedName) {
        return row.instance;
      }
    }
    return undefined;
  }

  /**
   * Search for skills matching a query.
   *
   * Always merges the dynamic-skill overlay on top of the storage provider's
   * results. For ids present in `dynamicContents`, the provider's score and
   * ranking are preserved, but the metadata is replaced with the dynamic
   * projection — otherwise a stale provider row (from a re-registration whose
   * provider update lagged or failed) would mask the newer dynamic content.
   * Provider-only rows pass through unchanged; overlay-only rows are appended.
   */
  async search(query: string, options?: SkillSearchOptions): Promise<SkillSearchResult[]> {
    const baseResults = await this.storageProvider.search(query, options);
    if (this.dynamicContents.size === 0) return baseResults;
    const baseSeen = new Set<string>();
    let rewrites = 0;
    const rewrittenBase: SkillSearchResult[] = baseResults.map((r) => {
      const id = r.metadata.id ?? r.metadata.name;
      baseSeen.add(id);
      const dyn = this.dynamicContents.get(id);
      if (!dyn) return r;
      rewrites++;
      // Preserve provider's score/source; swap in the live dynamic projection
      // so re-registrations are reflected even when the provider lagged.
      const meta = this.dynamicSkillMetadata(dyn);
      const toolNames = dyn.tools.map((t) => t.name);
      let availableTools = toolNames;
      let missingTools: string[] = [];
      if (this.toolValidator) {
        const v = this.toolValidator.validate(toolNames);
        availableTools = v.available;
        missingTools = v.missing;
      }
      return { ...r, metadata: meta, availableTools, missingTools };
    });
    const overlayOnly = this.searchDynamicOverlay(query, options, baseSeen);
    if (overlayOnly.length === 0 && rewrites === 0) return baseResults;
    const merged = [...rewrittenBase, ...overlayOnly].sort((a, b) => b.score - a.score);
    const topK = options?.topK;
    return typeof topK === 'number' && topK >= 0 ? merged.slice(0, topK) : merged;
  }

  /**
   * Load a skill by ID or name.
   * Supports looking up by:
   * - metadata.id (the unique identifier)
   * - metadata.name (the display name)
   * - qualified name (owner:name format)
   */
  async loadSkill(skillId: string): Promise<SkillLoadResult | undefined> {
    // Dynamic skills bypass the SkillInstance.load() path so the original
    // SkillContent (with `actions[]` / `bundleVersion`) survives intact.
    const dynamic = this.dynamicContents.get(skillId);
    if (dynamic) {
      return this.buildDynamicLoadResult(dynamic);
    }

    // Try local skills first by ID/baseName, then qualified name
    let localSkill = this.findByName(skillId) ?? this.findByQualifiedName(skillId);

    // If not found, try matching by metadata.name (when it differs from id)
    if (!localSkill) {
      for (const row of this.listAllIndexed()) {
        if (row.instance.metadata.name === skillId) {
          localSkill = row.instance;
          break;
        }
      }
    }

    if (localSkill) {
      // Gate by availability — same constraint as getSkills()
      const ctx = getRuntimeContext();
      if (!isEntryAvailable(localSkill.metadata.availableWhen, ctx)) {
        return undefined;
      }

      // If this localSkill came from registerSkillContent, the resolved id
      // points back into `dynamicContents` and we must return the preserved
      // SkillContent (carrying `actions[]` / `bundleVersion`) rather than
      // round-tripping through SkillInstance.load(), which rebuilds content
      // from metadata and drops those extra fields.
      const dynamicResolved = this.dynamicContents.get(localSkill.metadata.id ?? localSkill.metadata.name);
      if (dynamicResolved) {
        return this.buildDynamicLoadResult(dynamicResolved);
      }

      const instance = localSkill as SkillInstance;
      const content = await instance.load();
      const toolNames = instance.getToolNames();

      // Validate tools if validator is available
      let availableTools = toolNames;
      let missingTools: string[] = [];
      let isComplete = true;
      let warning: string | undefined;

      if (this.toolValidator) {
        const validation = this.toolValidator.validate(toolNames);
        availableTools = validation.available;
        missingTools = validation.missing;
        isComplete = validation.complete;
        warning = this.toolValidator.formatWarning(validation, instance.name);
      }

      return {
        skill: content,
        availableTools,
        missingTools,
        isComplete,
        warning,
      };
    }

    // Try storage provider (for external skills)
    const result = await this.storageProvider.load(skillId);
    return result ?? undefined;
  }

  /**
   * Build a SkillLoadResult for a dynamic SkillContent, running tool validation
   * and warning formatting consistently with the SkillInstance.load() path.
   *
   * Returns a deep-cloned SkillContent so callers cannot mutate the registry's
   * stored copy. The matching clone-on-write happens at registration time in
   * `registerSkillContent`, keeping the registry authoritative.
   */
  private buildDynamicLoadResult(content: SkillContent): SkillLoadResult {
    const toolNames = content.tools.map((t) => t.name);
    let availableTools = toolNames;
    let missingTools: string[] = [];
    let isComplete = true;
    let warning: string | undefined;
    if (this.toolValidator) {
      const validation = this.toolValidator.validate(toolNames);
      availableTools = validation.available;
      missingTools = validation.missing;
      isComplete = validation.complete;
      warning = this.toolValidator.formatWarning(validation, content.name);
    }
    return { skill: structuredClone(content), availableTools, missingTools, isComplete, warning };
  }

  /**
   * List skills with pagination.
   *
   * For ids present in `dynamicContents`, the provider's slot is preserved but
   * its metadata is replaced with the dynamic projection so re-registrations
   * are visible even when the provider lagged. Overlay-only ids are appended
   * to the page; pagination is recomputed against the merged set so `total`
   * and `hasMore` stay correct.
   */
  async listSkills(options?: SkillListOptions): Promise<SkillListResult> {
    const baseResult = await this.storageProvider.list(options);
    if (this.dynamicContents.size === 0) return baseResult;
    const baseIds = new Set<string>();
    let rewrites = 0;
    const rewrittenBase: SkillMetadata[] = baseResult.skills.map((meta) => {
      const id = meta.id ?? meta.name;
      baseIds.add(id);
      const dyn = this.dynamicContents.get(id);
      if (!dyn) return meta;
      rewrites++;
      return this.dynamicSkillMetadata(dyn);
    });
    const overlay = this.collectDynamicMetadata(options).filter((m) => !baseIds.has(m.id ?? m.name));
    if (overlay.length === 0 && rewrites === 0) return baseResult;

    // Provider already applied pagination, so the additional overlay rows go
    // at the tail; total is the union of the two sets, hasMore reflects whether
    // ALL overlay rows could fit alongside the provider's offset/limit window.
    // Honor the caller's offset into the combined set: if offset reaches past
    // the provider's total, slice into the overlay accordingly.
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const offset = options?.offset ?? 0;
    const room = Math.max(0, limit - rewrittenBase.length);
    const overlayStart = Math.max(0, offset - baseResult.total);
    const fittedOverlay = overlay.slice(overlayStart, overlayStart + room);
    const skills = [...rewrittenBase, ...fittedOverlay];
    const total = baseResult.total + overlay.length;
    const hasMore = baseResult.hasMore || overlayStart + fittedOverlay.length < overlay.length;
    return { skills, total, hasMore };
  }

  /**
   * Check if any skills exist.
   */
  hasAny(): boolean {
    return this.listAllIndexed().length > 0;
  }

  /**
   * Get total skill count.
   *
   * Sums the provider count with overlay rows the provider does not know
   * about so callers see the same surface as `search` / `listSkills`.
   */
  async count(options?: { tags?: string[]; includeHidden?: boolean }): Promise<number> {
    const baseCount = await this.storageProvider.count(options);
    if (this.dynamicContents.size === 0) return baseCount;
    // We can't know which dynamic ids the provider already counted without
    // listing it, so we list with a large limit (matching the provider's own
    // semantics) and dedupe. For typical bundle sizes this is fine; very
    // large catalogs should override the storage provider with one whose
    // count() honors the dynamic overlay natively.
    const baseList = await this.storageProvider.list({
      tags: options?.tags,
      includeHidden: options?.includeHidden,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const baseIds = new Set<string>();
    for (const m of baseList.skills) baseIds.add(m.id ?? m.name);
    const overlay = this.collectDynamicMetadata(options).filter((m) => !baseIds.has(m.id ?? m.name));
    return baseCount + overlay.length;
  }

  /**
   * Project a SkillContent into the SkillMetadata shape callers expect from
   * search / list. Used to surface dynamic skills regardless of whether the
   * storage provider was able to index them. Mirrors the metadata projection
   * inside `registerSkillContent` so search/list/load see the same shape.
   */
  private dynamicSkillMetadata(content: SkillContent): SkillMetadata {
    return {
      id: content.id,
      name: content.name,
      description: content.description,
      instructions: content.instructions,
      tools: content.tools.map((t) => ({
        name: t.name,
        ...(t.purpose !== undefined && { purpose: t.purpose }),
        ...(t.required !== undefined && { required: t.required }),
      })),
      ...(content.parameters !== undefined && { parameters: content.parameters }),
      ...(content.examples !== undefined && { examples: content.examples }),
      ...(content.license !== undefined && { license: content.license }),
      ...(content.compatibility !== undefined && { compatibility: content.compatibility }),
      ...(content.specMetadata !== undefined && { specMetadata: content.specMetadata }),
      ...(content.allowedTools !== undefined && { allowedTools: content.allowedTools }),
      ...(content.resources !== undefined && { resources: content.resources }),
      ...(content.rating !== undefined && { rating: content.rating }),
      ...(content.category !== undefined && { category: content.category }),
    };
  }

  private collectDynamicMetadata(options?: { tags?: string[]; includeHidden?: boolean }): SkillMetadata[] {
    const out: SkillMetadata[] = [];
    for (const content of this.dynamicContents.values()) {
      const meta = this.dynamicSkillMetadata(content);
      if (options?.tags?.length) {
        const tags = meta.tags ?? [];
        if (!options.tags.some((t) => tags.includes(t))) continue;
      }
      if (!options?.includeHidden && meta.hideFromDiscovery === true) continue;
      out.push(meta);
    }
    return out;
  }

  /**
   * Lightweight scorer for the dynamic overlay. The full TF-IDF in the
   * memory provider is unnecessary here because dynamic content already
   * passes through the provider when mutable; this overlay only fires when
   * the provider is read-only or rejected the index write, in which case a
   * substring match against name + description is the conservative behavior.
   */
  private searchDynamicOverlay(
    query: string,
    options: SkillSearchOptions | undefined,
    excludeIds: Set<string>,
  ): SkillSearchResult[] {
    const q = query.trim().toLowerCase();
    const minScore = options?.minScore ?? 0.1;
    const out: SkillSearchResult[] = [];
    for (const content of this.dynamicContents.values()) {
      const id = content.id;
      if (excludeIds.has(id)) continue;
      if (options?.excludeIds?.includes(id)) continue;
      const meta = this.dynamicSkillMetadata(content);
      if (options?.tags?.length) {
        const tags = meta.tags ?? [];
        if (!options.tags.some((t) => tags.includes(t))) continue;
      }

      const toolNames = content.tools.map((t) => t.name);
      let availableTools = toolNames;
      let missingTools: string[] = [];
      if (this.toolValidator) {
        const v = this.toolValidator.validate(toolNames);
        availableTools = v.available;
        missingTools = v.missing;
      }
      if (options?.requireAllTools && missingTools.length > 0) continue;
      if (options?.tools?.length) {
        const refSet = new Set(toolNames);
        if (!options.tools.some((t) => refSet.has(t))) continue;
      }

      const name = (meta.name ?? '').toLowerCase();
      const desc = (meta.description ?? '').toLowerCase();
      let score: number;
      if (q.length === 0) {
        score = 0.5; // matches all when no query supplied, mirroring the memory provider
      } else if (name.includes(q)) {
        score = 1.0;
      } else if (desc.includes(q)) {
        score = 0.5;
      } else {
        continue;
      }
      if (score < minScore) continue;

      out.push({ metadata: meta, score, availableTools, missingTools, source: 'local' });
    }
    return out;
  }

  /* -------------------- Subscriptions -------------------- */

  /**
   * Subscribe to skill change events.
   */
  subscribe(
    opts: { immediate?: boolean; filter?: (skill: SkillEntry) => boolean },
    cb: (event: SkillChangeEvent) => void,
  ): () => void {
    const filter = opts.filter ?? (() => true);

    if (opts.immediate) {
      cb({
        kind: 'reset',
        changeScope: 'global',
        version: this.version,
        snapshot: this.listAllInstances().filter(filter),
      });
    }

    return this.emitter.on((e) => cb({ ...e, snapshot: this.listAllInstances().filter(filter) }));
  }

  /* -------------------- Capabilities -------------------- */

  /**
   * Get MCP capabilities for skills.
   *
   * Declares the SEP-2640 (Skills Extension) capability when any skills are
   * registered, so conformant clients know to look for `skill://` resources
   * and `skill://index.json`. The extension carries no settings today; an
   * empty object signals support.
   *
   * The SEP itself targets `capabilities.extensions[<id>]` (per the
   * forthcoming SEP-2133 extensions surface). Until the upstream MCP
   * schema lands `extensions`, we ride the existing
   * `capabilities.experimental[<id>]` slot, which the schema accepts as
   * `Record<string, object>`. Both are emitted so clients on either side
   * of the schema cutover see the declaration.
   */
  getCapabilities(): Partial<ServerCapabilities> {
    if (!this.hasAny()) return {};
    return {
      experimental: {
        [SEP_2640_EXTENSION_ID]: {},
      },
      // `extensions` is forward-compat: ignored by clients that don't know
      // it, recognised by SEP-2640-aware clients once SEP-2133 lands.
      extensions: {
        [SEP_2640_EXTENSION_ID]: {},
      },
    } as Partial<ServerCapabilities>;
  }

  /**
   * SEP-2640 §Discovery: extra resource-template entries to include in
   * `skill://index.json` for parameterised skill namespaces. Default is
   * empty; hosts populate this via {@link addSep2640IndexTemplate}.
   */
  getSep2640IndexTemplates(): SkillIndexEntry[] {
    return [...this.sep2640IndexTemplates];
  }

  /**
   * Register an `mcp-resource-template` index entry.
   */
  addSep2640IndexTemplate(entry: SkillIndexEntry): void {
    if (entry.type !== 'mcp-resource-template') {
      throw new Error(`addSep2640IndexTemplate: entry.type must be "mcp-resource-template", got "${entry.type}"`);
    }
    this.sep2640IndexTemplates.push(entry);
    this.bump('reset');
  }

  /**
   * SEP-2640 ADR 2026-04-19: optional `type: "archive"` entries in the
   * index. Hosts that pack skills into ZIP/TAR resources for atomic delivery
   * register them here so `skill://index.json` advertises them.
   */
  getSep2640IndexArchives(): SkillIndexEntry[] {
    return [...this.sep2640IndexArchives];
  }

  addSep2640IndexArchive(entry: SkillIndexEntry): void {
    if (entry.type !== 'archive') {
      throw new Error(`addSep2640IndexArchive: entry.type must be "archive", got "${entry.type}"`);
    }
    this.sep2640IndexArchives.push(entry);
    this.bump('reset');
  }

  /**
   * SEP-2640 §Discovery — opt-in pointer to skill URIs from the server's
   * `instructions` field. When non-empty, the transport adapter prepends a
   * "Available skills:" block listing the URIs.
   */
  getSep2640InstructionUris(): string[] {
    return [...this.sep2640InstructionUris];
  }

  addSep2640InstructionUri(uri: string): void {
    if (!this.sep2640InstructionUris.includes(uri)) {
      this.sep2640InstructionUris.push(uri);
      // Notify observers (resource list, instructions consumers) so the
      // change propagates without a full re-init.
      this.bump('reset');
    }
  }

  /* -------------------- Validation -------------------- */

  /**
   * Validate all skills against the current tool registry.
   * Should be called after all tools (including from plugins/adapters) are registered.
   *
   * This method:
   * 1. Checks each skill's tool references against the tool registry
   * 2. Respects per-skill and registry-level validation modes
   * 3. Emits a 'validated' event with results
   * 4. Optionally throws if failOnInvalidSkills is enabled
   *
   * @returns Validation report for all skills
   * @throws SkillValidationError if failOnInvalidSkills is true and any skill fails
   */
  async validateAllTools(): Promise<SkillValidationReport> {
    const results: SkillValidationResult[] = [];
    const allInstances = this.listAllInstances();

    for (const entry of allInstances) {
      const instance = entry as SkillInstance;
      const toolNames = instance.getToolNames();

      // Determine validation mode: skill-level overrides registry-level
      const skillValidation = instance.metadata.toolValidation ?? this.options.defaultToolValidation ?? 'warn';

      // Skip validation entirely if mode is 'ignore'
      if (skillValidation === 'ignore') {
        results.push({
          skillId: instance.name,
          skillName: instance.name,
          status: 'valid',
          missingTools: [],
          hiddenTools: [],
          validationMode: skillValidation,
        });
        continue;
      }

      // Validate tools if validator is available
      if (this.toolValidator && toolNames.length > 0) {
        const validation = this.toolValidator.validate(toolNames);

        if (!validation.complete) {
          const status = skillValidation === 'strict' ? 'failed' : 'warning';

          if (skillValidation === 'warn') {
            // Log warning for 'warn' mode
            const warning = this.toolValidator.formatWarning(validation, instance.name);
            if (warning) {
              this.scope.logger.warn(warning);
            }
          }

          results.push({
            skillId: instance.name,
            skillName: instance.name,
            status,
            missingTools: validation.missing,
            hiddenTools: validation.hidden,
            validationMode: skillValidation,
          });
        } else {
          results.push({
            skillId: instance.name,
            skillName: instance.name,
            status: 'valid',
            missingTools: [],
            hiddenTools: [],
            validationMode: skillValidation,
          });
        }
      } else {
        // No validator or no tools - consider valid
        results.push({
          skillId: instance.name,
          skillName: instance.name,
          status: 'valid',
          missingTools: [],
          hiddenTools: [],
          validationMode: skillValidation,
        });
      }
    }

    // Build the report
    const failedCount = results.filter((r) => r.status === 'failed').length;
    const warningCount = results.filter((r) => r.status === 'warning').length;
    const report: SkillValidationReport = {
      results,
      isValid: failedCount === 0,
      totalSkills: results.length,
      failedCount,
      warningCount,
    };

    // Emit validation event
    this.emitter.emit({
      kind: 'validated',
      changeScope: 'global',
      version: this.version,
      snapshot: allInstances,
      validationReport: report,
    });

    // Throw if failOnInvalidSkills is enabled and there are failures
    if (this.options.failOnInvalidSkills && failedCount > 0) {
      throw SkillValidationError.fromReport(report);
    }

    return report;
  }

  /* -------------------- Dynamic registration -------------------- */

  /**
   * Register a skill at runtime from a fully-resolved SkillContent.
   * See {@link SkillRegistryInterface.registerSkillContent} for full contract.
   */
  async registerSkillContent(
    content: SkillContent,
    opts?: { source?: string },
  ): Promise<{ id: string; unregister: () => Promise<void> }> {
    if (!content || typeof content.id !== 'string' || content.id.length === 0) {
      throw new PublicMcpError('registerSkillContent: SkillContent.id is required', 'INVALID_PARAMS');
    }
    if (typeof content.name !== 'string' || content.name.length === 0) {
      throw new PublicMcpError('registerSkillContent: SkillContent.name is required', 'INVALID_PARAMS');
    }

    const id = content.id;

    // Replace if already registered with the same id
    const existingIdx = this.dynamicRows.findIndex((r) => r.instance.name === id);
    if (existingIdx !== -1) {
      this.dynamicRows.splice(existingIdx, 1);
    }

    // Synthesize a SkillValueRecord from the SkillContent
    const metadata: SkillMetadata = {
      id,
      name: content.name,
      description: content.description,
      // SkillInstructionSource accepts a plain string for inline instructions
      instructions: content.instructions,
      tools: content.tools.map((t) => ({
        name: t.name,
        ...(t.purpose !== undefined && { purpose: t.purpose }),
        ...(t.required !== undefined && { required: t.required }),
      })),
      ...(content.parameters && { parameters: content.parameters }),
      ...(content.examples && { examples: content.examples }),
      ...(content.license && { license: content.license }),
      ...(content.compatibility && { compatibility: content.compatibility }),
      ...(content.specMetadata && { specMetadata: content.specMetadata }),
      ...(content.allowedTools && { allowedTools: content.allowedTools }),
      ...(content.resources && { resources: content.resources }),
      ...(content.rating !== undefined && { rating: content.rating }),
      ...(content.category && { category: content.category }),
    };

    const provideToken = Symbol(`dynamic-skill:${id}`);
    const record: SkillValueRecord = {
      kind: SkillKind.VALUE,
      provide: provideToken,
      metadata,
    };

    const instance = createSkillInstance(record, this.providers, this.owner);
    // Pre-load instructions so subsequent loads return the same content (no file/URL
    // resolution: instructions came in as an inline string).
    try {
      await instance.load();
    } catch (error) {
      this.scope.logger.warn(
        `[SkillRegistry] Failed to pre-load dynamic skill ${id} from source ${opts?.source ?? 'unknown'}: ${
          (error as Error).message
        }`,
      );
    }

    const lineage: EntryLineage = this.owner ? [this.owner] : [];
    const row = this.makeRow(provideToken, instance, lineage, this);
    this.dynamicRows.push(row);
    // Deep-clone so later mutation of the caller's object cannot silently
    // rewrite registry state without going through register/unregister.
    this.dynamicContents.set(id, structuredClone(content));

    // Bump the generation BEFORE wiring the unregister handle so the closure
    // captures this registration's generation and not a stale earlier value.
    const generation = (this.dynamicGenerations.get(id) ?? 0) + 1;
    this.dynamicGenerations.set(id, generation);

    // Push the original SkillContent (with actions/bundleVersion preserved) into
    // the storage provider so search/list/load see it unchanged. If the storage
    // provider isn't mutable (read-only external provider), skip silently — the
    // dynamicContents overlay merged into search/listSkills/count keeps these
    // skills visible regardless of provider mutability.
    const mutable = this.asMutableProvider(this.storageProvider);
    if (mutable) {
      try {
        if (await mutable.exists(id)) {
          await mutable.update(id, content);
        } else {
          await mutable.add(content);
        }
      } catch (error) {
        this.scope.logger.warn(
          `[SkillRegistry] Failed to index dynamic skill ${id} in storage provider: ${(error as Error).message}`,
        );
      }
    }

    this.reindex();
    this.bump('reset');

    // Generation-tagged handle: a later registerSkillContent for the same id
    // bumps the generation counter, so a caller still holding this earlier
    // handle who calls unregister() after the replacement lands becomes a
    // no-op instead of removing the newer registration.
    let unregistered = false;
    const unregister = async (): Promise<void> => {
      if (unregistered) return;
      unregistered = true;
      if (this.dynamicGenerations.get(id) !== generation) {
        // Stale handle: a newer registration replaced ours. Do not remove it.
        return;
      }
      await this.unregisterSkill(id);
    };

    this.scope.logger.debug(
      `[SkillRegistry] Registered dynamic skill ${id}${opts?.source ? ` (source: ${opts.source})` : ''}`,
    );

    return { id, unregister };
  }

  /**
   * Remove a previously-registered dynamic skill by id.
   */
  async unregisterSkill(id: string): Promise<boolean> {
    const idx = this.dynamicRows.findIndex((r) => r.instance.name === id);
    if (idx === -1) return false;

    this.dynamicRows.splice(idx, 1);
    this.dynamicContents.delete(id);
    this.dynamicGenerations.delete(id);

    const mutable = this.asMutableProvider(this.storageProvider);
    if (mutable) {
      try {
        await mutable.remove(id);
      } catch (error) {
        this.scope.logger.warn(
          `[SkillRegistry] Failed to remove dynamic skill ${id} from storage provider: ${(error as Error).message}`,
        );
      }
    }

    this.reindex();
    this.bump('reset');
    this.scope.logger.debug(`[SkillRegistry] Unregistered dynamic skill ${id}`);
    return true;
  }

  /* -------------------- Internal helpers -------------------- */

  private asMutableProvider(provider: SkillStorageProvider): MutableSkillStorageProvider | undefined {
    const candidate = provider as Partial<MutableSkillStorageProvider>;
    if (
      typeof candidate.add === 'function' &&
      typeof candidate.update === 'function' &&
      typeof candidate.remove === 'function' &&
      typeof candidate.exists === 'function'
    ) {
      return provider as MutableSkillStorageProvider;
    }
    return undefined;
  }

  private listAllIndexed(): IndexedSkill[] {
    return [...this.localRows, ...this.dynamicRows, ...[...this.adopted.values()].flat()];
  }

  private listAllInstances(): readonly SkillEntry[] {
    return this.listAllIndexed().map((r) => r.instance);
  }

  private reindex(): void {
    const effective = this.listAllIndexed();

    this.byQualifiedId.clear();
    this.byName.clear();
    this.byOwnerAndName.clear();

    for (const r of effective) {
      this.byQualifiedId.set(r.qualifiedId, r);

      const listByName = this.byName.get(r.baseName) ?? [];
      listByName.push(r);
      this.byName.set(r.baseName, listByName);

      const key = `${r.ownerKey}:${r.baseName}`;
      if (!this.byOwnerAndName.has(key)) {
        this.byOwnerAndName.set(key, r);
      }
    }
  }

  private makeRow(token: Token, instance: SkillInstance, lineage: EntryLineage, source: SkillRegistry): IndexedSkill {
    const ownerKey = ownerKeyOf(lineage);
    const baseName = instance.name;
    const qualifiedName = qualifiedNameOf(lineage, baseName);
    const qualifiedId = `${ownerKey}:${tokenName(token)}`;
    return { token, instance, baseName, lineage, ownerKey, qualifiedName, qualifiedId, source };
  }

  private relineage(row: IndexedSkill, prepend: EntryLineage): IndexedSkill {
    const lineage = [...prepend, ...row.lineage];
    const ownerKey = ownerKeyOf(lineage);
    const qualifiedName = qualifiedNameOf(lineage, row.baseName);
    const qualifiedId = `${ownerKey}:${tokenName(row.token)}`;

    return {
      token: row.token,
      instance: row.instance,
      baseName: row.baseName,
      lineage,
      ownerKey,
      qualifiedName,
      qualifiedId,
      source: row.source,
    };
  }

  private bump(kind: SkillChangeEvent['kind']): void {
    const version = ++this.version;
    this.emitter.emit({
      kind,
      changeScope: 'global',
      version,
      snapshot: this.listAllInstances(),
    });
  }

  /**
   * Set an external storage provider for skills.
   *
   * In read-only mode:
   * - Search/list/load operations will query the external provider
   *
   * In persistent mode:
   * - Local skills will be synced to external storage on syncToExternal()
   * - Search/list/load operations still use local storage
   *
   * @param provider - External provider instance extending ExternalSkillProviderBase
   */
  setExternalProvider(provider: ExternalSkillProviderBase): void {
    this.externalProvider = provider;

    // In read-only mode, use external provider as the primary storage
    if (provider.isReadOnly()) {
      this.storageProvider = provider;
      this.scope.logger.info('[SkillRegistry] Using external provider in read-only mode');
    } else {
      // In persistent mode, keep local storage but enable sync
      this.scope.logger.info('[SkillRegistry] External provider configured for persistent sync');
    }
  }

  /**
   * Get the external provider if one is configured.
   */
  getExternalProvider(): ExternalSkillProviderBase | undefined {
    return this.externalProvider;
  }

  /**
   * Check if the registry has an external provider.
   */
  hasExternalProvider(): boolean {
    return this.externalProvider !== undefined;
  }

  /**
   * Sync local skills to external storage.
   *
   * This method:
   * 1. Collects all local skill content
   * 2. Calls syncSkills on the external provider
   * 3. Returns the sync result with changes detected
   *
   * Only available when an external provider in persistent mode is configured.
   *
   * @returns Sync result or null if no external provider or in read-only mode
   *
   * @example
   * ```typescript
   * const result = await registry.syncToExternal();
   * if (result) {
   *   console.log(`Synced: ${result.added.length} added, ${result.updated.length} updated`);
   * }
   * ```
   */
  async syncToExternal(): Promise<SyncResult | null> {
    if (!this.externalProvider) {
      this.scope.logger.debug('[SkillRegistry] No external provider configured, skipping sync');
      return null;
    }

    if (this.externalProvider.isReadOnly()) {
      this.scope.logger.debug('[SkillRegistry] External provider is read-only, skipping sync');
      return null;
    }

    // Collect all local skill content
    const localSkills: SkillContent[] = [];
    const allIndexed = this.listAllIndexed();

    for (const row of allIndexed) {
      try {
        const content = await row.instance.load();
        localSkills.push(content);
      } catch (error) {
        this.scope.logger.warn(`[SkillRegistry] Failed to load skill for sync: ${row.baseName}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.scope.logger.info('[SkillRegistry] Starting external sync', { skillCount: localSkills.length });

    const result = await this.externalProvider.syncSkills(localSkills);

    this.scope.logger.info('[SkillRegistry] External sync complete', {
      added: result.added.length,
      updated: result.updated.length,
      unchanged: result.unchanged.length,
      removed: result.removed.length,
      failed: result.failed.length,
      durationMs: result.durationMs,
    });

    // Emit sync event
    this.emitter.emit({
      kind: 'synced',
      changeScope: 'global',
      version: this.version,
      snapshot: this.listAllInstances(),
      syncResult: result,
    });

    return result;
  }
}
