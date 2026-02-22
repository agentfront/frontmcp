import 'reflect-metadata';
import { Token, tokenName } from '@frontmcp/di';
import { AppType, AppEntry, AppKind, AppRecord, EntryOwnerRef, FrontMcpLogger } from '../common';
import { appDiscoveryDeps, normalizeApp } from './app.utils';
import ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { AppLocalInstance, AppRemoteInstance } from './instances';
import { RegistryDependencyNotRegisteredError, InvalidRegistryKindError } from '../errors';

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
    for (const raw of list) {
      const rec = normalizeApp(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
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
        app = new AppRemoteInstance(rec, this.providers);
      } else {
        throw new InvalidRegistryKindError('app', (rec as { kind?: string }).kind);
      }

      this.instances.set(token, app);
      readyArr.push(app.ready);
      this.logger?.verbose(`AppRegistry: registered ${rec.kind} app '${rec.metadata.name}'`);
    }
    await Promise.all(readyArr);
    this.logger?.debug(`AppRegistry: initialization complete (${this.instances.size} app(s))`);
  }

  getApps(): AppEntry[] {
    return [...this.instances.values()];
  }
}
