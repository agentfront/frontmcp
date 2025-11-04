// invoker/invoker.ts

import {
  capitalize,
  defaultSortForStage,
  isControlResponse,
  makeDefaultCollector,
  stripBootstrapStages,
} from './invoker.utils';
import {
  AllStages,
  InvokeBaseContext,
  InvokerHook,
  InvokerOptions,
  Prefixed,
  RunStageOptions,
  StageFn,
  InvokePhase,
  FlowSpec,
  RunExtras,
  HookCollector,
  SortForStage,
  ProviderBinding,
  ProvidersConfig,
  InvokerOptionsWithProviders,
  BindingsGetter,
  INVOKER_BRAND_SYMBOL,
} from './invoker.types';

import { ProviderScope, Token } from '@frontmcp/sdk';
import { appViewsFor } from './invoker.bindings';
import { AppLocalInstance } from '../app/instances';

// ===== helper: merge/evaluate bindings/maps =====

function mergeBindingsFirstWins(...lists: (ProviderBinding[] | undefined)[]): ProviderBinding[] {
  const byScope = new Map<ProviderScope, Map<Token, unknown>>();
  for (const list of lists) {
    if (!list) continue;
    for (const [token, value, scope] of list) {
      const m = byScope.get(scope) ?? new Map<Token, unknown>();
      if (!m.has(token)) m.set(token, value); // FIRST-WINS
      byScope.set(scope, m);
    }
  }
  const out: ProviderBinding[] = [];
  for (const [scope, m] of byScope) for (const [t, v] of m) out.push([t, v, scope]);
  return out;
}

function overlayProviderMaps(top: Map<ProviderScope, Map<Token, unknown>>, base: Map<ProviderScope, Map<Token, unknown>>) {
  const out = new Map<ProviderScope, Map<Token, unknown>>();
  for (const scope of [ProviderScope.GLOBAL, ProviderScope.SESSION, ProviderScope.REQUEST]) {
    const topMap = top.get(scope) ?? new Map();
    const baseMap = base.get(scope) ?? new Map();
    const merged = new Map<Token, unknown>(baseMap); // base first
    for (const [t, v] of topMap) if (!merged.has(t)) merged.set(t, v); // top wins (first-wins)
    out.set(scope, merged);
  }
  return out;
}

// cache symbol for per-run app views
const RUN_VIEWS_CACHE = Symbol('invoker:viewsCache');

// ===== Invoker =====

// ASCII timeline depth across nested flows
let LOG_DEPTH = 0;

function barsPrefix(slash = true): string {
  if (LOG_DEPTH <= 0) return '';
  if (LOG_DEPTH <= 1) return slash ? '|   ' : '';
  return (
    '|' +
    Array.from({ length: LOG_DEPTH - 1 })
      .map(() => '        ')
      .join('') +
    `${slash ? '|   ' : ''}`
  );
}

export class Invoker<BaseStage extends string = string> {
  private readonly collector: HookCollector<BaseStage, any>;
  private readonly sortForStage: SortForStage<BaseStage, any>;
  private readonly defaultExtras?: Partial<RunExtras<BaseStage>>;
  private readonly providersCfg?: ProvidersConfig;

  constructor(readonly opts: InvokerOptions<BaseStage> & InvokerOptionsWithProviders<BaseStage>) {
    this.collector = opts?.collector ?? makeDefaultCollector();
    this.sortForStage = opts?.sortForStage ?? defaultSortForStage;
    this.defaultExtras = opts?.defaultExtras;
    this.providersCfg = opts?.providers;
  }

  private pref(name: 'will' | 'around' | 'did', base: BaseStage): Prefixed<BaseStage> {
    return `${name}${capitalize(base)}` as Prefixed<BaseStage>;
  }

  // ---- stage runner with per-hook origin overlay
  private async runStage<Ctx extends InvokeBaseContext>(
    stage: AllStages<BaseStage>,
    options: RunStageOptions<Ctx, BaseStage>,
    phase: InvokePhase,
  ): Promise<InvokerHook<InvokeBaseContext, AllStages<BaseStage>>[] | void> {
    const hooks = await this.collector(stage, {
      resolve: options.resolve,
      pluginHooksByStage: options.pluginHooksByStage,
      localHooksByStage: options.localHooksByStage,
      fnHooksProvider: options.fnHooksProvider,
      ctx: options.ctx,
    });

    if (!hooks.length) return options.collectOnly ? [] : undefined;

    const active: InvokerHook<InvokeBaseContext, AllStages<BaseStage>>[] = [];
    for (const h of hooks) {
      const ok = h.filter ? await h.filter(options.ctx as InvokeBaseContext) : true;
      if (ok) active.push(h);
    }

    const ordered = this.sortForStage(stage, active);
    if (options.collectOnly) return ordered;

    options.ctx.mark?.(String(stage), phase);

    for (const h of ordered) {
      const fn = (h as Record<string, StageFn<InvokeBaseContext> | undefined>)[stage as string];
      if (typeof fn !== 'function') continue;
      console.log(`${barsPrefix()}  - ${String(stage)}`);
      await this.withProvidersForHook(h, options.ctx as InvokeBaseContext, async () => {
        options.ctx.mark?.(String(stage), phase);
        await fn(options.ctx as InvokeBaseContext);
      });
    }
  }

  private async wrapWithAround<Ctx extends InvokeBaseContext, T>(
    aroundStage: Prefixed<BaseStage>,
    exec: () => Promise<T>,
    options: RunStageOptions<Ctx, BaseStage>,
    phase: InvokePhase,
  ): Promise<T> {
    const ordered = (await this.runStage(aroundStage, { ...options, collectOnly: true }, phase)) as
      | InvokerHook<InvokeBaseContext, AllStages<BaseStage>>[]
      | undefined;

    if (!ordered?.length) return exec();

    let next: () => Promise<unknown> = exec;
    for (let i = ordered.length - 1; i >= 0; i--) {
      const h = ordered[i];
      const ok = await (h.filter?.(options.ctx as InvokeBaseContext) ?? true);
      const aroundExecute = h.aroundExecute;
      if (!ok || !aroundExecute || typeof aroundExecute !== 'function') continue;

      const prev = next;
      next = async () => {
        options.ctx.mark?.(String(aroundStage), phase);
        return this.withProvidersForHook(h, options.ctx as InvokeBaseContext, async () => {
          return aroundExecute(options.ctx as InvokeBaseContext, prev);
        });
      };
    }
    return (await next()) as T;
  }

  private async runOne<Ctx extends InvokeBaseContext>(
    base: BaseStage,
    options: RunStageOptions<Ctx, BaseStage>,
    phase: InvokePhase,
  ) {
    const will = this.pref('will', base);
    const around = this.pref('around', base);
    const did = this.pref('did', base);

    const inner = async () => {
      await this.runStage(will, options, phase);
      await this.runStage(base, options, phase);
      await this.runStage(did, options, phase);
    };

    await this.wrapWithAround(around, inner, options, phase);
  }

  private async runSection<Ctx extends InvokeBaseContext>(
    list: BaseStage[] | undefined,
    stageOpts: RunStageOptions<Ctx, BaseStage>,
    ctx: Ctx,
    isControlRespond: (e: unknown) => e is { value: unknown },
    phase: InvokePhase,
  ): Promise<'ok' | { control: true } | { error: unknown }> {
    ctx.mark?.('', phase);
    if ((list ?? []).length > 0) {
      console.log(`${barsPrefix()}[${phase}]`);
    }
    for (const s of list ?? []) {
      try {
        await this.runOne(s, stageOpts, phase);
      } catch (err) {
        if (isControlRespond(err)) {
          ctx.output = err.value;
          return { control: true };
        }
        ctx.error = err;
        ctx.output = undefined;

        return { error: err };
      }
    }
    return 'ok';
  }

  async runFlow<Ctx extends InvokeBaseContext, F extends FlowSpec<BaseStage, Ctx>, T = Ctx['output']>(
    flow: F,
    extrasArg: RunExtras<BaseStage>,
    ...initArgs: [...Parameters<F['initContext']>]
  ): Promise<T> {
    // 1) bootstrap via baseHandler (inferred types)
    const ctx = await flow.initContext(...initArgs);

    LOG_DEPTH++;
    console.log(`${barsPrefix(false)}>> ${flow.plan.name} (start)`);
    // 2) merge extras (constructor defaults < call-site)
    const extras = {
      ...(this.defaultExtras ?? {}),
      ...(extrasArg ?? {}),
      flow,
    } as RunExtras<BaseStage>;

    // 3) compute & bind providers BEFORE any stage
    await this.bootstrapProviders(flow, extras, ctx);

    // 4) build executable plan (drop initContext/bindProviders tokens)
    const plan = stripBootstrapStages(flow.plan);

    const {
      resolve,
      pluginHooksByStage = {},
      localHooksByStage = {},
      fnHooksProvider,
      isControlRespond = isControlResponse,
    } = extras;

    const stageOpts = {
      resolve,
      pluginHooksByStage,
      localHooksByStage,
      fnHooksProvider,
      ctx,
    } as RunStageOptions<Ctx, BaseStage>;

    const runError = async () => {
      for (const s of plan.error ?? []) {
        try {
          await this.runOne(s as BaseStage, stageOpts, 'error');
        } catch {
          /* empty */
        }
      }
    };

    const runFinalize = async () => {
      try {
        for (const s of plan.finalize ?? []) {
          await this.runOne(s as BaseStage, stageOpts, 'finalize');
        }
      } catch (finErr) {
        try {
          await runError();
        } finally {
          /* empty */
        }
        throw finErr;
      } finally {
        // Close current flow scope in ASCII timeline
        console.log(`${barsPrefix(false)}<< ${flow.plan.name} (end)`);
        if (LOG_DEPTH > 0) LOG_DEPTH--;
      }
    };

    // 5) pre
    const preRes = await this.runSection(plan.pre, stageOpts, ctx, isControlRespond, 'pre');
    if (preRes !== 'ok') {
      if ('control' in preRes) {
        const postRes = await this.runSection(plan.post, stageOpts, ctx, isControlRespond, 'post');
        if (postRes !== 'ok' && 'error' in postRes) {
          await runError();
          try {
            await runFinalize();
          } catch {
            /* empty */
          }
          throw (preRes as any).error;
        }
        await runFinalize();
        return ctx.output as T;
      }
      await runError();
      try {
        await runFinalize();
      } catch {
        /* empty */
      }
      throw preRes.error;
    }

    // 6) execute
    const execRes = await this.runSection(plan.execute, stageOpts, ctx, isControlRespond, 'execute');
    if (execRes !== 'ok') {
      if ('control' in execRes) {
        const postRes = await this.runSection(plan.post, stageOpts, ctx, isControlRespond, 'post');
        if (postRes !== 'ok' && 'error' in postRes) {
          await runError();
          try {
            await runFinalize();
          } catch {
            /* empty */
          }
          throw (execRes as any).error;
        }
        await runFinalize();
        return ctx.output as T;
      }
      await runError();
      try {
        await runFinalize();
      } catch {
        /* empty */
      }
      throw execRes.error;
    }

    // 7) post
    const postRes = await this.runSection(plan.post, stageOpts, ctx, isControlRespond, 'post');
    if (postRes !== 'ok' && 'error' in postRes) {
      await runError();
      try {
        await runFinalize();
      } catch {
        /* empty */
      }
      throw postRes.error;
    }

    // 8) finalize
    await runFinalize();

    return ctx.output as T;
  }

  // ===== provider bootstrap & per-hook overlay =====

  private deriveScopeKeys(ctx: InvokeBaseContext) {
    // Strict: trust ctx.* exactly; unauth flows will be undefined.
    const sessionId = (ctx as any).sessionId as string | undefined;
    const requestId = (ctx as any).requestId as string | number | undefined;
    return { sessionId, requestId };
  }

  private async bootstrapProviders<Ctx extends InvokeBaseContext, F extends FlowSpec<BaseStage, Ctx>>(
    flow: F,
    extras: RunExtras<BaseStage> & { apps?: AppLocalInstance[] },
    ctx: Ctx,
  ) {
    const keys = this.providersCfg?.scopeKeysFromCtx
      ? this.providersCfg.scopeKeysFromCtx(ctx)
      : this.deriveScopeKeys(ctx);

    (ctx as any).sessionId = keys.sessionId;
    (ctx as any).requestId = keys.requestId;

    // 1) gather bindProviders hooks (ordered), but collect-only
    const ordered = (await this.runStage(
      'bindProviders' as AllStages<BaseStage>,
      {
        resolve: extras.resolve,
        pluginHooksByStage: extras.pluginHooksByStage,
        localHooksByStage: extras.localHooksByStage,
        fnHooksProvider: extras.fnHooksProvider,
        ctx,
        collectOnly: true,
      } as RunStageOptions<Ctx, BaseStage>,
      'pre',
    )) as InvokerHook<InvokeBaseContext, AllStages<BaseStage>>[] | undefined;

    // 2) evaluate hook-provided getters first
    const hookGetters: BindingsGetter<Ctx>[] = [];
    if (ordered?.length) {
      for (const h of ordered) {
        const fn = h['bindProviders'];
        if (typeof fn !== 'function') continue;
        const returned = await fn(ctx as unknown as InvokeBaseContext);
        if (!returned) continue;
        if (typeof returned === 'function') hookGetters.push(returned as BindingsGetter<Ctx>);
        else if (Array.isArray(returned) && typeof returned[0] === 'function') hookGetters.push(...returned);
        else if (Array.isArray(returned)) {
          const list = returned as ProviderBinding[];
          hookGetters.push(() => list);
        }
      }
    }

    // 3) then invoker/base getters (including fromApps)
    const cfg = this.providersCfg;
    const base: BindingsGetter<Ctx>[] = [];
    if (cfg?.baseGetters?.length) base.push(...cfg.baseGetters);
    if (cfg?.fromApps) base.push(...(cfg.fromApps((extras as any).apps ?? []) ?? []));

    const allGetters = [...hookGetters, ...base];

    // 4) materialize and bind (first-wins, hooks take precedence)
    const lists: ProviderBinding[][] = [];
    for (const g of allGetters) {
      const res = await g({ ctx, apps: extras.apps });
      if (res?.length) lists.push(res);
    }

    // Optionally inject the active invoker brand as a request-scoped provider
    if (this.opts?.invokerProvider) {
      lists.push([[INVOKER_BRAND_SYMBOL, { invoker: this, extras }, ProviderScope.REQUEST]]);
    }

    const merged = mergeBindingsFirstWins(...lists);
    if (merged.length) {
      // use flow adapter if present, else context
      await (flow.bindProviders?.(merged, ctx) ?? ctx['bindProviders']?.(merged));
    }
  }

  private async withProvidersForHook<Ctx extends InvokeBaseContext>(
    hook: any,
    ctx: Ctx,
    run: () => Promise<unknown>,
  ): Promise<unknown> {
    const originApp: AppLocalInstance | undefined = hook?.__originApp || hook?.originApp || hook?.['MCP_HOOK_ORIGIN_APP'];
    if (!originApp) return run();

    // Per-run cache
    const data = ctx.data as Map<any, any>;
    const cache: Map<any, any> =
      data?.get?.(RUN_VIEWS_CACHE) ??
      (() => {
        const m = new Map();
        data?.set?.(RUN_VIEWS_CACHE, m);
        return m;
      })();

    const { sessionId, requestId } = this.deriveScopeKeys(ctx);
    const key = `${originApp.id ?? originApp}-${sessionId ?? 'unauth'}`;

    let views = cache.get(key);
    if (!views) {
      // defer import to avoid cycle; consumers can also inline app.providers.buildViews
      views = await appViewsFor(originApp, sessionId, requestId);
      cache.set(key, views);
    }

    const top = new Map<ProviderScope, Map<Token, unknown>>([
      [ProviderScope.GLOBAL, new Map<Token, unknown>(views.global)],
      [ProviderScope.SESSION, new Map<Token, unknown>(views.session)],
      [ProviderScope.REQUEST, new Map<Token, unknown>(views.request)],
    ]);

    const original = (ctx as any).providers as Map<ProviderScope, Map<Token, unknown>>;
    try {
      (ctx as any).providers = overlayProviderMaps(top, original);
      return await run();
    } finally {
      (ctx as any).providers = original;
    }
  }
}
