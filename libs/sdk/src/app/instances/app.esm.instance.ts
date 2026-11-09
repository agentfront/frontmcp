/**
 * @file app.esm.instance.ts
 * @description ESM-loaded app instance that dynamically imports npm packages via esm.sh.
 *
 * Unlike AppRemoteInstance (which proxies to a remote MCP server),
 * AppEsmInstance loads the package code locally and executes in-process.
 */

import {
  AppEntry,
  type AdapterEntry,
  type AdapterRegistryInterface,
  type AppRecord,
  type EntryOwnerRef,
  type PluginInstance,
  type PluginRegistryInterface,
  type ProviderRegistryInterface,
  type RemoteAppMetadata,
  type SkillEntry,
} from '../../common';
import { isPrimitiveIncluded } from '../../common/utils/primitive-filter';
import { InternalMcpError } from '../../errors';
import { type EsmModuleLoader } from '../../esm-loader';
import {
  createPackageModuleLoader,
  esmManifestRecords,
  esmPromptRecord,
  esmResourceRecord,
  esmToolRecord,
  registryAuthOf,
} from '../../esm-loader/esm-entries';
import { type FrontMcpPackageManifest } from '../../esm-loader/esm-manifest';
import { type EsmLoadResult } from '../../esm-loader/esm-module-loader';
import { parsePackageSpecifier, type ParsedPackageSpecifier } from '../../esm-loader/package-specifier';
import { VersionPoller } from '../../esm-loader/version-poller';
import { PromptInstance } from '../../prompt/prompt.instance';
import PromptRegistry from '../../prompt/prompt.registry';
import type ProviderRegistry from '../../provider/provider.registry';
import { ResourceInstance } from '../../resource/resource.instance';
import ResourceRegistry from '../../resource/resource.registry';
import { type SkillRegistryInterface } from '../../skill/skill.registry';
import { ToolInstance } from '../../tool/tool.instance';
import ToolRegistry from '../../tool/tool.registry';
import { appIdOf } from '../app.utils';

/** The kinds of entry a package manifest may export that an ESM app does not load. */
const UNLOADED_MANIFEST_KINDS = ['skills', 'agents', 'jobs', 'workflows', 'providers'] as const;

/**
 * Empty plugin registry for ESM apps.
 */
class EmptyPluginRegistry implements PluginRegistryInterface {
  getPlugins(): PluginInstance[] {
    return [];
  }
  getPluginNames(): string[] {
    return [];
  }
}

/**
 * Empty adapter registry for ESM apps.
 */
class EmptyAdapterRegistry implements AdapterRegistryInterface {
  getAdapters(): AdapterEntry[] {
    return [];
  }
}

/**
 * Empty skill registry for ESM apps.
 */
class EmptySkillRegistry implements SkillRegistryInterface {
  readonly owner = { kind: 'app' as const, id: '_esm', ref: EmptySkillRegistry };
  getSkills(): SkillEntry[] {
    return [];
  }
  getExecutableSkills(): SkillEntry[] {
    return [];
  }
  getKnowledgeOnlySkills(): SkillEntry[] {
    return [];
  }
  findByName(): SkillEntry | undefined {
    return undefined;
  }
  findByQualifiedName(): SkillEntry | undefined {
    return undefined;
  }
  async search(): Promise<[]> {
    return [];
  }
  async loadSkill(): Promise<undefined> {
    return undefined;
  }
  async listSkills() {
    return { skills: [], total: 0, hasMore: false };
  }
  hasAny(): boolean {
    return false;
  }
  async count(): Promise<number> {
    return 0;
  }
  subscribe(): () => void {
    return () => {};
  }
  notifyListChanged(): void {}
  getCapabilities() {
    return {};
  }
  async validateAllTools() {
    return {
      results: [],
      isValid: true,
      totalSkills: 0,
      failedCount: 0,
      warningCount: 0,
    };
  }
  async syncToExternal() {
    return null;
  }
  setExternalProvider() {
    return undefined;
  }
  getExternalProvider() {
    return undefined;
  }
  hasExternalProvider() {
    return false;
  }
  async registerSkillContent(): Promise<{ id: string; unregister: () => Promise<void> }> {
    throw new InternalMcpError('registerSkillContent is not supported on ESM apps', 'UNSUPPORTED_OPERATION');
  }
  async unregisterSkill(): Promise<boolean> {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// APP ESM INSTANCE
// ═══════════════════════════════════════════════════════════════════

/**
 * ESM app instance that loads npm packages via esm.sh CDN
 * and executes their code locally in-process.
 *
 * Key features:
 * - Dynamic import of npm packages at runtime
 * - Local file-based caching of ESM bundles
 * - Background version polling with semver range checking
 * - Hot-reload when new versions are detected
 * - Standard registry integration (hooks, events, etc.)
 */
export class AppEsmInstance extends AppEntry<RemoteAppMetadata> {
  override readonly id: string;

  override get isRemote(): boolean {
    return true;
  }

  private readonly scopeProviders: ProviderRegistry;
  private readonly appOwner: EntryOwnerRef;
  private readonly loader: EsmModuleLoader;
  private readonly specifier: ParsedPackageSpecifier;
  private poller?: VersionPoller;
  private loadResult?: EsmLoadResult;
  private updateInProgress = false;
  private registered: EsmAppEntries = { tools: [], resources: [], prompts: [] };

  // Standard registries
  private readonly _tools: ToolRegistry;
  private readonly _resources: ResourceRegistry;
  private readonly _prompts: PromptRegistry;
  private readonly _plugins: EmptyPluginRegistry;
  private readonly _adapters: EmptyAdapterRegistry;
  private readonly _skills: EmptySkillRegistry;

  constructor(record: AppRecord, scopeProviders: ProviderRegistry) {
    super(record);
    this.id = appIdOf(this.metadata);
    this.scopeProviders = scopeProviders;

    this.appOwner = {
      kind: 'app',
      id: this.id,
      ref: this.token,
    };

    // Parse the package specifier from the url field
    this.specifier = parsePackageSpecifier(this.metadata.url);

    // Merge gateway-level loader with app-level packageConfig.loader
    const scope = scopeProviders.getActiveScope();
    const appConfig = this.metadata.packageConfig;
    this.loader = createPackageModuleLoader({
      loader: appConfig?.loader ?? scope.metadata.loader,
      cacheTTL: appConfig?.cacheTTL,
      importMap: appConfig?.importMap,
      logger: scope.logger,
    });

    // Initialize standard registries (empty initially - populated on load)
    this._tools = new ToolRegistry(this.scopeProviders, [], this.appOwner);
    this._resources = new ResourceRegistry(this.scopeProviders, [], this.appOwner);
    this._prompts = new PromptRegistry(this.scopeProviders, [], this.appOwner);
    this._plugins = new EmptyPluginRegistry();
    this._adapters = new EmptyAdapterRegistry();
    this._skills = new EmptySkillRegistry();

    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;
    logger.info(`Initializing ESM app: ${this.id} (${this.specifier.fullName}@${this.specifier.range})`);

    try {
      // Wait for registries to be ready
      await Promise.all([this._tools.ready, this._resources.ready, this._prompts.ready]);

      // Load the ESM package
      this.loadResult = await this.loader.load(this.specifier);
      logger.info(
        `Loaded ESM package ${this.specifier.fullName}@${this.loadResult.resolvedVersion} ` +
          `(source: ${this.loadResult.source})`,
      );

      // Register primitives from the manifest
      await this.registerFromManifest(this.loadResult.manifest);

      // Start version poller if auto-update is enabled
      const autoUpdate = this.metadata.packageConfig?.autoUpdate;
      if (autoUpdate?.enabled) {
        const scopeMeta = this.scopeProviders.getActiveScope().metadata;
        const pollerLoader = this.metadata.packageConfig?.loader ?? scopeMeta.loader;

        this.poller = new VersionPoller({
          intervalMs: autoUpdate.intervalMs,
          registryAuth: registryAuthOf(pollerLoader),
          logger,
          onNewVersion: (pkg, oldVer, newVer) => this.handleVersionUpdate(pkg, oldVer, newVer),
        });
        this.poller.addPackage(this.specifier, this.loadResult.resolvedVersion);
        this.poller.start();
      }
    } catch (error) {
      logger.error(`Failed to initialize ESM app ${this.id}: ${(error as Error).message}`);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════

  override get providers(): ProviderRegistryInterface {
    return this.scopeProviders;
  }

  override get adapters(): AdapterRegistryInterface {
    return this._adapters;
  }

  override get plugins(): PluginRegistryInterface {
    return this._plugins;
  }

  override get tools(): ToolRegistry {
    return this._tools;
  }

  override get resources(): ResourceRegistry {
    return this._resources;
  }

  override get prompts(): PromptRegistry {
    return this._prompts;
  }

  override get skills(): SkillRegistryInterface {
    return this._skills;
  }

  /**
   * Get the currently loaded package version.
   */
  getLoadedVersion(): string | undefined {
    return this.loadResult?.resolvedVersion;
  }

  /**
   * Get the package specifier.
   */
  getSpecifier(): ParsedPackageSpecifier {
    return this.specifier;
  }

  /**
   * Force reload the package (useful for manual updates).
   */
  async reload(): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;
    logger.info(`Reloading ESM app ${this.id}`);

    const loadResult = await this.loader.load(this.specifier);
    await this.registerFromManifest(loadResult.manifest);
    this.loadResult = loadResult;

    if (this.poller) {
      this.poller.updateCurrentVersion(this.specifier.fullName, loadResult.resolvedVersion);
    }
  }

  /**
   * Stop the version poller and clean up.
   */
  async dispose(): Promise<void> {
    this.poller?.stop();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Register primitives from a loaded package manifest into standard registries, in place of the ones registered
   * before. Every entry is built first, so an entry that fails to build leaves the previous ones registered.
   */
  private async registerFromManifest(manifest: FrontMcpPackageManifest): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;
    const namespace = this.metadata.namespace ?? this.metadata.name;

    // Before any entry is built, so a tool that fails on a missing manifest provider follows the warning.
    const notLoaded = UNLOADED_MANIFEST_KINDS.filter((kind) => (manifest[kind]?.length ?? 0) > 0);
    if (notLoaded.length > 0) {
      logger.warn(
        `ESM app ${this.id}: App.esm() loads only tools, resources and prompts; ` +
          `the package's ${notLoaded.join(', ')} are not loaded`,
      );
    }

    const filter = this.metadata.filter;
    const prefixLength = namespace ? namespace.length + 1 : 0;
    const included =
      (kind: 'tools' | 'resources' | 'prompts') =>
      (record: { metadata: { name: string } }): boolean =>
        isPrimitiveIncluded(record.metadata.name.slice(prefixLength), kind, filter);

    const tools = esmManifestRecords(manifest.tools, (raw) => esmToolRecord(raw, namespace)).filter(included('tools'));
    const resources = esmManifestRecords(manifest.resources, (raw) => esmResourceRecord(raw, namespace)).filter(
      included('resources'),
    );
    const prompts = esmManifestRecords(manifest.prompts, (raw) => esmPromptRecord(raw, namespace)).filter(
      included('prompts'),
    );

    const entries: EsmAppEntries = {
      tools: await Promise.all(
        tools.map((record) => readyInstance(new ToolInstance(record, this.scopeProviders, this.appOwner))),
      ),
      resources: await Promise.all(
        resources.map((record) => readyInstance(new ResourceInstance(record, this.scopeProviders, this.appOwner))),
      ),
      prompts: await Promise.all(
        prompts.map((record) => readyInstance(new PromptInstance(record, this.scopeProviders, this.appOwner))),
      ),
    };
    this.swapEntries(entries);

    logger.info(
      `ESM app ${this.id} registered: ${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`,
    );
  }

  /**
   * Handle a new version detected by the version poller.
   */
  private async handleVersionUpdate(_packageName: string, oldVersion: string, newVersion: string): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;

    if (this.updateInProgress) {
      throw new InternalMcpError(`An update of ESM app ${this.id} is already in progress`, 'ESM_UPDATE_IN_PROGRESS');
    }
    this.updateInProgress = true;

    logger.info(`Updating ESM app ${this.id}: ${oldVersion} → ${newVersion}`);

    try {
      const loadResult = await this.loader.load(this.specifier);
      await this.registerFromManifest(loadResult.manifest);
      this.loadResult = loadResult;

      logger.info(`ESM app ${this.id} updated to ${newVersion}`);
    } catch (error) {
      logger.error(`Failed to update ESM app ${this.id} to ${newVersion}: ${(error as Error).message}`);
      throw error;
    } finally {
      this.updateInProgress = false;
    }
  }

  /** Registers `next` in place of the registered entries; if one fails to register, the previous ones are put back. */
  private swapEntries(next: EsmAppEntries): void {
    const previous = this.registered;
    this.unregisterEntries(previous);
    try {
      this.registerEntries(next);
    } catch (error) {
      this.unregisterEntries(next);
      this.registerEntries(previous);
      throw error;
    }
    this.registered = next;
  }

  private registerEntries(entries: EsmAppEntries): void {
    for (const tool of entries.tools) this._tools.registerToolInstance(tool);
    for (const resource of entries.resources) this._resources.registerResourceInstance(resource);
    for (const prompt of entries.prompts) this._prompts.registerPromptInstance(prompt);
  }

  private unregisterEntries(entries: EsmAppEntries): void {
    for (const tool of entries.tools) this._tools.unregisterToolInstance(tool.record.provide);
    for (const resource of entries.resources) this._resources.unregisterResourceInstance(resource.record.provide);
    for (const prompt of entries.prompts) this._prompts.unregisterPromptInstance(prompt.record.provide);
  }
}

/** The entries an ESM app registered from its package. */
interface EsmAppEntries {
  tools: ToolInstance[];
  resources: ResourceInstance[];
  prompts: PromptInstance[];
}

async function readyInstance<T extends { ready: Promise<void> }>(instance: T): Promise<T> {
  await instance.ready;
  return instance;
}
