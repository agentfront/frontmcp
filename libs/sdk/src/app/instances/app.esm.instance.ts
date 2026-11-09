/**
 * @file app.esm.instance.ts
 * @description ESM-loaded app instance that dynamically imports npm packages via esm.sh.
 *
 * Unlike AppRemoteInstance (which proxies to a remote MCP server),
 * AppEsmInstance loads the package code locally and executes in-process.
 */

import AgentRegistry from '../../agent/agent.registry';
import {
  AppEntry,
  type AdapterRegistryInterface,
  type AppRecord,
  type EntryOwnerRef,
  type PackageLoader,
  type PluginRegistryInterface,
  type ProviderRegistryInterface,
  type RemoteAppMetadata,
} from '../../common';
import { InternalMcpError } from '../../errors';
import { type EsmModuleLoader } from '../../esm-loader';
import { createPackageModuleLoader, mergePackageLoaders, registryAuthOf } from '../../esm-loader/esm-entries';
import { type FrontMcpPackageManifest } from '../../esm-loader/esm-manifest';
import { type EsmLoadResult } from '../../esm-loader/esm-module-loader';
import { parsePackageSpecifier, type ParsedPackageSpecifier } from '../../esm-loader/package-specifier';
import { VersionPoller } from '../../esm-loader/version-poller';
import PromptRegistry from '../../prompt/prompt.registry';
import ProviderRegistry from '../../provider/provider.registry';
import ResourceRegistry from '../../resource/resource.registry';
import SkillRegistry from '../../skill/skill.registry';
import ToolRegistry from '../../tool/tool.registry';
import { appIdOf } from '../app.utils';
import { EmptyAdapterRegistry, EmptyPluginRegistry } from './empty-app-registries';
import { EsmPackageVersion, type EsmPackageTarget } from './esm-package-version';

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
  /** The app's own providers, below the scope's; each loaded version registers the package's providers below them. */
  private readonly ownProviders: ProviderRegistry;
  private readonly appOwner: EntryOwnerRef;
  private readonly loader: EsmModuleLoader;
  private readonly packageLoader?: PackageLoader;
  private readonly specifier: ParsedPackageSpecifier;
  private poller?: VersionPoller;
  private loadResult?: EsmLoadResult;
  private updateInProgress = false;
  private registered?: EsmPackageVersion;
  /** For each version whose jobs and workflows the scope serves, the function that withdraws them. */
  private readonly jobWithdrawals = new Map<EsmPackageVersion, () => void>();

  // Standard registries
  private readonly _tools: ToolRegistry;
  private readonly _resources: ResourceRegistry;
  private readonly _prompts: PromptRegistry;
  private readonly _agents: AgentRegistry;
  private readonly _skills: SkillRegistry;
  private readonly _plugins: EmptyPluginRegistry;
  private readonly _adapters: EmptyAdapterRegistry;

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

    const scope = scopeProviders.getActiveScope();
    const appConfig = this.metadata.packageConfig;
    this.packageLoader = mergePackageLoaders(scope.metadata.loader, appConfig?.loader);
    this.loader = createPackageModuleLoader({
      loader: this.packageLoader,
      cacheTTL: appConfig?.cacheTTL,
      importMap: appConfig?.importMap,
      logger: scope.logger,
    });

    // Initialize standard registries (empty initially - populated on load). `adopt: false`: the scope adopts their
    // entries from this app, and they adopt nothing of the scope's.
    this.ownProviders = new ProviderRegistry([], scopeProviders);
    this._tools = new ToolRegistry(this.ownProviders, [], this.appOwner, { adopt: false });
    this._resources = new ResourceRegistry(this.ownProviders, [], this.appOwner, { adopt: false });
    this._prompts = new PromptRegistry(this.ownProviders, [], this.appOwner, { adopt: false });
    // The scope adopts these as a local app's: each loaded version's own registries are adopted into them.
    this._agents = new AgentRegistry(this.ownProviders, [], this.appOwner);
    this._skills = new SkillRegistry(this.ownProviders, [], this.appOwner);
    this._plugins = new EmptyPluginRegistry();
    this._adapters = new EmptyAdapterRegistry();

    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;
    logger.info(`Initializing ESM app: ${this.id} (${this.specifier.fullName}@${this.specifier.range})`);

    try {
      // Wait for registries to be ready
      await Promise.all([
        this.ownProviders.ready,
        this._tools.ready,
        this._resources.ready,
        this._prompts.ready,
        this._agents.ready,
        this._skills.ready,
      ]);
      this.scopeProviders.getActiveScope().onDispose(() => this.dispose());

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
        this.poller = new VersionPoller({
          intervalMs: autoUpdate.intervalMs,
          registryAuth: registryAuthOf(this.packageLoader),
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
    return this.ownProviders;
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

  override get skills(): SkillRegistry {
    return this._skills;
  }

  get agents(): AgentRegistry {
    return this._agents;
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
    await this.registerFromManifest(loadResult.manifest, { replacing: true });
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
   * Register the entries of a loaded package manifest in place of the ones registered before. Every entry is built
   * first, on the version's own providers, so an entry that fails to build leaves the previous version serving. A
   * version that replaces a served one has its providers' `onReady()` run before it is swapped in; the replaced
   * version's providers stay up, for the calls still running on its entries, until the server shuts down.
   */
  private async registerFromManifest(
    manifest: FrontMcpPackageManifest,
    { replacing }: { replacing: boolean } = { replacing: false },
  ): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;
    const next = await EsmPackageVersion.build(manifest, this.packageTarget());
    try {
      if (replacing) await next.providers.runReadyHooks(logger);
      await this.swapEntries(next, { replacing });
    } catch (error) {
      await next.discard(logger);
      throw error;
    }

    logger.info(`ESM app ${this.id} registered: ${next.describe()}`);
  }

  private packageTarget(): EsmPackageTarget {
    return {
      providers: this.ownProviders,
      owner: this.appOwner,
      namespace: this.metadata.namespace ?? this.metadata.name,
      filter: this.metadata.filter,
      logger: this.scopeProviders.getActiveScope().logger,
    };
  }

  /**
   * Handle a new version detected by the version poller.
   */
  private async handleVersionUpdate(_packageName: string, oldVersion: string, newVersion: string): Promise<void> {
    const scope = this.scopeProviders.getActiveScope();
    const logger = scope.logger;
    if (scope.isDisposed) return;

    if (this.updateInProgress) {
      throw new InternalMcpError(`An update of ESM app ${this.id} is already in progress`, 'ESM_UPDATE_IN_PROGRESS');
    }
    this.updateInProgress = true;

    logger.info(`Updating ESM app ${this.id}: ${oldVersion} → ${newVersion}`);

    try {
      const loadResult = await this.loader.load(this.specifier);
      await this.registerFromManifest(loadResult.manifest, { replacing: true });
      this.loadResult = loadResult;

      logger.info(`ESM app ${this.id} updated to ${newVersion}`);
    } catch (error) {
      logger.error(`Failed to update ESM app ${this.id} to ${newVersion}: ${(error as Error).message}`);
      throw error;
    } finally {
      this.updateInProgress = false;
    }
  }

  /**
   * Registers `next` in place of the registered entries; if one fails to register, the previous ones are put back.
   * Clients get one `list_changed` for each list the swap changed. A version that replaces one after startup gets
   * what startup gives an app: the scope serves its kinds of entry, and checks it as it checks every app.
   */
  private async swapEntries(next: EsmPackageVersion, { replacing }: { replacing: boolean }): Promise<void> {
    const scope = this.scopeProviders.getActiveScope();
    if (replacing) await scope.serveLateEntries(next.lateEntryKinds());
    await scope.batchListChanges(async (batch) => {
      const previous = this.registered;
      if (previous) this.unregisterEntries(previous);
      try {
        await this.registerEntries(next);
        if (replacing) await scope.checkLateApp(this);
      } catch (error) {
        this.unregisterEntries(next);
        if (previous) await this.registerEntries(previous);
        batch.listsRestored();
        throw error;
      }
    });
    this.registered = next;
  }

  private async registerEntries(version: EsmPackageVersion): Promise<void> {
    const { tools, resources, prompts, agents, skills, jobs, workflows } = version.entries;
    for (const tool of tools) this._tools.registerToolInstance(tool);
    for (const resource of resources) this._resources.registerResourceInstance(resource);
    for (const prompt of prompts) this._prompts.registerPromptInstance(prompt);
    if (agents) this._agents.adoptFromChild(agents, agents.owner);
    if (skills) await this._skills.adoptFromChild(skills, skills.owner);
    if (jobs.length > 0 || workflows.length > 0) {
      const scope = this.scopeProviders.getActiveScope();
      this.jobWithdrawals.set(version, await scope.serveAppJobs({ jobs, workflows, providers: version.providers }));
    }
  }

  private unregisterEntries(version: EsmPackageVersion): void {
    const { tools, resources, prompts, agents, skills } = version.entries;
    for (const tool of tools) this._tools.unregisterToolInstance(tool.record.provide);
    for (const resource of resources) this._resources.unregisterResourceInstance(resource.record.provide);
    for (const prompt of prompts) this._prompts.unregisterPromptInstance(prompt.record.provide);
    if (agents) this._agents.removeChild(agents);
    if (skills) this._skills.removeChild(skills);
    this.jobWithdrawals.get(version)?.();
    this.jobWithdrawals.delete(version);
  }
}
