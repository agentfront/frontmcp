import 'reflect-metadata';

import { tokenName, type Token } from '@frontmcp/di';

import {
  AppKind,
  FrontMcpLogger,
  type AppEntry,
  type AppRecord,
  type AppType,
  type EntryOwnerRef,
  type RemoteAppMetadata,
} from '../common';
import { DuplicateAppIdError, InvalidRegistryKindError, RegistryDependencyNotRegisteredError } from '../errors';
import type ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, type RegistryBuildMapResult } from '../regsitry';
import { appDiscoveryDeps, appIdOf, normalizeApp } from './app.utils';
import { AppLocalInstance } from './instances/app.local.instance';

export default class AppRegistry extends RegistryAbstract<AppEntry, AppRecord, AppType[]> {
  private readonly owner: EntryOwnerRef;
  private logger?: FrontMcpLogger;

  constructor(globalProviders: ProviderRegistry, list: AppType[], owner: EntryOwnerRef) {
    super('AppRegistry', globalProviders, list);
    this.owner = owner;
    try {
      this.logger = globalProviders.get(FrontMcpLogger)?.child('AppRegistry');
    } catch {
      // Logger not available
    }
  }

  protected buildMap(list: AppType[]): RegistryBuildMapResult<AppRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, AppRecord>();
    const graph = new Map<Token, Set<Token>>();
    const configuredAppIds = new Set<string>();
    const records = list.map((raw) => normalizeApp(raw));
    for (const rec of records) {
      if ((rec.kind === AppKind.REMOTE_VALUE && !rec.useValue) || rec.kind === AppKind.LAZY_IMPORT) {
        const appId = appIdOf(rec.metadata);
        if (configuredAppIds.has(appId)) throw new DuplicateAppIdError(appId);
        configuredAppIds.add(appId);
      }
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }
    // A lazy app owns its hooks and manifest entries by its id, so no other app may share it
    for (const rec of records) {
      if (rec.kind !== AppKind.LAZY_IMPORT) continue;
      const appId = appIdOf(rec.metadata);
      if (records.some((other) => other !== rec && appIdOf(other.metadata) === appId)) {
        throw new DuplicateAppIdError(appId);
      }
    }
    return { tokens, defs, graph };
  }

  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = appDiscoveryDeps(rec);
      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new RegistryDependencyNotRegisteredError('App', tokenName(token), tokenName(d));
        }
        this.graph.get(token)!.add(d);
      }
    }
  }

  /** Instantiate adapters, run fetch/transform, and populate registries. */
  protected async initialize(): Promise<void> {
    this.logger?.verbose(`AppRegistry: initializing ${this.tokens.size} app(s)`);
    const readyArr: Promise<void>[] = [];
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;

      let app: AppEntry;
      if (rec.kind === AppKind.LOCAL_CLASS) {
        app = new AppLocalInstance(rec, this.providers);
      } else if (rec.kind === AppKind.REMOTE_VALUE) {
        const remoteMeta = rec.metadata as RemoteAppMetadata;
        if (remoteMeta.urlType === 'npm' || remoteMeta.urlType === 'esm') {
          const { AppEsmInstance } = await import('./instances/app.esm.instance.js');
          app = new AppEsmInstance(rec, this.providers);
        } else {
          const { AppRemoteInstance } = await import('./instances/app.remote.instance.js');
          app = new AppRemoteInstance(rec, this.providers);
        }
      } else if (rec.kind === AppKind.LAZY_IMPORT) {
        const { AppLazyInstance } = await import('./instances/app.lazy.instance.js');
        app = new AppLazyInstance(rec, this.providers);
      } else {
        throw new InvalidRegistryKindError('app', (rec as { kind?: string }).kind);
      }

      this.instances.set(token, app);
      readyArr.push(app.ready);
      this.logger?.verbose(`AppRegistry: registered ${rec.kind} app '${rec.metadata.name}'`);
    }
    // Every app finishes building before a failure is reported, so shutting down releases what they built
    const settled = await Promise.allSettled(readyArr);
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
    this.logger?.debug(`AppRegistry: initialization complete (${this.instances.size} app(s))`);
  }

  getApps(): AppEntry[] {
    return [...this.instances.values()];
  }
}
