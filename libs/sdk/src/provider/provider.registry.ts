import 'reflect-metadata';
import {
  Ctor,
  ProviderScope,
  Token,
  ProviderRecord,
  ProviderKind,
  ProviderInjectedRecord,
  tokenName,
  isClass,
  isPromise,
  depsOfClass,
  hasAsyncWith,
} from '@frontmcp/di';
import {
  ProviderInterface,
  ProviderType,
  ProviderRegistryInterface,
  ScopeEntry,
  RegistryKind,
  RegistryType,
  ProviderEntry,
  FrontMcpServer,
} from '../common';
import { normalizeProvider, providerDiscoveryDeps, providerInvocationTokens } from './provider.utils';
import {
  ProviderNotRegisteredError,
  ProviderScopeMismatchError,
  ProviderNotInstantiatedError,
  DependencyCycleError,
  ProviderConstructionError,
  ProviderDependencyError,
  ProviderScopedAccessError,
  ProviderNotAvailableError,
  PluginDependencyError,
  InvalidDependencyScopeError,
} from '../errors';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { ProviderViews } from './provider.types';
import { Scope } from '../scope';
import HookRegistry from '../hooks/hook.registry';
import { validateSessionId } from '../context/frontmcp-context';
import { type DistributedEnabled, shouldCacheProviders } from '../common/types/options/transport';

/**
 * Configuration options for ProviderRegistry.
 */
export interface ProviderRegistryOptions {
  /**
   * Distributed mode setting.
   * Controls provider caching behavior for serverless/distributed deployments.
   */
  distributedMode?: DistributedEnabled;
  /**
   * Override for provider session caching.
   * When undefined, defaults based on distributedMode setting.
   */
  providerCaching?: boolean;
}

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

  /** Session-scoped provider instance cache by sessionKey */
  private sessionStores: Map<string, { providers: Map<Token, unknown>; lastAccess: number }> = new Map();

  /** Locks to prevent concurrent session builds (race condition prevention) */
  private sessionBuildLocks: Map<string, { promise: Promise<void>; resolve: () => void }> = new Map();

  /** Maximum number of sessions to cache (LRU eviction) */
  private static readonly MAX_SESSION_CACHE_SIZE = 10000;

  /** Session cache TTL in milliseconds (1 hour) */
  private static readonly SESSION_CACHE_TTL_MS = 3600000;

  /** Cleanup interval in milliseconds (1 minute) */
  private static readonly SESSION_CLEANUP_INTERVAL_MS = 60000;

  /** Handle for the session cleanup interval */
  private sessionCleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** Whether session caching is enabled (disabled in distributed/serverless mode) */
  private readonly sessionCacheEnabled: boolean;

  constructor(
    list: ProviderType[],
    private readonly parentProviders?: ProviderRegistry,
    options?: ProviderRegistryOptions,
  ) {
    super('ProviderRegistry', parentProviders, list, false);

    this.providedBy = new Map();
    this.sessionCacheEnabled = shouldCacheProviders(options?.distributedMode, options?.providerCaching);

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
    if (!found) throw new ProviderNotRegisteredError(tokenName(token), 'not registered in hierarchy');
    const { registry, rec } = found;
    const sc = registry.getProviderScope(rec);
    if (sc !== ProviderScope.GLOBAL) {
      const scName = ProviderScope[sc];
      throw new ProviderScopeMismatchError(tokenName(token), scName, registry.constructor.name);
    }
    const inst = registry.instances.get(token);
    if (inst === undefined) {
      throw new ProviderNotInstantiatedError(tokenName(token), 'DEFAULT', registry.constructor.name);
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
          throw new ProviderDependencyError(
            `Provider ${tokenName(token)} depends on ${tokenName(d)}, which is not registered (local or parent).`,
          );
        }

        const depRec = isLocal ? this.defs.get(d)! : up!.rec;
        const depScope = isLocal ? this.getProviderScope(depRec) : up!.registry.getProviderScope(depRec);

        if (this.getProviderScope(rec) === ProviderScope.GLOBAL && depScope !== ProviderScope.GLOBAL) {
          throw new InvalidDependencyScopeError(
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
          throw new DependencyCycleError(cycle);
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
        // Use safe logging to avoid Node.js 24 util.inspect bug with Zod errors
        console.error(`Failed instantiating:`, msg);
        throw new ProviderConstructionError(tokenName(token), e instanceof Error ? e : msg);
      }
    }

    // Start background session cleanup after initialization
    // This ensures expired sessions are periodically cleaned up (TTL enforcement)
    // Only start for scope-level registries (those with parentProviders) since
    // SESSION providers are stored in scope registries, not the global registry
    if (this.parentProviders) {
      this.startSessionCleanup();
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

  /**
   * Normalize deprecated scopes to their modern equivalents.
   *
   * - SESSION → CONTEXT (deprecated)
   * - REQUEST → CONTEXT (deprecated)
   *
   * This enables backwards compatibility while unifying the scope model.
   */
  private normalizeScope(scope: ProviderScope): ProviderScope {
    switch (scope) {
      case ProviderScope.SESSION:
      case ProviderScope.REQUEST:
        return ProviderScope.CONTEXT;
      default:
        return scope;
    }
  }

  getProviderScope(rec: ProviderRecord): ProviderScope {
    const rawScope = rec.metadata?.scope ?? ProviderScope.GLOBAL;
    return this.normalizeScope(rawScope);
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
          throw new ProviderNotInstantiatedError(tokenName(t), 'DEFAULT');
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
          throw new ProviderNotInstantiatedError(tokenName(t), 'DEFAULT', 'parent');
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

    throw new ProviderNotRegisteredError(tokenName(t), 'not registered in hierarchy and not constructable');
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
      // Use safe logging to avoid Node.js 24 util.inspect bug with Zod errors
      console.error(`Failed constructing:`, msg);
      throw new ProviderConstructionError(tokenName(token), e instanceof Error ? e : msg, 'scoped');
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
        if (v === undefined) throw new ProviderNotInstantiatedError(tokenName(d), 'DEFAULT');
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
        if (v === undefined) throw new ProviderNotInstantiatedError(tokenName(d), 'DEFAULT', 'parent');
        return v;
      } else {
        await up.registry.buildIntoStore(d, up.rec, store, scopeKey);
        return store.get(d);
      }
    }

    throw new ProviderNotInstantiatedError(tokenName(d));
  }

  get<T>(token: Token<T>): T {
    if (this.instances.has(token)) return this.instances.get(token) as T;

    const rec = this.defs.get(token as any);
    if (rec && this.getProviderScope(rec) !== ProviderScope.GLOBAL) {
      const scName = ProviderScope[this.getProviderScope(rec)];
      throw new ProviderScopedAccessError(tokenName(token), scName);
    }

    // bubble to parent
    if (this.providers) return this.providers.get<T>(token);

    throw new ProviderNotAvailableError(tokenName(token), 'not found in local or parent registries');
  }

  // noinspection JSUnusedGlobalSymbols
  addRegistry<T extends RegistryKind>(type: T, value: RegistryType[T]) {
    let registry = this.registries.get(type);
    if (!registry) {
      this.registries.set(type, new Set());
      registry = this.registries.get(type);
    }
    registry!.add(value as any);
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
        throw new PluginDependencyError(`Plugin dependency ${tokenName(t)} must be DEFAULT-scoped at bootstrap`);
      const v = registry.instances.get(t);
      if (v === undefined)
        throw new PluginDependencyError(`Plugin dependency ${tokenName(t)} (DEFAULT scope) is not instantiated`);
      return v;
    }
    throw new PluginDependencyError(`Cannot resolve plugin dependency ${tokenName(t)} (local or parent)`);
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
        throw new ProviderScopedAccessError(tokenName(cls), scName);
      }
      if (!registry.instances.has(cls)) {
        throw new ProviderNotInstantiatedError(tokenName(cls), 'DEFAULT', 'Call providers.instantiate() first');
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
    throw new ProviderNotRegisteredError(
      tokenName(cls),
      'not a registered DEFAULT provider and not a constructable class',
    );
  }

  mergeFromRegistry(
    providedBy: ProviderRegistry,
    exported: {
      token: Token<ProviderInterface>;
      def: ProviderRecord;
      /** Instance may be undefined for CONTEXT-scoped providers (built per-request) */
      instance: ProviderEntry | undefined;
    }[],
  ) {
    for (const { token, def, instance } of exported) {
      // Use default GLOBAL scope when scope is not explicitly set (undefined)
      // This matches the behavior in getProviderScope() and resolveFromViews()
      const scope = def.metadata.scope ?? ProviderScope.GLOBAL;
      if (scope === ProviderScope.GLOBAL && instance !== undefined) {
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
      throw new ProviderNotRegisteredError(
        tokenName(token),
        'not a registered DEFAULT provider and not a constructable class',
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

  async addDynamicProviders(dynamicProviders: ProviderType[]) {
    // Normalize ProviderType[] to ProviderRecord[] before instantiation
    const normalized = dynamicProviders.map((p) => normalizeProvider(p));

    // Register all providers in the graph first
    for (const rec of normalized) {
      const provide = rec.provide;
      this.tokens.add(provide);
      this.defs.set(provide, rec);
      if (!this.graph.has(provide)) {
        this.graph.set(provide, new Set());
      }
      // Add edges for dependencies
      const deps = this.discoveryDeps(rec);
      for (const d of deps) {
        if (this.tokens.has(d)) {
          this.graph.get(provide)!.add(d);
        }
      }
    }

    // Only instantiate GLOBAL-scoped providers (skip CONTEXT-scoped)
    // CONTEXT-scoped providers are built per-request via buildViews()
    const globalProviders = normalized.filter((rec) => this.getProviderScope(rec) === ProviderScope.GLOBAL);
    return Promise.all(globalProviders.map((rec) => this.initiateOne(rec.provide, rec)));
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

  /* -------------------- Session Cache Management -------------------- */

  /**
   * Clean up a specific session's provider cache.
   * Call this when a session is terminated or expired.
   *
   * @param sessionKey - The session identifier to clean up
   */
  cleanupSession(sessionKey: string): void {
    this.sessionStores.delete(sessionKey);
    // Resolve any waiters before deleting the lock to prevent hung promises
    const lock = this.sessionBuildLocks.get(sessionKey);
    if (lock) {
      lock.resolve();
      this.sessionBuildLocks.delete(sessionKey);
    }
  }

  /**
   * Clean up expired sessions from the cache.
   * Sessions older than SESSION_CACHE_TTL_MS are removed.
   *
   * @returns Number of sessions cleaned up
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    const cutoff = now - ProviderRegistry.SESSION_CACHE_TTL_MS;
    let cleaned = 0;

    for (const [key, entry] of this.sessionStores) {
      if (entry.lastAccess < cutoff) {
        this.sessionStores.delete(key);
        // Resolve any waiters before deleting the lock to prevent hung promises
        const lock = this.sessionBuildLocks.get(key);
        if (lock) {
          lock.resolve();
          this.sessionBuildLocks.delete(key);
        }
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Start the background session cleanup timer.
   * This periodically removes expired sessions from the cache.
   */
  startSessionCleanup(): void {
    // Only start if not already running
    if (this.sessionCleanupInterval) {
      return;
    }

    this.sessionCleanupInterval = setInterval(() => {
      const cleaned = this.cleanupExpiredSessions();
      if (cleaned > 0) {
        console.debug(`[ProviderRegistry] Cleaned up ${cleaned} expired sessions`);
      }
    }, ProviderRegistry.SESSION_CLEANUP_INTERVAL_MS);

    // Allow the process to exit even if the interval is running
    // This is important for graceful shutdown in serverless environments
    if (this.sessionCleanupInterval.unref) {
      this.sessionCleanupInterval.unref();
    }
  }

  /**
   * Stop the background session cleanup timer.
   * Call this when shutting down the server gracefully.
   */
  stopSessionCleanup(): void {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }
  }

  /**
   * Dispose of the registry, cleaning up all resources.
   * Call this when the registry/scope is being destroyed to prevent:
   * - Memory leaks from retained interval handles
   * - Orphaned session cleanup timers
   *
   * @example
   * ```typescript
   * // In scope teardown
   * scope.providers.dispose();
   * ```
   */
  dispose(): void {
    this.stopSessionCleanup();
    // Clear all session stores to help garbage collection
    this.sessionStores.clear();
    // Resolve any pending locks to prevent hung promises
    for (const lock of this.sessionBuildLocks.values()) {
      lock.resolve();
    }
    this.sessionBuildLocks.clear();
  }

  /**
   * Get session cache statistics for monitoring.
   */
  getSessionCacheStats(): { enabled: boolean; size: number; maxSize: number; ttlMs: number } {
    return {
      enabled: this.sessionCacheEnabled,
      size: this.sessionStores.size,
      maxSize: ProviderRegistry.MAX_SESSION_CACHE_SIZE,
      ttlMs: ProviderRegistry.SESSION_CACHE_TTL_MS,
    };
  }

  /**
   * Check if session caching is enabled.
   * Returns false in distributed/serverless mode.
   */
  isSessionCacheEnabled(): boolean {
    return this.sessionCacheEnabled;
  }

  /* -------------------- Scoped Provider Views -------------------- */

  /**
   * Build provider instance views for different scopes.
   *
   * This method creates a complete view of providers across all scopes:
   * - GLOBAL: Returns existing singleton instances (read-only)
   * - CONTEXT: Builds per-context providers (unified session + request)
   *
   * Note: For backwards compatibility, SESSION and REQUEST scopes are normalized
   * to CONTEXT. The returned views include `session` and `request` aliases that
   * both point to the `context` store.
   *
   * @param sessionKey - Unique context/session identifier for CONTEXT-scoped providers
   * @param contextProviders - Optional pre-built CONTEXT-scoped providers (e.g., FrontMcpContext)
   * @returns ProviderViews with global and context provider maps (session/request as aliases)
   */
  async buildViews(sessionKey: string, contextProviders?: Map<Token, unknown>): Promise<ProviderViews> {
    // Early validation BEFORE any cache operations or lock acquisition
    // This prevents cache pollution with invalid session keys
    validateSessionId(sessionKey);

    // 1. Global providers - return existing singletons
    const global = this.getAllSingletons();

    // 2. Context providers - use session cache for per-session instances
    // CONTEXT-scoped providers persist within the same session.
    // Multiple calls with the same sessionKey share the same provider instances.
    //
    // In distributed/serverless mode, caching is disabled because sessions may
    // land on different server instances. CONTEXT providers are stateless facades
    // that delegate to storage, so rebuilding them per-request has minimal cost.
    let contextStore: Map<Token, unknown>;

    if (this.sessionCacheEnabled) {
      // Traditional mode: cache providers per session
      let cached = this.sessionStores.get(sessionKey);
      if (!cached) {
        cached = { providers: new Map<Token, unknown>(), lastAccess: Date.now() };
        this.sessionStores.set(sessionKey, cached);
      } else {
        cached.lastAccess = Date.now();
      }
      contextStore = cached.providers;
    } else {
      // Distributed mode: no caching, rebuild providers each request
      contextStore = new Map<Token, unknown>();
    }

    // Merge pre-built context providers (e.g., FrontMcpContext from flow)
    if (contextProviders) {
      for (const [token, instance] of contextProviders) {
        if (!contextStore.has(token)) {
          contextStore.set(token, instance);
        }
      }
    }

    // Build all CONTEXT-scoped providers (including normalized SESSION/REQUEST)
    for (const token of this.order) {
      const rec = this.defs.get(token);
      if (!rec) continue;
      // getProviderScope() already normalizes SESSION/REQUEST → CONTEXT
      if (this.getProviderScope(rec) !== ProviderScope.CONTEXT) continue;
      if (contextStore.has(token)) continue;

      await this.buildIntoStoreWithViews(token, rec, contextStore, sessionKey, contextStore, global);
    }

    // Also build any merged providers that were added via mergeFromRegistry
    // These providers are in defs but not in order (added dynamically by plugins)
    for (const [token, rec] of this.defs) {
      // Skip if already in order (already processed above)
      if (this.order.has(token as any)) continue;
      // Skip non-CONTEXT scoped providers
      if (this.getProviderScope(rec) !== ProviderScope.CONTEXT) continue;
      // Skip if already built
      if (contextStore.has(token)) continue;

      await this.buildIntoStoreWithViews(token, rec, contextStore, sessionKey, contextStore, global);
    }

    return {
      global,
      context: contextStore,
    };
  }

  /**
   * Build a provider into a store, with access to context and global views for dependencies.
   */
  private async buildIntoStoreWithViews(
    token: Token,
    rec: ProviderRecord,
    store: Map<Token, unknown>,
    scopeKey: string,
    contextStore: Map<Token, unknown>,
    globalStore: ReadonlyMap<Token, unknown>,
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
          for (const d of deps) {
            args.push(await this.resolveFromViews(d, contextStore, globalStore, scopeKey));
          }
          const out = (rec as any).useFactory(...args);
          const val = isPromise(out)
            ? await this.withTimeout(out, this.asyncTimeoutMs, `${tokenName(token)}.useFactory(...)`)
            : out;
          store.set(token, val);
          return;
        }
        case ProviderKind.CLASS:
        case ProviderKind.CLASS_TOKEN: {
          const depsTokens = this.invocationTokens(token, rec);
          const deps: any[] = [];
          for (const d of depsTokens) {
            deps.push(await this.resolveFromViews(d, contextStore, globalStore, scopeKey));
          }
          const klass = rec.kind === ProviderKind.CLASS ? (rec as any).useClass : (rec as any).provide;
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
      console.error(`Failed constructing (context-scoped):`, msg);
      throw new ProviderConstructionError(tokenName(token), e instanceof Error ? e : msg, 'context-scoped');
    }
  }

  /**
   * Resolve a dependency from the available views (context → global).
   */
  private async resolveFromViews(
    token: Token,
    contextStore: Map<Token, unknown>,
    globalStore: ReadonlyMap<Token, unknown>,
    scopeKey: string,
  ): Promise<unknown> {
    // Check stores in order: context -> global -> instances
    if (contextStore.has(token)) return contextStore.get(token);
    if (globalStore.has(token)) return globalStore.get(token);
    if (this.instances.has(token)) return this.instances.get(token);

    // Try to build if it's a registered provider
    const rec = this.defs.get(token as any);
    if (rec) {
      const scope = this.getProviderScope(rec);
      if (scope === ProviderScope.GLOBAL) {
        throw new ProviderNotInstantiatedError(tokenName(token), 'GLOBAL');
      } else {
        // CONTEXT scope - build into context store
        await this.buildIntoStoreWithViews(token, rec, contextStore, scopeKey, contextStore, globalStore);
        return contextStore.get(token);
      }
    }

    // Check parent hierarchy
    const up = this.lookupDefInHierarchy(token);
    if (up) {
      const sc = up.registry.getProviderScope(up.rec);
      if (sc === ProviderScope.GLOBAL) {
        const v = up.registry.instances.get(token);
        if (v !== undefined) return v;
        throw new ProviderNotInstantiatedError(tokenName(token), 'GLOBAL', 'parent');
      }
    }

    throw new ProviderDependencyError(`Cannot resolve dependency ${tokenName(token)} from views`);
  }

  /**
   * Get a provider from the given views, checking context → global.
   *
   * @param token - The provider token to look up
   * @param views - The provider views to search
   * @returns The provider instance
   * @throws Error if provider not found in any view
   */
  getScoped<T>(token: Token<T>, views: ProviderViews): T {
    // Check context first (unified session+request store)
    if (views.context.has(token)) return views.context.get(token) as T;
    if (views.global.has(token)) return views.global.get(token) as T;

    // Check instances as fallback for global providers
    if (this.instances.has(token)) return this.instances.get(token) as T;

    throw new ProviderNotAvailableError(tokenName(token), 'not found in views. Ensure it was built via buildViews()');
  }
}
