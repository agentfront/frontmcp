// invoker/invoker.factory.ts
import {Invoker} from './invoker';
import type {
  BindingsGetter,
  HooksByStage,
  InvokeBaseContext,
  ProviderBinding,
  ProviderGettersOption,
  ScopeKeyExtractor,
} from './invoker.types';

import {MCP_HOOK_ORIGIN_RESOLVE} from '../plugin/plugin.tokens';
import {AppLocalInstance} from '../app/instances';
import {Scope} from '../scope';
import {FlowName, ProviderScope, Token} from '@frontmcp/sdk';

// ---------- scope key extractor (strict) ----------
export function compileScopeExtractor<Ctx = any>(overrides?: ScopeKeyExtractor<Ctx>): ScopeKeyExtractor<Ctx> {
  if (overrides) return overrides;
  // Strict: trust ctx.* only; unauth flows will be undefined.
  return (ctx: any) => ({ sessionId: ctx?.sessionId, requestId: ctx?.requestId });
}

// ---------- normalize custom getters ----------
function normalizeCustomGetters<Ctx extends InvokeBaseContext>(
  opt?: ProviderGettersOption<Ctx>,
): {
  before: BindingsGetter<Ctx>[];
  after: BindingsGetter<Ctx>[];
} {
  if (!opt) return { before: [], after: [] };
  if (Array.isArray(opt)) return { before: opt, after: [] };
  return {
    before: opt.before ?? [],
    after: opt.after ?? [],
  };
}

// ---------- helpers: materialize bindings from a ProviderRegistry "views" ----------
type Views = {
  global: Map<Token, unknown>;
  session: Map<Token, unknown>;
  request: Map<Token, unknown>;
};

function viewsToBindings(views: Views): ProviderBinding[] {
  const out: ProviderBinding[] = [];
  for (const [t, v] of views.global) out.push([t, v, ProviderScope.GLOBAL]);
  for (const [t, v] of views.session) out.push([t, v, ProviderScope.SESSION]);
  for (const [t, v] of views.request) out.push([t, v, ProviderScope.REQUEST]);
  return out;
}

/**
 * Build getters for the active scope (and optional app).
 * Order matters (first-wins):
 *   1) app.providers (if provided)
 *   2) scope.providers
 */
function makeScopeGetters(scope: Scope, app?: AppLocalInstance): BindingsGetter<any>[] {
  const g: BindingsGetter<any>[] = [];

  if (app) {
    g.push(async ({ ctx }) => {
      const views = await app.providers.buildViews((ctx as any).sessionId);
      return viewsToBindings(views as any);
    });
  }

  g.push(async ({ ctx }) => {
    const views = await scope.providers.buildViews((ctx as any).sessionId);
    return viewsToBindings(views as any);
  });

  return g;
}

/** Resolve with precedence: originResolve → app.providers → scope.providers → new C() */
function compileResolve(scope: Scope, app?: AppLocalInstance) {
  return function resolve<T>(C: any): T {
    const originResolve = (C as any)[MCP_HOOK_ORIGIN_RESOLVE] as ((x: any) => T) | undefined;
    if (typeof originResolve === 'function') {
      try {
        return originResolve(C);
      } catch {
        /* fallback chain continues */
      }
    }
    if (app) {
      try {
        const v = app.providers.resolve<T>(C);
        if (v !== undefined) return v;
      } catch {/* noop */}
    }
    try {
      const v = scope.providers.resolve<T>(C);
      if (v !== undefined) return v;
    } catch {/* noop */}
    return new C() as T;
  };
}

/** Collect hooks from the app (if any) and tag origin for per-hook provider overlays */
function collectHooksByStage(scope: Scope, app: AppLocalInstance | undefined, ns: FlowName): HooksByStage {
  if (!app) return {};
  const appHooks = app.plugins.collectHooksByStage(ns);
  const out: HooksByStage = {};
  for (const stage of Object.keys(appHooks)) {
    out[stage] = appHooks[stage].map((h: any) => Object.assign({}, h, {__originApp: app}));
  }
  return out;
}

// ---------- main factory ----------
export function makeRouteInvoker(
  scope: Scope,
  namespace: FlowName,
  opts?: {
    /** Optional app context (e.g., when executing a tool in an app) */
    app?: AppLocalInstance;
    scopeKeys?: ScopeKeyExtractor;
    /** inject custom provider getters; use `before` to override, `after` for lower precedence */
    providerGetters?: ProviderGettersOption;
  },
) {
  const app = opts?.app;
  const resolve = compileResolve(scope, app);
  const pluginHooksByStage = collectHooksByStage(scope, app, namespace);
  const scopeKeys = compileScopeExtractor(opts?.scopeKeys);
  const { before, after } = normalizeCustomGetters(opts?.providerGetters);

  const invoker = new Invoker({
    providers: {
      baseGetters: before, // run BEFORE registry getters (higher precedence)
      // name kept for backward-compat; closure ignores the param
      fromApps: () => [...makeScopeGetters(scope, app), ...after],
      scopeKeysFromCtx: scopeKeys,
    },
    invokerProvider: true,
    defaultExtras: { resolve }, // stable across requests for this scope/app route
  });

  // base extras are immutable per route
  const baseExtras = { scope, app, pluginHooksByStage, /* compat for older code */ apps: app ? [app] : [] };

  return { invoker, baseExtras };
}
