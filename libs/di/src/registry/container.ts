/**
 * Core dependency injection container.
 *
 * DiContainer provides:
 * - Token-based dependency registration and resolution
 * - Hierarchical provider lookup (parent-child registries)
 * - GLOBAL and CONTEXT scoped providers
 * - Dependency graph with cycle detection
 * - Topological sorting for initialization order
 *
 * This is the base container that can be extended with additional
 * features like session caching.
 */

import 'reflect-metadata';
import type { Token, Type, Ctor } from '../interfaces/base.interface.js';
import type { ProviderType } from '../interfaces/provider.interface.js';
import type { DiContainerInterface, DiViews } from '../interfaces/registry.interface.js';
import { ProviderKind, type ProviderRecord, type ProviderInjectedRecord } from '../records/provider.record.js';
import { ProviderScope } from '../metadata/provider.metadata.js';
import { RegistryAbstract, type RegistryBuildMapResult } from './registry.base.js';
import { tokenName, isClass, isPromise, depsOfClass } from '../utils/token.utils.js';
import { hasAsyncWith } from '../utils/metadata.utils.js';
import {
  createProviderNormalizer,
  providerDiscoveryDeps,
  providerInvocationTokens,
  type ProviderTokens,
} from '../utils/provider.utils.js';

/**
 * Entry wrapper for provider instances.
 * Can be extended by subclasses with additional metadata.
 */
export interface ProviderEntry {
  instance: unknown;
}

/**
 * Options for creating a DiContainer.
 */
export interface DiContainerOptions {
  /**
   * Metadata tokens for reading provider information from decorated classes.
   * If not provided, only static metadata and object-style providers are supported.
   */
  providerTokens?: ProviderTokens;

  /**
   * Timeout for async operations in milliseconds.
   * @default 30000
   */
  asyncTimeoutMs?: number;
}

/**
 * Core dependency injection container.
 *
 * @typeParam ParentType - Type of the parent container (for hierarchy)
 *
 * @example
 * ```typescript
 * class MyService {
 *   static metadata = { name: 'MyService', scope: ProviderScope.GLOBAL };
 * }
 *
 * const container = new DiContainer([MyService]);
 * await container.ready;
 *
 * const service = container.get(MyService);
 * ```
 */
export class DiContainer<ParentType extends DiContainer<any> | undefined = undefined>
  extends RegistryAbstract<ProviderEntry, ProviderRecord, ProviderType[], ParentType>
  implements DiContainerInterface
{
  /** Topological order for initialization (deps first) */
  private order: Set<Token> = new Set();

  /** Provider normalizer function */
  private readonly normalizeProvider: (item: ProviderType) => ProviderRecord;

  /** Parent container for hierarchical lookup */
  private readonly parentContainer: ParentType;

  /**
   * Create a new DI container.
   *
   * @param providers - Array of provider definitions
   * @param parent - Optional parent container for hierarchical lookup
   * @param options - Container configuration options
   */
  constructor(providers: ProviderType[], parent?: ParentType, options: DiContainerOptions = {}) {
    // Create normalizer with provided tokens or a basic fallback
    const normalizer = options.providerTokens
      ? createProviderNormalizer({ tokens: options.providerTokens })
      : createBasicNormalizer();

    super('DiContainer', parent as ParentType, providers, false);

    this.normalizeProvider = normalizer;
    this.parentContainer = parent as ParentType;

    if (options.asyncTimeoutMs) {
      this.asyncTimeoutMs = options.asyncTimeoutMs;
    }

    this.buildGraph();
    this.topoSort();
    this.ready = this.initialize();
  }

  /* -------------------- Hierarchy helpers -------------------- */

  /**
   * Walk up the registry chain to find a def for a token.
   */
  private lookupDefInHierarchy(token: Token): { registry: DiContainer<any>; rec: ProviderRecord } | undefined {
    if (this.defs.has(token as any)) {
      return { registry: this, rec: this.defs.get(token as any)! };
    }
    return this.parentContainer?.lookupDefInHierarchy(token);
  }

  /**
   * Resolve a GLOBAL-scoped dependency from the hierarchy.
   */
  private resolveDefaultFromHierarchy(token: Token): any {
    const found = this.lookupDefInHierarchy(token);
    if (!found) {
      throw new Error(`Cannot resolve token ${tokenName(token)}: not registered in hierarchy.`);
    }

    const { registry, rec } = found;
    const sc = registry.getProviderScope(rec);

    if (sc !== ProviderScope.GLOBAL) {
      throw new Error(
        `Dependency ${tokenName(token)} is scoped (${sc}) in ${registry.constructor.name}; cannot use as GLOBAL.`,
      );
    }

    const inst = registry.instances.get(token);
    if (inst === undefined) {
      throw new Error(`Dependency ${tokenName(token)} (GLOBAL) is not instantiated in ${registry.constructor.name}`);
    }

    return inst;
  }

  /* -------------------- Build phase -------------------- */

  protected override buildMap(list: ProviderType[]): RegistryBuildMapResult<ProviderRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, ProviderRecord>();
    const graph = new Map<Token, Set<Token>>();

    // Use the normalizer stored on this or fall back to basic
    const normalize = (this as any).normalizeProvider ?? createBasicNormalizer();

    for (const raw of list) {
      const rec = normalize(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }

    return { tokens, defs, graph };
  }

  protected buildGraph(): void {
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
            `Invalid dependency: GLOBAL-scoped provider ${tokenName(
              token,
            )} cannot depend on scoped provider ${tokenName(d)}.`,
          );
        }

        // Only wire local -> local edges in our local graph
        if (isLocal) {
          this.graph.get(token)!.add(d);
        }
      }
    }
  }

  /**
   * Topological sort with cycle detection.
   */
  protected topoSort(): void {
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

    for (const n of this.graph.keys()) {
      if ((color.get(n) ?? WHITE) === WHITE) dfs(n);
    }

    this.order = order;
  }

  protected async initialize(opts?: { force?: boolean; onlyTokens?: Iterable<Token> }): Promise<void> {
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
        await this.instantiateOne(token, rec);
      } catch (e: any) {
        const msg = e?.message ?? e;
        throw new Error(`Failed constructing ${tokenName(token)}: ${msg}`);
      }
    }
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

  private async resolveFactoryArg(t: Token, store: Map<Token, any>): Promise<any> {
    if (store.has(t)) return store.get(t);
    if (this.instances.has(t)) return this.instances.get(t);

    // Local def?
    const rec = this.defs.get(t as any);
    if (rec) {
      const sc = this.getProviderScope(rec);
      if (sc === ProviderScope.GLOBAL) {
        if (!this.instances.has(t)) {
          throw new Error(`Dependency ${tokenName(t)} (GLOBAL scope) is not instantiated`);
        }
        return this.instances.get(t);
      } else {
        await this.buildIntoStore(t, rec, store);
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
          throw new Error(`Dependency ${tokenName(t)} (GLOBAL scope) is not instantiated in parent`);
        }
        return inst;
      } else {
        await up.registry.buildIntoStore(t, up.rec, store);
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

  private async instantiateOne(token: Token, rec: ProviderRecord): Promise<void> {
    switch (rec.kind) {
      case ProviderKind.VALUE: {
        this.instances.set(token, (rec as any).useValue);
        return;
      }

      case ProviderKind.FACTORY: {
        const deps = this.invocationTokens(token, rec);
        const args: any[] = [];
        for (const d of deps) {
          args.push(await this.resolveFactoryArg(d, this.instances as Map<Token, any>));
        }
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

  /**
   * Build a scoped provider into the given store.
   */
  protected async buildIntoStore(token: Token, rec: ProviderRecord, store: Map<Token, any>): Promise<void> {
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
            args.push(await this.resolveFactoryArg(d, store));
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
            deps.push(await this.resolveManagedForClass(d, store));
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
      throw new Error(`Failed constructing (scoped) ${tokenName(token)}: ${msg}`);
    }
  }

  private async resolveManagedForClass(d: Token, store: Map<Token, any>): Promise<any> {
    if (store.has(d)) return store.get(d);
    if (this.instances.has(d)) return this.instances.get(d);

    // Local DI?
    const depRec = this.defs.get(d as any);
    if (depRec) {
      const sc = this.getProviderScope(depRec);
      if (sc === ProviderScope.GLOBAL) {
        const v = this.instances.get(d);
        if (v === undefined) throw new Error(`${tokenName(d)} (GLOBAL scope) is not instantiated`);
        return v;
      } else {
        await this.buildIntoStore(d, depRec, store);
        return store.get(d);
      }
    }

    // Parent DI?
    const up = this.lookupDefInHierarchy(d);
    if (up) {
      const sc = up.registry.getProviderScope(up.rec);
      if (sc === ProviderScope.GLOBAL) {
        const v = up.registry.instances.get(d);
        if (v === undefined) throw new Error(`${tokenName(d)} (GLOBAL scope) is not instantiated in parent`);
        return v;
      } else {
        await up.registry.buildIntoStore(d, up.rec, store);
        return store.get(d);
      }
    }

    throw new Error(`${tokenName(d)} is not instantiated`);
  }

  /* -------------------- Public API -------------------- */

  /**
   * Get a GLOBAL-scoped provider by token.
   *
   * @throws If the provider is scoped or not registered
   */
  get<T>(token: Token<T>): T {
    if (this.instances.has(token)) return this.instances.get(token) as T;

    const rec = this.defs.get(token as any);
    if (rec && this.getProviderScope(rec) !== ProviderScope.GLOBAL) {
      throw new Error(
        `Provider ${tokenName(token)} is scoped (${this.getProviderScope(rec)}). Use getScoped(token, views).`,
      );
    }

    // Bubble to parent
    if (this.parentContainer) return this.parentContainer.get<T>(token);

    throw new Error(`Provider ${tokenName(token)} is not available in local or parent registries`);
  }

  /**
   * Resolve a dependency by token or class.
   * If not registered, attempts to construct the class directly.
   */
  resolve<T>(cls: Token<T>): T {
    // Check if it's a registered token
    const found = this.lookupDefInHierarchy(cls);
    if (found) {
      const { registry, rec } = found;
      const sc = registry.getProviderScope(rec);
      if (sc !== ProviderScope.GLOBAL) {
        throw new Error(
          `Provider ${tokenName(cls)} is scoped (${sc}). Use getScoped(token, views) or buildViews(...).`,
        );
      }
      if (!registry.instances.has(cls)) {
        throw new Error(
          `Provider ${tokenName(cls)} (GLOBAL scope) is not instantiated. Call await container.ready first.`,
        );
      }
      return registry.instances.get(cls) as T;
    }

    // Not registered — best-effort construct
    if (isClass(cls)) {
      const instance = new (cls as Ctor<any>)();
      const init = (instance as any)?.init;
      if (typeof init === 'function') {
        const result = init.call(instance);
        if (isPromise(result)) {
          throw new Error(
            `Cannot use resolve() with async init() for ${
              (cls as any).name ?? 'unknown'
            }. Use get() after initialize() instead.`,
          );
        }
      }
      return instance as T;
    }

    throw new Error(
      `Cannot resolve ${tokenName(cls)}: not a registered GLOBAL provider and not a constructable class.`,
    );
  }

  /**
   * Try to get a provider, returning undefined if not found.
   */
  tryGet<T>(token: Token<T>): T | undefined {
    try {
      return this.get(token);
    } catch {
      return undefined;
    }
  }

  /**
   * Normalize deprecated scopes to their modern equivalents.
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

  /**
   * Get the scope of a provider record.
   */
  getProviderScope(rec: ProviderRecord): ProviderScope {
    const rawScope = rec.metadata?.scope ?? ProviderScope.GLOBAL;
    return this.normalizeScope(rawScope);
  }

  /**
   * Get all discovered dependencies for a provider record.
   */
  discoveryDeps(rec: ProviderRecord): Token[] {
    return providerDiscoveryDeps(rec, this.tokens, (k, phase) => depsOfClass(k, phase));
  }

  /**
   * Get invocation tokens for a provider record.
   */
  invocationTokens(_token: Token, rec: ProviderRecord): Token[] {
    return providerInvocationTokens(rec, (k, phase) => depsOfClass(k, phase));
  }

  /**
   * Return the singleton map as a read-only view.
   */
  getAllSingletons(): ReadonlyMap<Token, unknown> {
    return this.instances;
  }

  /**
   * Build provider views for different scopes.
   *
   * @param sessionKey - Unique key for this context/session
   * @param contextProviders - Optional pre-built CONTEXT providers
   * @returns Views with global and context provider maps
   */
  async buildViews(sessionKey: string, contextProviders?: Map<Token, unknown>): Promise<DiViews> {
    const global = this.getAllSingletons();
    const contextStore = new Map<Token, unknown>(contextProviders);

    // Build all CONTEXT-scoped providers
    for (const token of this.order) {
      const rec = this.defs.get(token);
      if (!rec) continue;
      if (this.getProviderScope(rec) !== ProviderScope.CONTEXT) continue;
      if (contextStore.has(token)) continue;

      await this.buildIntoStoreWithViews(token, rec, contextStore, global);
    }

    return { global, context: contextStore };
  }

  private async buildIntoStoreWithViews(
    token: Token,
    rec: ProviderRecord,
    contextStore: Map<Token, unknown>,
    globalStore: ReadonlyMap<Token, unknown>,
  ): Promise<void> {
    if (contextStore.has(token)) return;

    try {
      switch (rec.kind) {
        case ProviderKind.VALUE: {
          contextStore.set(token, (rec as any).useValue);
          return;
        }

        case ProviderKind.FACTORY: {
          const deps = this.invocationTokens(token, rec);
          const args: any[] = [];
          for (const d of deps) {
            args.push(await this.resolveFromViews(d, contextStore, globalStore));
          }
          const out = (rec as any).useFactory(...args);
          const val = isPromise(out)
            ? await this.withTimeout(out, this.asyncTimeoutMs, `${tokenName(token)}.useFactory(...)`)
            : out;
          contextStore.set(token, val);
          return;
        }

        case ProviderKind.CLASS:
        case ProviderKind.CLASS_TOKEN: {
          const depsTokens = this.invocationTokens(token, rec);
          const deps: any[] = [];
          for (const d of depsTokens) {
            deps.push(await this.resolveFromViews(d, contextStore, globalStore));
          }
          const klass = rec.kind === ProviderKind.CLASS ? (rec as any).useClass : (rec as any).provide;

          if (hasAsyncWith(klass)) {
            const out = (klass as any).with(...deps);
            const val = isPromise(out)
              ? await this.withTimeout(out, this.asyncTimeoutMs, `${klass.name}.with(...)`)
              : out;
            contextStore.set(token, val);
          } else {
            const instance = new (klass as Ctor<any>)(...deps);
            const init = (instance as any)?.init;
            if (typeof init === 'function') {
              const ret = init.call(instance);
              if (isPromise(ret)) await this.withTimeout(ret, this.asyncTimeoutMs, `${klass.name}.init()`);
            }
            contextStore.set(token, instance);
          }
          return;
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? e;
      throw new Error(`Failed constructing (context-scoped) ${tokenName(token)}: ${msg}`);
    }
  }

  private async resolveFromViews(
    token: Token,
    contextStore: Map<Token, unknown>,
    globalStore: ReadonlyMap<Token, unknown>,
  ): Promise<unknown> {
    if (contextStore.has(token)) return contextStore.get(token);
    if (globalStore.has(token)) return globalStore.get(token);
    if (this.instances.has(token)) return this.instances.get(token);

    // Try to build if it's a registered provider
    const rec = this.defs.get(token as any);
    if (rec) {
      const scope = this.getProviderScope(rec);
      if (scope === ProviderScope.GLOBAL) {
        throw new Error(`GLOBAL dependency ${tokenName(token)} is not instantiated`);
      } else {
        await this.buildIntoStoreWithViews(token, rec, contextStore, globalStore);
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
        throw new Error(`GLOBAL dependency ${tokenName(token)} is not instantiated in parent`);
      }
    }

    throw new Error(`Cannot resolve dependency ${tokenName(token)} from views`);
  }

  /**
   * Get a provider from views.
   */
  getScoped<T>(token: Token<T>, views: DiViews): T {
    if (views.context.has(token)) return views.context.get(token) as T;
    if (views.global.has(token)) return views.global.get(token) as T;
    if (this.instances.has(token)) return this.instances.get(token) as T;

    throw new Error(`Provider ${tokenName(token)} not found in views. Ensure it was built via buildViews().`);
  }

  /**
   * Inject a pre-instantiated provider.
   */
  injectProvider(injected: Omit<ProviderInjectedRecord, 'kind'>): void {
    const rec: ProviderInjectedRecord = {
      ...injected,
      kind: ProviderKind.INJECTED,
    };
    this.tokens.add(rec.provide);
    this.defs.set(rec.provide, rec);
    this.graph.set(rec.provide, new Set());
    this.instances.set(rec.provide, rec.value);
  }
}

/**
 * Create a basic normalizer that only uses static metadata.
 */
function createBasicNormalizer() {
  return function normalizeProvider(item: ProviderType): ProviderRecord {
    if (isClass(item)) {
      const staticMeta = (item as any).metadata;
      return {
        kind: ProviderKind.CLASS_TOKEN,
        provide: item as Type,
        metadata: staticMeta ?? { name: (item as any).name ?? 'UnknownProvider' },
      };
    }

    const obj = item as any;

    if ('useValue' in obj) {
      if (!obj.provide) {
        throw new Error(`Provider with useValue must have a 'provide' field`);
      }
      return {
        kind: ProviderKind.VALUE,
        provide: obj.provide,
        useValue: obj.useValue,
        metadata: obj.metadata ?? { name: 'ValueProvider' },
      };
    }

    if ('useFactory' in obj) {
      if (!obj.provide) {
        throw new Error(`Provider with useFactory must have a 'provide' field`);
      }
      return {
        kind: ProviderKind.FACTORY,
        provide: obj.provide,
        inject: obj.inject ?? (() => []),
        useFactory: obj.useFactory,
        metadata: obj.metadata ?? { name: 'FactoryProvider' },
      };
    }

    if ('useClass' in obj) {
      if (!obj.provide) {
        throw new Error(`Provider with useClass must have a 'provide' field`);
      }
      return {
        kind: ProviderKind.CLASS,
        provide: obj.provide,
        useClass: obj.useClass,
        metadata: obj.metadata ?? { name: (obj.useClass as any)?.name ?? 'ClassProvider' },
      };
    }

    throw new Error(`Cannot normalize provider: unrecognized format`);
  };
}
