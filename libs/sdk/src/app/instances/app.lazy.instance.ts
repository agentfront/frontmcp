import { getMetadata, isClass, type Type } from '@frontmcp/di';
import type { GetPromptResult, ReadResourceResult } from '@frontmcp/protocol';
import { isProduction } from '@frontmcp/utils';

import type AdapterRegistry from '../../adapter/adapter.registry';
import {
  AppEntry,
  FrontMcpLocalAppTokens,
  PromptContext,
  PromptKind,
  ResourceContext,
  ResourceKind,
  ResourceTemplateKind,
  ToolContext,
  ToolKind,
  type AdapterRegistryInterface,
  type AppRecord,
  type AppType,
  type EntryOwnerRef,
  type HookEntry,
  type LazyAppRecordMetadata,
  type ListChangedKind,
  type LocalAppMetadata,
  type PluginRegistryInterface,
  type PromptEntry,
  type PromptMetadata,
  type ResourceEntry,
  type ResourceMetadata,
  type ResourceTemplateMetadata,
  type ScopeEntry,
  type ToolEntry,
  type ToolMetadata,
} from '../../common';
import { dutyMetadataOf } from '../../common/metadata/duty.metadata';
import { LazyAppConfigurationError, LazyAppLoadError } from '../../errors/lazy-app.errors';
import { UnenforcedMetadataError } from '../../errors/plugin.errors';
import { isManifestMode } from '../../front-mcp/manifest-mode.flag';
import { hookClassOf } from '../../hooks/hook.registry';
import { manifestPromptOf, manifestResourceOf, manifestToolOf, ownersOf } from '../../manifest/build-server-manifest';
import {
  SERVER_MANIFEST_FILE,
  type ManifestPrompt,
  type ManifestResource,
  type ManifestResourceTemplate,
  type ManifestTool,
} from '../../manifest/server-manifest.schema';
import { PromptInstance } from '../../prompt/prompt.instance';
import PromptRegistry from '../../prompt/prompt.registry';
import ProviderRegistry from '../../provider/provider.registry';
import { ResourceInstance } from '../../resource/resource.instance';
import ResourceRegistry from '../../resource/resource.registry';
import type { SkillRegistryInterface } from '../../skill/skill.registry';
import { keepingListsUnchanged } from '../../surface/unchanged-lists';
import { ToolInstance } from '../../tool/tool.instance';
import ToolRegistry from '../../tool/tool.registry';
import { appIdOf, normalizeApp } from '../app.utils';
import { whyAppCannotBeLazy, whyListedAppCannotBeLazy, whyLoadedAppCannotBeLazy } from '../lazy/lazy-app.rules';
import {
  changedLists,
  listedAppOf,
  noteEagerLoading,
  recordedListsOf,
  serverManifestOf,
  type ListedApp,
  type RecordedLists,
} from '../lazy/lazy-manifest';
import { markPlaceholder, type LazyAppLoader } from '../lazy/lazy-placeholders';
import { AppLocalInstance } from './app.local.instance';
import { EmptyAdapterRegistry, EmptyPluginRegistry, EmptySkillRegistry } from './empty-app-registries';

/**
 * An app whose code is imported on its first call. Until then the entries `frontmcp.manifest.json` lists for it are
 * placeholders in its registries, so the list flows answer for it; loading puts the app's own entries in their place.
 * Without a manifest (development) and at build time it is imported at startup.
 */
export class AppLazyInstance extends AppEntry<LazyAppRecordMetadata> implements LazyAppLoader {
  override readonly id: string;
  retryable = true;

  private readonly scopeProviders: ProviderRegistry;
  private readonly ownProviders: ProviderRegistry;
  private readonly appOwner: EntryOwnerRef;
  private readonly appTools: ToolRegistry;
  private readonly appResources: ResourceRegistry;
  private readonly appPrompts: PromptRegistry;
  private readonly noPlugins = new EmptyPluginRegistry();
  private readonly noAdapters = new EmptyAdapterRegistry();
  private readonly noSkills = new EmptySkillRegistry();
  /** What the manifest lists for the app, while its entries are listed from it. */
  private listed?: ListedApp;
  private loaded?: AppLocalInstance;
  private loading?: Promise<void>;
  /** A failure the next call does not retry, answered to every call. */
  private failure?: unknown;

  constructor(record: AppRecord, scopeProviders: ProviderRegistry) {
    super(record);
    this.id = appIdOf(this.metadata);
    this.scopeProviders = scopeProviders;
    this.appOwner = { kind: 'app', id: this.id, ref: this.token };
    this.ownProviders = new ProviderRegistry([], scopeProviders);
    this.appTools = new ToolRegistry(this.ownProviders, [], this.appOwner, { adopt: false });
    this.appResources = new ResourceRegistry(this.ownProviders, [], this.appOwner, { adopt: false });
    this.appPrompts = new PromptRegistry(this.ownProviders, [], this.appOwner, { adopt: false });
    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    await Promise.all([this.ownProviders.ready, this.appTools.ready, this.appResources.ready, this.appPrompts.ready]);
    const scope = this.scope;
    if (isManifestMode(scope.metadata)) return this.load();

    const { manifest, where } = await serverManifestOf(scope);
    const listed = manifest && listedAppOf(manifest, this.id);
    if (listed) return this.listFrom(listed);

    if (isProduction()) {
      const missing = manifest
        ? `${where} does not list it`
        : `no ${SERVER_MANIFEST_FILE} was found (looked for ${where})`;
      throw new LazyAppConfigurationError(
        `App "${this.id}" is lazy, and ${missing}. In production a lazy app is listed from the manifest until its ` +
          `first call: Run \`frontmcp build\` and ship ${SERVER_MANIFEST_FILE} next to the server's entry, or pass ` +
          '@FrontMcp({ manifest }).',
      );
    }
    if (this.metadata.enabled === false) return;
    if (manifest) {
      scope.logger.info(
        `App "${this.id}" is loaded at startup: ${where} does not list it. Run \`frontmcp build\` to write it again.`,
      );
    } else {
      noteEagerLoading(scope, where);
    }
    await this.load();
  }

  private get scope(): ScopeEntry {
    return this.scopeProviders.getActiveScope();
  }

  /**
   * Import and initialize the app, once, however many callers wait. A failure the app's code must fix is answered
   * until the server restarts; any other is retried by the next call.
   */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.failure) return Promise.reject(this.failure);
    this.loading ??= this.importApp().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async importApp(): Promise<void> {
    const scope = this.scope;
    const hooksBefore = new Set(scope.hooks.getHooks());
    let app: AppLocalInstance | undefined;
    try {
      const record = normalizeApp(appClassOf(await this.metadata.lazy(), this.id));
      const imported = record.metadata as LocalAppMetadata;
      if (appIdOf(imported) !== this.id) {
        throw new LazyAppConfigurationError(
          `App "${this.id}": the lazy import resolved to the imported app "${appIdOf(imported)}". ` +
            "Give the lazy app the @App's id, or import the app it names.",
        );
      }
      const reasons = whyAppCannotBeLazy(imported);
      if (reasons.length > 0) throw cannotBeLazy(this.id, reasons);
      this.assertServing();
      app = new AppLocalInstance(record, this.scopeProviders);
      await app.ready;
      this.assertCanBeLazy(app, hooksBefore);
      const recorded = recordedListsOfApp(app);
      if (!isManifestMode(scope.metadata)) this.applySwitch(app);
      if (this.listed) {
        await scope.checkLateApp(app);
        await app.providers.runReadyHooks(scope.logger);
      }
      this.assertServing();
      this.useLoaded(app, imported, recorded);
    } catch (error) {
      if (app) await this.discard(app, hooksBefore);
      this.retryable = !(error instanceof LazyAppConfigurationError || error instanceof UnenforcedMetadataError);
      if (!this.retryable) this.failure = error;
      if (this.listed && !scope.isDisposed) {
        const next = this.retryable ? 'the next call imports it again' : 'restart the server once it is fixed';
        scope.logger.error(`App "${this.id}" could not be loaded (${next}): ${messageOf(error)}`);
      }
      throw error;
    }
  }

  /** An import that resolves after the server began shutting down does not start the app. */
  private assertServing(): void {
    if (this.scope.isDisposed) throw new LazyAppLoadError(this.metadata.name, false);
  }

  private assertCanBeLazy(app: AppLocalInstance, hooksBefore: ReadonlySet<HookEntry>): void {
    const duties = [...app.providers.getAllSingletons().values()].flatMap((value) => dutyMetadataOf(value) ?? []);
    const reasons = whyLoadedAppCannotBeLazy({
      tools: app.tools.listAllInstances(),
      resources: app.resources.listAllInstances(),
      prompts: app.prompts.listAllInstances(),
      skills: app.skills.getSkills(true),
      agents: app.agents.listAllInstances(),
      hooks: this.hooksRegisteredBy(app, hooksBefore).filter((hook) => hook.metadata.owner),
      duties,
    });
    if (reasons.length > 0) throw cannotBeLazy(this.id, reasons);
  }

  /** The hooks `app`'s initialization registered: those the app owns, and those its entries' classes declare. */
  private hooksRegisteredBy(app: AppLocalInstance, hooksBefore: ReadonlySet<HookEntry>): HookEntry[] {
    const registries = [app.tools, app.resources, app.prompts] as Array<
      { listAllInstances(): ReadonlyArray<{ record: { provide: unknown } }> } | undefined
    >;
    const entryClasses = new Set(
      registries.flatMap((registry) => registry?.listAllInstances().map((entry) => entry.record.provide) ?? []),
    );
    return this.scope.hooks.getHooks().filter((hook) => {
      if (hooksBefore.has(hook)) return false;
      const owner = hook.metadata.owner;
      return owner ? owner.kind === 'app' && owner.id === this.id : entryClasses.has(hookClassOf(hook));
    });
  }

  /** Undo a failed load: its hooks are unregistered and its providers shut down, so a retry starts clean. */
  private async discard(app: AppLocalInstance, hooksBefore: ReadonlySet<HookEntry>): Promise<void> {
    const scope = this.scope;
    scope.hooks.removeHooks(this.hooksRegisteredBy(app, hooksBefore));
    const providers = app.providers as ProviderRegistry | undefined;
    await providers?.runShutdownHooks(scope.logger);
    providers?.dispose();
    (app.adapters as AdapterRegistry | undefined)?.dispose();
  }

  /**
   * The lazy app's `enabled` turns its loaded entries on and off, as it did their placeholders. Not at build time: the
   * manifest records the entries' own switches, and the placeholders add the app's.
   */
  private applySwitch(app: AppLocalInstance): void {
    const enabled = this.metadata.enabled;
    if (enabled === undefined) return;
    const entries = [
      ...app.tools.listAllInstances(),
      ...app.resources.listAllInstances(),
      ...app.prompts.listAllInstances(),
    ];
    for (const entry of entries) {
      if (entry.metadata.enabled !== false) entry.metadata.enabled = enabled;
    }
  }

  /** Put the loaded app's entries in place of the placeholders; a list that changed is announced. */
  private useLoaded(app: AppLocalInstance, imported: LocalAppMetadata, recorded: RecordedLists): void {
    const listedOutput = this.metadata.output;
    this.metadata.description ??= imported.description;
    this.metadata.output = imported.output;
    const changed = this.listed
      ? changedLists(recordedListsOf(this.listed), recorded, { listed: listedOutput, loaded: imported.output })
      : [];
    keepingListsUnchanged(() => {
      this.appTools.replaceAll([], this.appOwner);
      this.appResources.replaceAll([], this.appOwner);
      this.appPrompts.replaceAll([], this.appOwner);
      this.appTools.adoptFromChild(app.tools, app.tools.owner);
      this.appResources.adoptFromChild(app.resources, app.resources.owner);
      this.appPrompts.adoptFromChild(app.prompts, app.prompts.owner);
    });
    this.loaded = app;
    this.listed = undefined;
    if (changed.length === 0) return;
    this.scope.logger.warn(
      `App "${this.id}" does not match ${SERVER_MANIFEST_FILE} (${changed.join(', ')}): its entries are listed from ` +
        'its code from now on. Run `frontmcp build` to write the manifest again.',
    );
    for (const kind of changed) this.registryOf(kind).notifyListChanged();
  }

  private registryOf(kind: ListChangedKind): { notifyListChanged(): void } {
    const scope = this.scope;
    return kind === 'tools' ? scope.tools : kind === 'resources' ? scope.resources : scope.prompts;
  }

  /** List the app from the manifest: a placeholder for each of its entries, which is off when the entry or the app is. */
  private async listFrom(listed: ListedApp): Promise<void> {
    const reasons = whyListedAppCannotBeLazy(listed);
    if (reasons.length > 0) throw cannotBeLazy(this.id, reasons);
    this.listed = listed;
    this.metadata.description ??= listed.app.description;
    this.metadata.output = listed.app.output;

    const enabledOf = (entry: { enabled?: false | 'source' }) =>
      entry.enabled === false ? false : this.metadata.enabled;
    const placeholders = [
      ...listed.tools.map((tool) => this.toolPlaceholder(tool, enabledOf(tool))),
      ...listed.resources.map((resource) => this.resourcePlaceholder(resource, enabledOf(resource))),
      ...listed.resourceTemplates.map((template) => this.resourcePlaceholder(template, enabledOf(template))),
      ...listed.prompts.map((prompt) => this.promptPlaceholder(prompt, enabledOf(prompt))),
    ];
    await Promise.all(placeholders.map((placeholder) => placeholder.ready));
    for (const placeholder of placeholders) markPlaceholder(placeholder, this);
  }

  private toolPlaceholder(tool: ManifestTool, enabled: LazyAppRecordMetadata['enabled']): ToolInstance {
    const metadata: ToolMetadata & Record<string, unknown> = {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: {},
      rawInputSchema: tool.inputSchema,
      rawOutputSchema: tool.outputSchema,
      annotations: tool.annotations,
      icons: tool.icons,
      _meta: tool._meta,
      tags: tool.tags,
      aliases: tool.aliases,
      visibility: tool.visibility,
      execution: tool.execution,
      output: tool.output,
      examples: tool.examples,
      availableWhen: tool.availableWhen,
      enabled,
    } as ToolMetadata & Record<string, unknown>;
    const placeholder = new ToolInstance(
      { kind: ToolKind.CLASS_TOKEN, provide: placeholderToolClass(this), metadata },
      this.ownProviders,
      this.appOwner,
    );
    this.appTools.registerToolInstance(placeholder);
    return placeholder;
  }

  private resourcePlaceholder(
    resource: ManifestResource | ManifestResourceTemplate,
    enabled: LazyAppRecordMetadata['enabled'],
  ): ResourceInstance {
    const { app: _app, owner: _owner, authorities: _authorities, enabled: _enabled, ...listedFields } = resource;
    const metadata = { ...listedFields, enabled } as ResourceMetadata & ResourceTemplateMetadata;
    const provide = placeholderResourceClass(this) as unknown as Type<ResourceEntry>;
    const record =
      'uriTemplate' in resource
        ? { kind: ResourceTemplateKind.CLASS_TOKEN as const, provide, metadata }
        : { kind: ResourceKind.CLASS_TOKEN as const, provide, metadata };
    const placeholder = new ResourceInstance(record, this.ownProviders, this.appOwner);
    this.appResources.registerResourceInstance(placeholder);
    return placeholder;
  }

  private promptPlaceholder(prompt: ManifestPrompt, enabled: LazyAppRecordMetadata['enabled']): PromptInstance {
    const { app: _app, owner: _owner, authorities: _authorities, enabled: _enabled, ...listedFields } = prompt;
    const metadata = { ...listedFields, arguments: listedFields.arguments ?? [], enabled } as PromptMetadata;
    const provide = placeholderPromptClass(this) as unknown as Type<PromptEntry>;
    const placeholder = new PromptInstance(
      { kind: PromptKind.CLASS_TOKEN, provide, metadata },
      this.ownProviders,
      this.appOwner,
    );
    this.appPrompts.registerPromptInstance(placeholder);
    return placeholder;
  }

  get providers(): ProviderRegistry {
    return this.ownProviders;
  }

  get adapters(): AdapterRegistryInterface {
    return this.loaded?.adapters ?? this.noAdapters;
  }

  get plugins(): PluginRegistryInterface {
    return this.loaded?.plugins ?? this.noPlugins;
  }

  get tools(): ToolRegistry {
    return this.appTools;
  }

  get resources(): ResourceRegistry {
    return this.appResources;
  }

  get prompts(): PromptRegistry {
    return this.appPrompts;
  }

  get skills(): SkillRegistryInterface {
    return this.noSkills;
  }
}

/** The `@App` class a lazy import resolved to: the class itself, a module's default export, or its only `@App` export. */
function appClassOf(imported: unknown, appId: string): AppType {
  const isApp = (value: unknown): value is Type =>
    isClass(value) && getMetadata(FrontMcpLocalAppTokens.type, value) !== undefined;
  if (isApp(imported)) return imported;
  const exports = typeof imported === 'object' && imported !== null ? (imported as Record<string, unknown>) : {};
  if (isApp(exports['default'])) return exports['default'];
  const apps = Object.values(exports).filter(isApp);
  if (apps.length === 1) return apps[0];
  throw new LazyAppConfigurationError(
    `App "${appId}": the lazy import resolved to no @App class ` +
      `(${apps.length > 1 ? `${apps.length} @App exports and no default export` : 'no @App export'}). ` +
      "Resolve it to the app's class, such as () => import('./billing.app').then((m) => m.BillingApp).",
  );
}

/** A context class of its own for each tool placeholder (a registry keys its entries by class); it never runs. */
function placeholderToolClass(app: LazyAppLoader): Type<ToolContext> {
  return class LazyToolPlaceholder extends ToolContext {
    async execute(): Promise<never> {
      throw new LazyAppLoadError(app.metadata.name, app.retryable);
    }
  };
}

function placeholderResourceClass(app: LazyAppLoader): Type<ResourceContext> {
  return class LazyResourcePlaceholder extends ResourceContext {
    async execute(): Promise<ReadResourceResult> {
      throw new LazyAppLoadError(app.metadata.name, app.retryable);
    }
  };
}

function placeholderPromptClass(app: LazyAppLoader): Type<PromptContext> {
  return class LazyPromptPlaceholder extends PromptContext {
    async execute(): Promise<GetPromptResult> {
      throw new LazyAppLoadError(app.metadata.name, app.retryable);
    }
  };
}

/** The lists the manifest would record for `app`'s entries. */
function recordedListsOfApp(app: AppLocalInstance): RecordedLists {
  const lineageOf = <Entry extends ToolEntry | ResourceEntry | PromptEntry>(
    registry: { lineageOf(entry: Entry): ReturnType<ToolRegistry['lineageOf']> },
    entry: Entry,
  ) => ownersOf(registry.lineageOf(entry), entry.owner);
  const resources = app.resources.listAllInstances().flatMap((resource) => {
    const recorded = manifestResourceOf(resource, lineageOf(app.resources, resource));
    if (!recorded) return [];
    return ['template' in recorded ? recorded.template : recorded.resource];
  });
  return {
    tools: app.tools.listAllInstances().map((tool) => manifestToolOf(tool, lineageOf(app.tools, tool))),
    resources,
    prompts: app.prompts.listAllInstances().map((prompt) => manifestPromptOf(prompt, lineageOf(app.prompts, prompt))),
  };
}

function cannotBeLazy(appId: string, reasons: readonly string[]): LazyAppConfigurationError {
  return new LazyAppConfigurationError(
    `App "${appId}" cannot be lazy: ${reasons.join('; ')}. A lazy app's tools, resources and prompts are listed ` +
      `from ${SERVER_MANIFEST_FILE} before its code is imported, so nothing in them may need that code to be listed, ` +
      'its hooks may run only for its own calls, and nothing only startup sets up. Remove `lazy` to import the app ' +
      'at startup, or move these to an app that is not lazy.',
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
