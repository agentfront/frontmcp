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
   */
  async search(query: string, options?: SkillSearchOptions): Promise<SkillSearchResult[]> {
    return this.storageProvider.search(query, options);
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
      const toolNames = dynamic.tools.map((t) => t.name);
      let availableTools = toolNames;
      let missingTools: string[] = [];
      let isComplete = true;
      let warning: string | undefined;
      if (this.toolValidator) {
        const validation = this.toolValidator.validate(toolNames);
        availableTools = validation.available;
        missingTools = validation.missing;
        isComplete = validation.complete;
        warning = this.toolValidator.formatWarning(validation, dynamic.name);
      }
      return { skill: dynamic, availableTools, missingTools, isComplete, warning };
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
   * List skills with pagination.
   */
  async listSkills(options?: SkillListOptions): Promise<SkillListResult> {
    return this.storageProvider.list(options);
  }

  /**
   * Check if any skills exist.
   */
  hasAny(): boolean {
    return this.listAllIndexed().length > 0;
  }

  /**
   * Get total skill count.
   */
  async count(options?: { tags?: string[]; includeHidden?: boolean }): Promise<number> {
    return this.storageProvider.count(options);
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
   */
  getCapabilities(): Partial<ServerCapabilities> {
    // Skills don't have dedicated MCP capabilities yet
    // They're exposed via searchSkills and loadSkill tools
    return {};
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
      throw new Error('registerSkillContent: SkillContent.id is required');
    }
    if (typeof content.name !== 'string' || content.name.length === 0) {
      throw new Error('registerSkillContent: SkillContent.name is required');
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
    this.dynamicContents.set(id, content);

    // Push the original SkillContent (with actions/bundleVersion preserved) into
    // the storage provider so search/list/load see it unchanged. If the storage
    // provider isn't mutable (read-only external provider), skip silently — the
    // dynamicRows path still serves getSkills/findByName/loadSkill via the registry.
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

    let unregistered = false;
    const unregister = async (): Promise<void> => {
      if (unregistered) return;
      unregistered = true;
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
      typeof candidate.remove === 'function'
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
