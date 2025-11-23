import 'reflect-metadata';
import {
  Ctor,
  ProviderInterface,
  ProviderType,
  ProviderScope,
  Token,
  ProviderRegistryInterface,
  ProviderRecord,
  ProviderKind,
  ProviderInjectedRecord,
  ScopeEntry,
  RegistryKind,
  RegistryType,
  ProviderEntry,
  FrontMcpServer,
} from '../common';
import { normalizeProvider, providerDiscoveryDeps, providerInvocationTokens } from './provider.utils';
import { depsOfClass, isClass, isPromise, tokenName } from '../utils/token.utils';
import { hasAsyncWith } from '../utils/metadata.utils';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { ProviderViews } from './provider.types';
import { Scope } from '../scope';
import HookRegistry from '../hooks/hook.registry';

export default class ProviderRegistry
  extends RegistryAbstract<ProviderEntry, ProviderRecord, ProviderType[], ProviderRegistry | undefined>
  implements ProviderRegistryInterface
{
  /** used to track which registry provided which token */
  private readonly providedBy: Map<Token, ProviderRegistry>;
  /** topo order (deps first) */
  private order: Set<Token> = new Set();

  // /** scoped instance stores by key */
  // private scoped = new Map<string, Map<Token, any>>();

  private registries: Map<RegistryKind, Set<RegistryType>> = new Map();

  constructor(list: ProviderType[], private readonly parentProviders?: ProviderRegistry) {
    super('ProviderRegistry', parentProviders, list, false);

    this.providedBy = new Map();

    this.buildGraph();
    this.topoSort();

    this.ready = this.initialize();
  }

  getProviders(): ProviderEntry[] {
    return [...this.instances.values()] as const;
  }

  /* -------------------- Hierarchy helpers -------------------- */

  /** Walk up the registry chain to find a def for a token. */
  private lookupDefInHierarchy(token: Token): { registry: ProviderRegistry; rec: ProviderRecord } | undefined {
    if (this.defs.has(token as any)) return { registry: this, rec: this.defs.get(token as any)! };
    return this.providers?.lookupDefInHierarchy(token);
  }

  /** Resolve a DEFAULT-scoped dependency from the hierarchy, enforcing scope & instantiation. */
  private resolveDefaultFromHierarchy(token: Token): any {
    const found = this.lookupDefInHierarchy(token);
    if (!found) throw new Error(`Cannot resolve token ${tokenName(token)}: not registered in hierarchy.`);
    const { registry, rec } = found;
    const sc = registry.getProviderScope(rec);
    if (sc !== ProviderScope.GLOBAL) {
      const scName = ProviderScope[sc];
      throw new Error(
        `Dependency ${tokenName(token)} is scoped (${scName}) in ${registry.constructor.name}; cannot use as DEFAULT.`,
      );
    }
    const inst = registry.instances.get(token);
    if (inst === undefined) {
      throw new Error(`Dependency ${tokenName(token)} (DEFAULT) is not instantiated in ${registry.constructor.name}`);
    }
    return inst;
  }

  /* -------------------- Build phase -------------------- */

  protected override buildMap(list: ProviderType[]): RegistryBuildMapResult<ProviderRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, ProviderRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const raw of list) {
      const rec = normalizeProvider(raw);
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
      const deps = this.discoveryDeps(rec);

      for (const d of deps) {
        const isLocal = this.tokens.has(d);
        const up = isLocal ? undefined : this.lookupDefInHierarchy(d);

        if (!isLocal && !up) {
          throw new Error(
            `Provider ${tokenName(token)} depends on ${tokenName(d)}, which is not registered (local or parent).`,
          );
        }

        const depRec = isLocal ? this.defs.get(d)! : up!.rec;
        const depScope = isLocal ? this.getProviderScope(depRec) : up!.registry.getProviderScope(depRec);

        if (this.getProviderScope(rec) === ProviderScope.GLOBAL && depScope !== ProviderScope.GLOBAL) {
          throw new Error(
            `Invalid dependency: DEFAULT-scoped provider ${tokenName(
              token,
            )} cannot depend on scoped provider ${tokenName(d)}.`,
          );
        }

        // Only wire local -> local edges in our local graph; parent deps are external to this DAG.
        if (isLocal) this.graph.get(token)!.add(d);
      }
    }
  }

  protected topoSort() {
    const WHITE = 0,
      GRAY = 1,
      BLACK = 2;
    const color = new Map<Token, number>();
    const order: Set<Token> = new Set();
    const path: Token[] = [];

    const dfs = (n: Token) => {
      color.set(n, GRAY);
      path.push(n);
      for (const dep of this.graph.get(n) ?? []) {
        const c = color.get(dep) ?? WHITE;
        if (c === GRAY) {
          const idx = path.findIndex((p) => p === dep);
          const cycle = [...path.slice(idx), dep].map((t) => tokenName(t)).join(' -> ');
          throw new Error(`Dependency cycle detected: ${cycle}`);
        }
        if (c === WHITE) dfs(dep);
      }
      color.set(n, BLACK);
      order.add(n);
      path.pop();
    };

    for (const n of this.graph.keys()) if ((color.get(n) ?? WHITE) === WHITE) dfs(n);
    this.order = order;
  }

  /** Incremental instantiation for DEFAULT providers.
   *  - Skips already-built singletons unless force:true.
   *  - Can limit to a subset via onlyTokens.
   */
  protected async initialize(opts?: { force?: boolean; onlyTokens?: Iterable<Token> }) {
    const force = !!opts?.force;
    const only = opts?.onlyTokens ? new Set(opts.onlyTokens) : null;

    for (const token of this.order) {
      const rec = this.defs.get(token)!;
      if (this.getProviderScope(rec) !== ProviderScope.GLOBAL) continue;

      if (only && !only.has(token)) continue;
      if (!force && this.instances.has(token)) continue;

      if (force && this.instances.has(token)) {
        this.instances.delete(token);
      }

      try {
        await this.initiateOne(token, rec);
      } catch (e: any) {
        const msg = e?.message ?? e;
        console.error(`Failed instantiating`, e);
        throw new Error(`Failed constructing ${tokenName(token)}: ${msg}`);
      }
    }
  }

  /* -------------------- Views & session stores -------------------- */

  /** Return the live singleton map as a read-only view. No copying. */
  getAllSingletons(): ReadonlyMap<Token, unknown> {
    return this.instances; // exposed as ReadonlyMap in the type
  }
  discoveryDeps(rec: ProviderRecord): Token[] {
    return providerDiscoveryDeps(rec, this.tokens, (k, phase) => depsOfClass(k, phase));
  }

  invocationTokens(_token: Token, rec: ProviderRecord): Token[] {
    return providerInvocationTokens(rec, (k, phase) => depsOfClass(k, phase));
  }

  getProviderScope(rec: ProviderRecord): ProviderScope {
    return rec.metadata?.scope ?? ProviderScope.GLOBAL;
  }

  getScope(): ScopeEntry {
    return this.getActiveScope();
  }

  /* -------------------- Instantiation -------------------- */

  private async withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    if (ms <= 0 || !Number.isFinite(ms)) return p;
    let timer: any;
    try {
      const tm = new Promise<never>(
        (_, rej) => (timer = setTimeout(() => rej(new Error(`Timeout after ${ms}ms: ${label}`)), ms)),
      );
      return await Promise.race([p, tm]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async resolveFactoryArg(t: Token, store: Map<Token, any>, scopeKey?: string): Promise<any> {
    if (store.has(t)) return store.get(t);
    if (this.instances.has(t)) return this.instances.get(t);

    // Local def?
    const rec = this.defs.get(t as any);
    if (rec) {
      const sc = this.getProviderScope(rec);
      if (sc === ProviderScope.GLOBAL) {
        if (!this.instances.has(t)) {
          throw new Error(`Dependency ${tokenName(t)} (DEFAULT scope) is not instantiated`);
        }
        return this.instances.get(t);
      } else {
        await this.buildIntoStore(t, rec, store, scopeKey);
        return store.get(t);
      }
    }

    // Parent def?
    const up = this.lookupDefInHierarchy(t);
    if (up) {
      const sc = up.registry.getProviderScope(up.rec);
      if (sc === ProviderScope.GLOBAL) {
        const inst = up.registry.instances.get(t);
        if (inst === undefined) {
          throw new Error(`Dependency ${tokenName(t)} (DEFAULT scope) is not instantiated in parent`);
        }
        return inst;
      } else {
        await up.registry.buildIntoStore(t, up.rec, store, scopeKey);
        return store.get(t);
      }
    }

    // Constructable fallback (non-DI)
    if (isClass(t)) {
      if (hasAsyncWith(t)) {
        const out = (t as any).with();
        return isPromise(out) ? await this.withTimeout(out, this.asyncTimeoutMs, `${t.name}.with(...)`) : out;
      }
      const instance = new (t as Ctor<any>)();
      const init = (instance as any)?.init;
      if (typeof init === 'function') {
        const ret = init.call(instance);
        if (isPromise(ret)) await this.withTimeout(ret, this.asyncTimeoutMs, `${t.name}.init()`);
      }
      return instance;
    }

    throw new Error(`Cannot resolve token ${tokenName(t)}: not registered in hierarchy and not constructable.`);
  }

  /** Build a single DEFAULT-scoped singleton (used by incremental instantiating). */
  private async initiateOne(token: Token, rec: ProviderRecord): Promise<void> {
    switch (rec.kind) {
      case ProviderKind.VALUE: {
        this.instances.set(token, (rec as any).useValue);
        return;
      }
      case ProviderKind.FACTORY: {
        const deps = this.invocationTokens(token, rec);
        const args: any[] = [];
        for (const d of deps) args.push(await this.resolveFactoryArg(d, this.instances));
        const out = (rec as any).useFactory(...args);
        const val = isPromise(out)
          ? await this.withTimeout(out, this.asyncTimeoutMs, `${tokenName(token)}.useFactory(...)`)
          : out;
        this.instances.set(token, val);
        return;
      }
      case ProviderKind.CLASS: {
        const depTokens = this.invocationTokens(token, rec);
        const deps = depTokens.map((t) => this.resolveDefaultFromHierarchy(t));
        const klass = (rec as any).useClass;
        if (hasAsyncWith(klass)) {
          const out = (klass as any).with(...deps);
          const val = isPromise(out)
            ? await this.withTimeout(out, this.asyncTimeoutMs, `${klass.name}.with(...)`)
            : out;
          this.instances.set(token, val);
        } else {
          const instance = new (klass as Ctor<any>)(...deps);
          const init = (instance as any)?.init;
          if (typeof init === 'function') {
            const ret = init.call(instance);
            if (isPromise(ret)) await this.withTimeout(ret, this.asyncTimeoutMs, `${klass.name}.init()`);
          }
          this.instances.set(token, instance);
        }
        return;
      }
      case ProviderKind.CLASS_TOKEN: {
        const depTokens = this.invocationTokens(token, rec);
        const deps = depTokens.map((t) => this.resolveDefaultFromHierarchy(t));
        const klass = (rec as any).provide;
        if (hasAsyncWith(klass)) {
          const out = (klass as any).with(...deps);
          const val = isPromise(out)
            ? await this.withTimeout(out, this.asyncTimeoutMs, `${klass.name}.with(...)`)
            : out;
          this.instances.set(token, val);
        } else {
          const instance = new (klass as Ctor<any>)(...deps);
          const init = (instance as any)?.init;
          if (typeof init === 'function') {
            const ret = init.call(instance);
            if (isPromise(ret)) await this.withTimeout(ret, this.asyncTimeoutMs, `${klass.name}.init()`);
          }
          this.instances.set(token, instance);
        }
        return;
      }
    }
  }

  // Build a registered provider into the given scoped store (recursive for scoped deps).
  private async buildIntoStore(
    token: Token,
    rec: ProviderRecord,
    store: Map<Token, any>,
    scopeKey?: string,
    injectedDeps?: any[],
  ): Promise<void> {
    if (store.has(token)) return;

    try {
      switch (rec.kind) {
        case ProviderKind.VALUE: {
          store.set(token, (rec as any).useValue);
          return;
        }
        case ProviderKind.FACTORY: {
          const deps = this.invocationTokens(token, rec);
          const args: any[] = [];
          for (const d of deps) args.push(await this.resolveFactoryArg(d, store, scopeKey));
          const out = (rec as any).useFactory(...args);
          const val = isPromise(out)
            ? await this.withTimeout(out, this.asyncTimeoutMs, `${tokenName(token)}.useFactory(...)`)
            : out;
          store.set(token, val);
          return;
        }
        case ProviderKind.CLASS: {
          const depsTokens = this.invocationTokens(token, rec);
          const deps: any[] = [];
          for (const d of depsTokens) deps.push(await this.resolveManagedForClass(d, store, scopeKey));
          const klass = (rec as any).useClass as Ctor<any>;
          if (hasAsyncWith(klass)) {
            const out = (klass as any).with(...deps);
            const val = isPromise(out)
              ? await this.withTimeout(out, this.asyncTimeoutMs, `${klass.name}.with(...)`)
              : out;
            store.set(token, val);
          } else {
            const instance = new (klass as Ctor<any>)(...deps);
            const init = (instance as any)?.init;
            if (typeof init === 'function') {
              const ret = init.call(instance);
              if (isPromise(ret)) await this.withTimeout(ret, this.asyncTimeoutMs, `${klass.name}.init()`);
            }
            store.set(token, instance);
          }
          return;
        }
        case ProviderKind.CLASS_TOKEN: {
          const depsTokens = this.invocationTokens(token, rec);
          const deps: any[] = injectedDeps ?? [];
          for (const d of depsTokens) deps.push(await this.resolveManagedForClass(d, store, scopeKey));
          const klass = (rec as any).provide as Ctor<any>;
          if (hasAsyncWith(klass)) {
            const out = (klass as any).with(...deps);
            const val = isPromise(out)
              ? await this.withTimeout(out, this.asyncTimeoutMs, `${klass.name}.with(...)`)
              : out;
            store.set(token, val);
          } else {
            const instance = new (klass as Ctor<any>)(...deps);
            const init = (instance as any)?.init;
            if (typeof init === 'function') {
              const ret = init.call(instance);
              if (isPromise(ret)) await this.withTimeout(ret, this.asyncTimeoutMs, `${klass.name}.init()`);
            }
            store.set(token, instance);
          }
          return;
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? e;
      console.error(`Failed constructing`, e);
      throw new Error(`Failed constructing (scoped) ${tokenName(token)}: ${msg}`);
    }
  }

  // Ensure managed dependency value for CLASS/CLASS_TOKEN providers:
  // prefer scoped store, then singleton; recursively build scoped deps.
  // If not local, climb the hierarchy and either read DEFAULT instance or build scoped into this store.
  private async resolveManagedForClass(d: Token, store: Map<Token, any>, scopeKey?: string): Promise<any> {
    if (store.has(d)) return store.get(d);
    if (this.instances.has(d)) return this.instances.get(d);

    // Local DI?
    const depRec = this.defs.get(d as any);
    if (depRec) {
      const sc = this.getProviderScope(depRec);
      if (sc === ProviderScope.GLOBAL) {
        const v = this.instances.get(d);
        if (v === undefined) throw new Error(`${tokenName(d)} (DEFAULT scope) is not instantiated`);
        return v;
      } else {
        await this.buildIntoStore(d, depRec, store, scopeKey);
        return store.get(d);
      }
    }

    // Parent DI?
    const up = this.lookupDefInHierarchy(d);
    if (up) {
      const sc = up.registry.getProviderScope(up.rec);
      if (sc === ProviderScope.GLOBAL) {
        const v = up.registry.instances.get(d);
        if (v === undefined) throw new Error(`${tokenName(d)} (DEFAULT scope) is not instantiated in parent`);
        return v;
      } else {
        await up.registry.buildIntoStore(d, up.rec, store, scopeKey);
        return store.get(d);
      }
    }

    throw new Error(`${tokenName(d)} is not instantiated`);
  }

  get<T>(token: Token<T>): T {
    if (this.instances.has(token)) return this.instances.get(token) as T;

    const rec = this.defs.get(token as any);
    if (rec && this.getProviderScope(rec) !== ProviderScope.GLOBAL) {
      const scName = ProviderScope[this.getProviderScope(rec)];
      throw new Error(`Provider ${tokenName(token)} is scoped (${scName}). Use getScoped(token, key).`);
    }

    // bubble to parent
    if (this.providers) return this.providers.get<T>(token);

    throw new Error(`Provider ${tokenName(token)} is not available in local or parent registries`);
  }

  // noinspection JSUnusedGlobalSymbols
  addRegistry(type: RegistryKind, value: RegistryType) {
    let registry = this.registries.get(type);
    if (!registry) {
      this.registries.set(type, new Set());
      registry = this.registries.get(type);
    }
    registry!.add(value);
  }

  getRegistries<T extends RegistryKind>(type: T): RegistryType[T][] {
    return [...(this.registries.get(type) ?? [])] as any;
  }

  getHooksRegistry() {
    return this.getRegistries('HookRegistry')[0] as HookRegistry;
  }

  // noinspection JSUnusedGlobalSymbols
  getScopeRegistry() {
    return this.getRegistries('ScopeRegistry')[0]!;
  }

  /** bootstrap helper: resolve a dependency usable during app bootstrap (must be GLOBAL). */
  async resolveBootstrapDep(t: Token): Promise<any> {
    if (this.instances.has(t)) return this.instances.get(t);
    if (this.registries.has(t as RegistryKind)) return this.registries.get(t as RegistryKind);

    const found = this.lookupDefInHierarchy(t);
    if (found) {
      const { registry, rec } = found;
      const sc = registry.getProviderScope(rec);
      if (sc !== ProviderScope.GLOBAL)
        throw new Error(`Plugin dependency ${tokenName(t)} must be DEFAULT-scoped at bootstrap`);
      const v = registry.instances.get(t);
      if (v === undefined) throw new Error(`Plugin dependency ${tokenName(t)} (DEFAULT scope) is not instantiated`);
      return v;
    }
    throw new Error(`Cannot resolve plugin dependency ${tokenName(t)} (local or parent)`);
  }

  /** Lightweight, synchronous resolver for app-scoped DI.
   *  - If `cls` is a registered DEFAULT provider token, returns the singleton (must be instantiated).
   *  - If `cls` is SCOPED in DI, throws (use getScoped/buildViews instead).
   *  - Otherwise, if `cls` is a constructable class not registered in DI, returns `new cls()`.
   *    If it defines a synchronous init(), it will be invoked (async init() is NOT awaited).
   */
  resolve<T>(cls: any): T {
    // 1) If it's a registered token (local or parent), handle via DI rules
    const found = this.lookupDefInHierarchy(cls as any);
    if (found) {
      const { registry, rec } = found;
      const sc = registry.getProviderScope(rec);
      if (sc !== ProviderScope.GLOBAL) {
        const scName = ProviderScope[sc];
        throw new Error(
          `Provider ${tokenName(cls)} is scoped (${scName}). Use getScoped(token, key) or buildViews(...).`,
        );
      }
      if (!registry.instances.has(cls)) {
        throw new Error(
          `Provider ${tokenName(cls)} (DEFAULT scope) is not instantiated. Call providers.instantiate() first.`,
        );
      }
      return registry.instances.get(cls) as T;
    }

    // 2) Not a registered token — best-effort construct (for tools/hooks/wrappers)
    if (isClass(cls)) {
      const instance = new (cls as Ctor<any>)();

      // Call sync init() if present (do NOT await)
      const init = (instance as any)?.init;
      if (typeof init === 'function') {
        // If someone accidentally made init async here, we intentionally do NOT await to keep it sync.
        init.call(instance);
      }

      return instance as T;
    }

    // 3) Unsupported token type
    throw new Error(
      `Cannot resolve ${tokenName(cls)}: not a registered DEFAULT provider and not a constructable class.`,
    );
  }

  mergeFromRegistry(
    providedBy: ProviderRegistry,
    exported: {
      token: Token<ProviderInterface>;
      def: ProviderRecord;
      instance: ProviderEntry;
    }[],
  ) {
    for (const { token, def, instance } of exported) {
      if (def.metadata.scope === ProviderScope.GLOBAL) {
        this.instances.set(token, instance);
      }
      this.defs.set(token, def);
      this.providedBy.set(token, providedBy);
    }
  }

  /**
   * Used by plugins to get the exported provider definitions.
   */
  getProviderInfo(token: Token<ProviderInterface>) {
    const def = this.defs.get(token);
    const instance = this.instances.get(token);
    if (!def || !instance)
      throw new Error(
        `Cannot get provider info for ${tokenName(
          token,
        )}: not a registered DEFAULT provider and not a constructable class.`,
      );
    return {
      token,
      def,
      instance,
    };
  }

  injectProvider(injected: Omit<ProviderInjectedRecord, 'kind'>) {
    const rec: ProviderInjectedRecord = {
      ...injected,
      kind: ProviderKind.INJECTED,
    };
    this.tokens.add(rec.provide);
    this.defs.set(rec.provide, rec);
    this.graph.set(rec.provide, new Set());
    this.instances.set(rec.provide, rec.value);
  }

  async addDynamicProviders(dynamicProviders: ProviderRecord[]) {
    return Promise.all(dynamicProviders.map((rec) => this.initiateOne(rec.provide, rec)));
  }

  private getWithParents<T>(token: Token<T>): T {
    if (this.instances.has(token)) {
      return this.get(token);
    }
    const parent = this.parentProviders;
    if (!parent) {
      return this.get(token);
    }
    return parent.getWithParents(token);
  }

  getActiveScope(): Scope {
    return this.getWithParents(Scope);
  }

  getActiveServer(): FrontMcpServer {
    return this.getWithParents(FrontMcpServer);
  }

  async buildViews(session: string): Promise<ProviderViews> {
    return {
      global: new Map<Token, any>(),
      session: new Map<Token, any>(),
      request: new Map<Token, any>(),
    };
  }
}
