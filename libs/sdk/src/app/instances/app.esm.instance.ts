/**
 * @file app.esm.instance.ts
 * @description ESM-loaded app instance that dynamically imports npm packages via esm.sh.
 *
 * Unlike AppRemoteInstance (which proxies to a remote MCP server),
 * AppEsmInstance loads the package code locally and executes in-process.
 */

import {
  AdapterRegistryInterface,
  AppEntry,
  AppRecord,
  PluginRegistryInterface,
  PromptRegistryInterface,
  ProviderRegistryInterface,
  RemoteAppMetadata,
  ResourceRegistryInterface,
  ToolRegistryInterface,
  EntryOwnerRef,
  PluginEntry,
  AdapterEntry,
  SkillEntry,
} from '../../common';
import type { SkillRegistryInterface } from '../../skill/skill.registry';
import { idFromString } from '@frontmcp/utils';
import ProviderRegistry from '../../provider/provider.registry';
import ToolRegistry from '../../tool/tool.registry';
import ResourceRegistry from '../../resource/resource.registry';
import PromptRegistry from '../../prompt/prompt.registry';
import { EsmModuleLoader, EsmCacheManager } from '../../esm-loader';
import type { EsmRegistryAuth } from '../../esm-loader/esm-auth.types';
import { parsePackageSpecifier } from '../../esm-loader/package-specifier';
import { VersionPoller } from '../../esm-loader/version-poller';
import type { FrontMcpPackageManifest } from '../../esm-loader/esm-manifest';
import type { EsmLoadResult } from '../../esm-loader/esm-module-loader';
import type { ParsedPackageSpecifier } from '../../esm-loader/package-specifier';
import { createEsmToolInstance, createEsmPromptInstance, createEsmResourceInstance } from '../../esm-loader/factories';
import {
  normalizeToolFromEsmExport,
  normalizeResourceFromEsmExport,
  normalizePromptFromEsmExport,
  isDecoratedToolClass,
  isDecoratedResourceClass,
  isDecoratedPromptClass,
} from './esm-normalize.utils';
import { normalizeTool } from '../../tool/tool.utils';
import { ToolInstance } from '../../tool/tool.instance';
import { normalizeResource } from '../../resource/resource.utils';
import { ResourceInstance } from '../../resource/resource.instance';
import { normalizePrompt } from '../../prompt/prompt.utils';
import { PromptInstance } from '../../prompt/prompt.instance';

/**
 * Empty plugin registry for ESM apps.
 */
class EmptyPluginRegistry implements PluginRegistryInterface {
  getPlugins(): PluginEntry[] {
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
  getExternalProvider() {
    return undefined;
  }
  hasExternalProvider() {
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

  // Standard registries
  private readonly _tools: ToolRegistry;
  private readonly _resources: ResourceRegistry;
  private readonly _prompts: PromptRegistry;
  private readonly _plugins: EmptyPluginRegistry;
  private readonly _adapters: EmptyAdapterRegistry;
  private readonly _skills: EmptySkillRegistry;

  constructor(record: AppRecord, scopeProviders: ProviderRegistry) {
    super(record);
    this.id = this.metadata.id ?? idFromString(this.metadata.name);
    this.scopeProviders = scopeProviders;

    this.appOwner = {
      kind: 'app',
      id: this.id,
      ref: this.token,
    };

    // Parse the package specifier from the url field
    this.specifier = parsePackageSpecifier(this.metadata.url);

    // Merge gateway-level loader with app-level packageConfig.loader
    const scopeMetadata = scopeProviders.getActiveScope().metadata;
    const appConfig = this.metadata.packageConfig;
    const mergedLoader = appConfig?.loader ?? scopeMetadata.loader;

    // Map public PackageLoader → internal EsmRegistryAuth + esmShBaseUrl
    const registryAuth: EsmRegistryAuth | undefined = mergedLoader
      ? {
          registryUrl: mergedLoader.registryUrl ?? mergedLoader.url,
          token: mergedLoader.token,
          tokenEnvVar: mergedLoader.tokenEnvVar,
        }
      : undefined;
    const esmShBaseUrl = mergedLoader?.url;

    // Initialize the ESM module loader with cache
    const cache = new EsmCacheManager({
      maxAgeMs: appConfig?.cacheTTL,
    });

    this.loader = new EsmModuleLoader({
      cache,
      registryAuth,
      logger: scopeProviders.getActiveScope().logger,
      esmShBaseUrl,
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
        // Re-derive registryAuth from merged loader for the poller
        const scopeMeta = this.scopeProviders.getActiveScope().metadata;
        const pollerLoader = this.metadata.packageConfig?.loader ?? scopeMeta.loader;
        const pollerRegistryAuth: EsmRegistryAuth | undefined = pollerLoader
          ? {
              registryUrl: pollerLoader.registryUrl ?? pollerLoader.url,
              token: pollerLoader.token,
              tokenEnvVar: pollerLoader.tokenEnvVar,
            }
          : undefined;

        this.poller = new VersionPoller({
          intervalMs: autoUpdate.intervalMs,
          registryAuth: pollerRegistryAuth,
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

  override get tools(): ToolRegistryInterface {
    return this._tools;
  }

  override get resources(): ResourceRegistryInterface {
    return this._resources;
  }

  override get prompts(): PromptRegistryInterface {
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

    this.loadResult = await this.loader.load(this.specifier);
    await this.registerFromManifest(this.loadResult.manifest);

    if (this.poller) {
      this.poller.updateCurrentVersion(this.specifier.fullName, this.loadResult.resolvedVersion);
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
   * Register primitives from a loaded package manifest into standard registries.
   */
  private async registerFromManifest(manifest: FrontMcpPackageManifest): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;
    const namespace = this.metadata.namespace ?? this.metadata.name;

    let toolCount = 0;
    let resourceCount = 0;
    let promptCount = 0;

    // Register tools
    if (manifest.tools?.length) {
      for (const rawTool of manifest.tools) {
        if (isDecoratedToolClass(rawTool)) {
          // Real @Tool-decorated class → standard normalization (full DI)
          const record = normalizeTool(rawTool);
          const prefixedName = namespace ? `${namespace}:${record.metadata.name}` : record.metadata.name;
          record.metadata.name = prefixedName;
          record.metadata.id = prefixedName;
          const instance = new ToolInstance(record, this.scopeProviders, this.appOwner);
          await instance.ready;
          this._tools.registerToolInstance(instance);
          toolCount++;
        } else {
          // Plain object → existing path
          const toolDef = normalizeToolFromEsmExport(rawTool);
          if (toolDef) {
            const instance = createEsmToolInstance(toolDef, this.scopeProviders, this.appOwner, namespace);
            await instance.ready;
            this._tools.registerToolInstance(instance);
            toolCount++;
          }
        }
      }
    }

    // Register resources
    if (manifest.resources?.length) {
      for (const rawResource of manifest.resources) {
        if (isDecoratedResourceClass(rawResource)) {
          // Real @Resource-decorated class → standard normalization (full DI)
          const record = normalizeResource(rawResource);
          const prefixedName = namespace ? `${namespace}:${record.metadata.name}` : record.metadata.name;
          record.metadata.name = prefixedName;
          const instance = new ResourceInstance(record, this.scopeProviders, this.appOwner);
          await instance.ready;
          this._resources.registerResourceInstance(instance);
          resourceCount++;
        } else {
          // Plain object → existing path
          const resourceDef = normalizeResourceFromEsmExport(rawResource);
          if (resourceDef) {
            const instance = createEsmResourceInstance(resourceDef, this.scopeProviders, this.appOwner, namespace);
            await instance.ready;
            this._resources.registerResourceInstance(instance);
            resourceCount++;
          }
        }
      }
    }

    // Register prompts
    if (manifest.prompts?.length) {
      for (const rawPrompt of manifest.prompts) {
        if (isDecoratedPromptClass(rawPrompt)) {
          // Real @Prompt-decorated class → standard normalization (full DI)
          const record = normalizePrompt(rawPrompt);
          const prefixedName = namespace ? `${namespace}:${record.metadata.name}` : record.metadata.name;
          record.metadata.name = prefixedName;
          const instance = new PromptInstance(record, this.scopeProviders, this.appOwner);
          await instance.ready;
          this._prompts.registerPromptInstance(instance);
          promptCount++;
        } else {
          // Plain object → existing path
          const promptDef = normalizePromptFromEsmExport(rawPrompt);
          if (promptDef) {
            const instance = createEsmPromptInstance(promptDef, this.scopeProviders, this.appOwner, namespace);
            await instance.ready;
            this._prompts.registerPromptInstance(instance);
            promptCount++;
          }
        }
      }
    }

    logger.info(
      `ESM app ${this.id} registered: ${toolCount} tools, ${resourceCount} resources, ${promptCount} prompts`,
    );
  }

  /**
   * Handle a new version detected by the version poller.
   */
  private async handleVersionUpdate(_packageName: string, oldVersion: string, newVersion: string): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;
    logger.info(`Updating ESM app ${this.id}: ${oldVersion} → ${newVersion}`);

    try {
      // Reload the package
      this.loadResult = await this.loader.load(this.specifier);

      // Replace all registrations with the new manifest's primitives.
      // replaceAll emits change events, notifying connected MCP clients.
      this._tools.replaceAll([], this.appOwner);
      this._resources.replaceAll([], this.appOwner);
      this._prompts.replaceAll([], this.appOwner);

      await this.registerFromManifest(this.loadResult.manifest);

      logger.info(`ESM app ${this.id} updated to ${newVersion}`);
    } catch (error) {
      logger.error(`Failed to update ESM app ${this.id} to ${newVersion}: ${(error as Error).message}`);
    }
  }
}
