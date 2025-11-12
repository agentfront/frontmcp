import 'reflect-metadata';
import { AppType, Token, AppEntry, AppKind, AppRecord } from '../common';
import { appDiscoveryDeps, normalizeApp } from './app.utils';
import ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { tokenName } from '../utils/token.utils';
import { AppLocalInstance, AppRemoteInstance } from './instances';

export default class AppRegistry extends RegistryAbstract<AppEntry, AppRecord, AppType[]> {

  constructor(
    globalProviders: ProviderRegistry,
    list: AppType[],
  ) {
    super('AppRegistry', globalProviders, list);
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
          throw new Error(`App ${tokenName(token)} depends on ${tokenName(d)}, which is not registered.`);
        }
        this.graph.get(token)!.add(d);
      }
    }
  }

  /** Instantiate adapters, run fetch/transform, and populate registries. */
  protected async initialize(): Promise<void> {
    const readyArr: Promise<void>[] = [];
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;

      let app: AppEntry;
      if (rec.kind === AppKind.LOCAL_CLASS) {
        app = new AppLocalInstance(rec, this.providers);
      } else if (rec.kind === AppKind.REMOTE_VALUE) {
        app = new AppRemoteInstance(rec, this.providers);
      } else {
        // TODO: use specific error class
        throw Error('Invalid adapter kind');
      }

      this.instances.set(token, app);
      readyArr.push(app.ready);
    }
    await Promise.all(readyArr);
  }


  getApps(): AppEntry[] {
    return [...this.instances.values()];
  }
}
