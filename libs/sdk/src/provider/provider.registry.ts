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
import { SessionKey } from '../context/session-key.provider';

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
  private sessionBuildLocks: Map<string, { promise: Promise<void>; resolve: () => void; generation: number }> =
    new Map();

  /** Generation counter for lock versioning (prevents zombie lock releases after timeout) */
  private lockGeneration = 0;

  /** Maximum number of sessions to cache (LRU eviction) */
  private static readonly MAX_SESSION_CACHE_SIZE = 10000;

  /** Session cache TTL in milliseconds (1 hour) */
  private static readonly SESSION_CACHE_TTL_MS = 3600000;

  /** Cleanup interval in milliseconds (1 minute) */
  private static readonly SESSION_CLEANUP_INTERVAL_MS = 60000;

  /** Lock acquisition timeout in milliseconds (30 seconds) */
  private static readonly SESSION_LOCK_TIMEOUT_MS = 30000;

  /** Handle for the session cleanup interval */
  private sessionCleanupInterval: ReturnType<typeof setInterval> | null = null;

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
        // Use safe logging to avoid Node.js 24 util.inspect bug with Zod errors
        console.error(`Failed instantiating:`, msg);
        throw new Error(`Failed constructing ${tokenName(token)}: ${msg}`);
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
      // Use safe logging to avoid Node.js 24 util.inspect bug with Zod errors
      console.error(`Failed constructing:`, msg);
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

  async addDynamicProviders(dynamicProviders: ProviderType[]) {
    // Normalize ProviderType[] to ProviderRecord[] before instantiation
    const normalized = dynamicProviders.map((p) => normalizeProvider(p));
    return Promise.all(normalized.map((rec) => this.initiateOne(rec.provide, rec)));
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
   * Get or create a session provider store.
   * Implements LRU eviction when cache exceeds MAX_SESSION_CACHE_SIZE.
   */
  private getOrCreateSessionStore(sessionKey: string): Map<Token, unknown> {
    const existing = this.sessionStores.get(sessionKey);
    if (existing) {
      existing.lastAccess = Date.now();
      return existing.providers;
    }

    // Evict oldest session if at capacity
    if (this.sessionStores.size >= ProviderRegistry.MAX_SESSION_CACHE_SIZE) {
      this.evictOldestSession();
    }

    const providers = new Map<Token, unknown>();
    this.sessionStores.set(sessionKey, {
      providers,
      lastAccess: Date.now(),
    });
    return providers;
  }

  /**
   * Evict the oldest session from the cache.
   * Skips sessions with active locks to prevent evicting sessions being built.
   */
  private evictOldestSession(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.sessionStores) {
      // Skip sessions with active locks (currently being built)
      // This prevents race condition where eviction removes a session mid-build
      if (this.sessionBuildLocks.has(key)) continue;

      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.sessionStores.delete(oldestKey);
      // No need to cleanup lock - we skipped locked sessions
    }
  }

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
        // eslint-disable-next-line no-console
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
  getSessionCacheStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.sessionStores.size,
      maxSize: ProviderRegistry.MAX_SESSION_CACHE_SIZE,
      ttlMs: ProviderRegistry.SESSION_CACHE_TTL_MS,
    };
  }

  /**
   * Acquire a lock for session building to prevent race conditions.
   * If another request is building providers for the same session, wait for it.
   *
   * Uses a re-check loop to handle TOCTOU race conditions:
   * After awaiting an existing lock, another request may have created a new lock.
   * The loop ensures we don't overwrite an active lock.
   *
   * Includes a timeout to prevent infinite waits if a lock holder crashes.
   *
   * @returns The lock generation number for use in release (prevents zombie releases)
   */
  private async acquireSessionLock(sessionKey: string): Promise<number> {
    const startTime = Date.now();

    // Re-check loop to handle race between await and lock creation
    while (true) {
      const existing = this.sessionBuildLocks.get(sessionKey);
      if (!existing) break; // No lock held, safe to proceed

      // Check timeout before waiting
      const elapsed = Date.now() - startTime;
      if (elapsed >= ProviderRegistry.SESSION_LOCK_TIMEOUT_MS) {
        // Force-release stale lock and warn
        // eslint-disable-next-line no-console
        console.warn(
          `[ProviderRegistry] Session lock timeout after ${elapsed}ms for ${sessionKey.slice(
            0,
            20,
          )}..., force-releasing`,
        );
        // Resolve the stale lock's promise before deleting (prevents hung waiters)
        existing.resolve();
        this.sessionBuildLocks.delete(sessionKey);
        break;
      }

      // Wait for existing lock with remaining timeout
      // Clear the timeout when existing.promise wins the race to prevent timer leaks
      const remaining = ProviderRegistry.SESSION_LOCK_TIMEOUT_MS - elapsed;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(resolve, remaining);
      });
      await Promise.race([existing.promise, timeoutPromise]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      // After await, loop back to re-check - another request may have created a new lock
    }

    // Now safe to create our lock with unique generation
    // Overflow protection: reset counter if approaching MAX_SAFE_INTEGER
    if (this.lockGeneration >= Number.MAX_SAFE_INTEGER - 1) {
      // eslint-disable-next-line no-console
      console.warn('[ProviderRegistry] Lock generation counter reset to prevent overflow');
      this.lockGeneration = 0;
    }
    const myGeneration = ++this.lockGeneration;
    let resolveFunc: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      resolveFunc = resolve;
    });
    this.sessionBuildLocks.set(sessionKey, { promise, resolve: resolveFunc, generation: myGeneration });
    return myGeneration;
  }

  /**
   * Release the session build lock.
   *
   * Only releases if the provided generation matches the current lock's generation.
   * This prevents zombie releases where a timed-out lock holder tries to release
   * a lock that has already been force-released and potentially re-acquired.
   *
   * @param sessionKey - The session identifier
   * @param expectedGeneration - The generation returned from acquireSessionLock
   */
  private releaseSessionLock(sessionKey: string, expectedGeneration: number): void {
    const lock = this.sessionBuildLocks.get(sessionKey);
    if (lock && lock.generation === expectedGeneration) {
      lock.resolve();
      this.sessionBuildLocks.delete(sessionKey);
    }
    // If generation doesn't match, this is a zombie release after timeout - ignore silently
  }

  /* -------------------- Scoped Provider Views -------------------- */

  /**
   * Build provider instance views for different scopes.
   *
   * This method creates a complete view of providers across all scopes:
   * - GLOBAL: Returns existing singleton instances (read-only)
   * - SESSION: Gets/creates cached providers for the session (reused across requests)
   * - REQUEST: Builds fresh providers for each request (never cached)
   *
   * @param sessionKey - Unique session identifier for SESSION-scoped providers
   * @param requestProviders - Optional pre-built REQUEST-scoped providers (e.g., RequestContext)
   * @returns ProviderViews with global, session, and request provider maps
   */
  async buildViews(sessionKey: string, requestProviders?: Map<Token, unknown>): Promise<ProviderViews> {
    // Early validation BEFORE any cache operations or lock acquisition
    // This prevents cache pollution with invalid session keys
    SessionKey.validate(sessionKey);

    // 1. Global providers - return existing singletons
    const global = this.getAllSingletons();

    // 2. Session providers - get from cache or build
    // Acquire lock to prevent concurrent builds for the same session (race condition)
    // Store the generation to pass to releaseSessionLock (prevents zombie releases)
    const lockGeneration = await this.acquireSessionLock(sessionKey);

    let sessionStore: Map<Token, unknown>;
    try {
      sessionStore = this.getOrCreateSessionStore(sessionKey);

      // Inject SessionKey as first provider in session store
      // This allows SESSION-scoped providers to inject the session ID via class token
      if (!sessionStore.has(SessionKey)) {
        sessionStore.set(SessionKey, new SessionKey(sessionKey));
      }

      // Build SESSION-scoped providers
      for (const token of this.order) {
        const rec = this.defs.get(token);
        if (!rec) continue;
        if (this.getProviderScope(rec) !== ProviderScope.SESSION) continue;
        if (sessionStore.has(token)) continue;

        await this.buildIntoStore(token, rec, sessionStore as Map<Token, any>, sessionKey);
      }
    } catch (error) {
      // On error, cleanup partial session state to prevent inconsistent providers
      // Only delete session store, NOT the lock - let finally block handle lock release
      // This prevents a race where cleanupSession deletes the lock before releaseSessionLock
      this.sessionStores.delete(sessionKey);
      throw error;
    } finally {
      // Always release the lock with generation (prevents zombie releases after timeout)
      this.releaseSessionLock(sessionKey, lockGeneration);
    }

    // 3. Request providers - always build fresh (no locking needed, they're per-request)
    const request = new Map<Token, unknown>(requestProviders);

    for (const token of this.order) {
      const rec = this.defs.get(token);
      if (!rec) continue;
      if (this.getProviderScope(rec) !== ProviderScope.REQUEST) continue;

      // Pass combined stores for dependency resolution
      // Request providers can depend on session and global providers
      await this.buildIntoStoreWithViews(token, rec, request, sessionKey, sessionStore, global);
    }

    return {
      global,
      session: sessionStore,
      request,
    };
  }

  /**
   * Build a provider into a store, with access to session and global views for dependencies.
   */
  private async buildIntoStoreWithViews(
    token: Token,
    rec: ProviderRecord,
    store: Map<Token, unknown>,
    scopeKey: string,
    sessionStore: Map<Token, unknown>,
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
            args.push(await this.resolveFromViews(d, store, sessionStore, globalStore, scopeKey));
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
            deps.push(await this.resolveFromViews(d, store, sessionStore, globalStore, scopeKey));
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
      console.error(`Failed constructing (request-scoped):`, msg);
      throw new Error(`Failed constructing (request-scoped) ${tokenName(token)}: ${msg}`);
    }
  }

  /**
   * Resolve a dependency from the available views (request → session → global).
   */
  private async resolveFromViews(
    token: Token,
    requestStore: Map<Token, unknown>,
    sessionStore: Map<Token, unknown>,
    globalStore: ReadonlyMap<Token, unknown>,
    scopeKey: string,
  ): Promise<unknown> {
    // Check stores in order: request -> session -> global -> instances
    if (requestStore.has(token)) return requestStore.get(token);
    if (sessionStore.has(token)) return sessionStore.get(token);
    if (globalStore.has(token)) return globalStore.get(token);
    if (this.instances.has(token)) return this.instances.get(token);

    // Try to build if it's a registered provider
    const rec = this.defs.get(token as any);
    if (rec) {
      const scope = this.getProviderScope(rec);
      if (scope === ProviderScope.GLOBAL) {
        throw new Error(`GLOBAL dependency ${tokenName(token)} is not instantiated`);
      } else if (scope === ProviderScope.SESSION) {
        await this.buildIntoStore(token, rec, sessionStore as Map<Token, any>, scopeKey);
        return sessionStore.get(token);
      } else {
        // REQUEST scope - build into request store
        await this.buildIntoStoreWithViews(token, rec, requestStore, scopeKey, sessionStore, globalStore);
        return requestStore.get(token);
      }
    }

    // Check parent hierarchy
    const up = this.lookupDefInHierarchy(token);
    if (up) {
      const sc = up.registry.getProviderScope(up.rec);
      if (sc === ProviderScope.GLOBAL) {
        const v = up.registry.instances.get(token);
        if (v !== undefined) return v;
        throw new Error(`GLOBAL dependency ${tokenName(token)} is not instantiated in parent`);
      }
    }

    throw new Error(`Cannot resolve dependency ${tokenName(token)} from views`);
  }

  /**
   * Get a provider from the given views, checking request → session → global.
   *
   * @param token - The provider token to look up
   * @param views - The provider views to search
   * @returns The provider instance
   * @throws Error if provider not found in any view
   */
  getScoped<T>(token: Token<T>, views: ProviderViews): T {
    if (views.request.has(token)) return views.request.get(token) as T;
    if (views.session.has(token)) return views.session.get(token) as T;
    if (views.global.has(token)) return views.global.get(token) as T;

    // Check instances as fallback for global providers
    if (this.instances.has(token)) return this.instances.get(token) as T;

    throw new Error(`Provider ${tokenName(token)} not found in views. Ensure it was built via buildViews().`);
  }
}
