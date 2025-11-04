// invoker/invoker.flow.ts
import 'reflect-metadata';
import type { Invoker } from './invoker';
import type {
  CreateOptions,
  FlowSpec,
  HttpFlowRunOptions,
  InvokeBaseContext,
  RunExtras,
  RunOptions,
  RunPlan,
  StageFn,
} from './invoker.types';
import { DecoratorMD } from './invoker.decorators';
import { InvokerContext } from './invoker.context';

import type { FlowName } from '../plugin/plugin.types';
import { makeRouteInvoker } from './invoker.factory';
import { commonFailResponseHandler, commonSuccessResponseHandler } from '../common/common.schema';
import { INVOKER_BRAND_SYMBOL } from './invoker.types';
import { writeHttpResponse } from '../server/server.validation';
import { Scope } from '../scope';
import { AppLocalInstance } from '../app/instances';
import { HttpOutput, httpOutputSchema, NextFn, ServerRequest, ServerResponse } from '@frontmcp/sdk';

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

type AnyHookObj = {
  priority?: number;
  order?: number;
  filter?: (ctx: InvokeBaseContext) => boolean | Promise<boolean>;
  aroundExecute?: (ctx: InvokeBaseContext, next: () => Promise<unknown>) => Promise<unknown>;
  [stageKey: string]: unknown; // dynamic stage keys
};

export type Newable<Args extends any[], T> = new (...args: Args) => T;

export type FlowAsCtxStatics = Pick<typeof FlowAsCtx, 'asFlowSpec' | 'createInvoker'>;

export abstract class FlowAsCtx<
  TRawIn,
  TIn,
  TOut,
  TErr = unknown,
  TInDraft = Partial<TIn>,
  TOutDraft = Partial<TOut>,
> extends InvokerContext<TRawIn, TIn, TOut, TErr, TInDraft, TOutDraft> {
  /** Run another Flow class using the same Invoker instance and provider context. */
  async runNestedFlow<ChildOut, A>(
    Child: typeof FlowAsCtx<A, any, ChildOut> & FlowAsCtxStatics,
    ctorArg: A,
  ): Promise<ChildOut> {
    const store = (() => {
      try {
        return this.get(INVOKER_BRAND_SYMBOL) as { invoker: Invoker; extras: RunExtras<any> } | undefined;
      } catch {
        return undefined;
      }
    })();
    if (!store?.invoker) throw new Error('Nested flow reuse is unavailable: missing parent invoker context');

    const parentExtras = store.extras;
    const plan = (Reflect.getMetadata(DecoratorMD.PLAN, Child) ?? {}) as RunPlan<string>;

    const scope = (parentExtras as any).scope;
    const app = (parentExtras as any).app;

    // refresh hooks for the child namespace while keeping the same scope/app
    const route = makeRouteInvoker(scope!, plan.name as any, {
      app,
      providerGetters: store.invoker.opts.providers?.baseGetters,
    });

    const { fnHooksProvider: _dropFn, ...restParent } = parentExtras;
    const mergedExtras = {
      ...restParent,
      scope: route.baseExtras.scope ?? scope,
      app: route.baseExtras.app ?? app,
      pluginHooksByStage: route.baseExtras.pluginHooksByStage,
      apps: route.baseExtras.apps, // backward-compat
    };

    // ✅ Prefer the fast path if Child has static invoke()
    const maybeInvoke = (Child as any).invoke;
    if (typeof maybeInvoke === 'function') {
      return maybeInvoke.call(Child, store.invoker, mergedExtras, ctorArg);
    }

    // ♻️ Fallback: reuse the parent invoker via asFlowSpec()
    const maybeAsFlowSpec = (Child as any).asFlowSpec;
    if (typeof maybeAsFlowSpec === 'function') {
      const { flow, extrasFactory } = maybeAsFlowSpec(Child);
      return store.invoker.runFlow(flow as any, { ...extrasFactory(), ...mergedExtras }, ctorArg) as Promise<ChildOut>;
    }

    // 🛑 Last resort: clear, actionable error
    throw new Error(
      `runNestedFlow: "${(Child as any)?.name ?? 'Unknown'}" is not a FlowAsCtx class (missing static invoke/asFlowSpec). ` +
      `Either extend FlowAsCtx or pass a proper Flow class.`,
    );
  }

  async runNestedHttpFlow(
    runOptions: HttpFlowRunOptions,
    ctorArg: { request: ServerRequest; response: ServerResponse },
  ): Promise<HttpOutput> {
    return runOptions.run(ctorArg);
  }

  /** Adapter: turn a decorated Flow class into FlowSpec + extras */
  static asFlowSpec<
    S extends string,
    C extends InvokeBaseContext<C['rawInput'], C['input'], C['output']>,
    F extends C,
    A extends any[],
  >(FlowCtor: Newable<A, F>): { flow: FlowSpec<S, C, A>; extrasFactory: () => RunExtras<S> } {
    let instance: F | undefined;
    const plan = (Reflect.getMetadata(DecoratorMD.PLAN, FlowCtor) ?? {}) as RunPlan<S>;

    const boundStageFns: Record<string, StageFn<C>> = {};

    const flow: FlowSpec<S, C, A> = {
      plan,
      baseHandler: new Proxy(
        {},
        {
          get(_t, prop: string) {
            return boundStageFns[prop];
          },
        },
      ) as any,
      initContext: async (...args: A) => {
        const instanceLocal = new FlowCtor(...args);
        instance = instanceLocal;

        const metas = (Reflect.getMetadata(DecoratorMD.HOOKS, FlowCtor) ?? []) as Array<{
          kind: 'stage' | 'will' | 'did' | 'around';
          stage: string;
          method: string;
        }>;

        for (const m of metas) {
          if (m.kind !== 'stage') continue;
          const impl = (instanceLocal as any)[m.method];
          if (typeof impl !== 'function') continue;
          boundStageFns[m.stage] = async () => impl.call(instanceLocal);
        }
        return instanceLocal as unknown as C;
      },
      bindProviders: async (bindings: [unknown, unknown, unknown][], ctx: C) => {
        await (ctx as any)?.bindProviders?.(bindings, ctx);
      },
    };

    const extrasFactory = (): RunExtras<S> => ({
      fnHooksProvider: (stageName: string) => {
        if (!instance) return [];
        const ctor = (instance as any).constructor as Newable<A, F>;
        const metas = (Reflect.getMetadata(DecoratorMD.HOOKS, ctor) ?? []) as Array<{
          kind: 'stage' | 'will' | 'did' | 'around';
          stage: string;
          method: string;
          priority?: number;
          filter?: (ctx: InvokeBaseContext) => boolean | Promise<boolean>;
          name?: string;
        }>;

        const hooks: AnyHookObj[] = [];

        for (const m of metas) {
          const expected =
            m.kind === 'will'
              ? `will${cap(m.stage)}`
              : m.kind === 'did'
                ? `did${cap(m.stage)}`
                : m.kind === 'around'
                  ? `around${cap(m.stage)}`
                  : m.stage;
          if (expected !== stageName) continue;

          const impl = (instance as any)[m.method];
          if (typeof impl !== 'function') continue;

          const obj: AnyHookObj = {
            priority: m.priority ?? 0,
            order: m.priority ?? 0,
            filter: m.filter as any,
          };

          if (m.kind === 'around') {
            (obj as any).aroundExecute = async (_ctx: C, next: () => Promise<unknown>) => {
              return impl.call(instance, next);
            };
          } else {
            (obj as any)[stageName] = async () => impl.call(instance);
          }

          hooks.push(obj);
        }
        return hooks;
      },
    });

    return { flow, extrasFactory };
  }

  static createInvoker<S extends string, C extends InvokerContext, F extends C, A extends any[]>(
    this: Newable<A, F> & FlowAsCtxStatics,
    opName: FlowName,
    options: CreateOptions & { scope: Scope; app?: AppLocalInstance },
  ) {
    const { flow, extrasFactory } = this.asFlowSpec<S, C, F, A>(this);
    const { invoker, baseExtras } = makeRouteInvoker(options.scope, opName, {
      app: options.app,
      providerGetters: options.providerGettersOptions,
    });
    const extras: any = { ...extrasFactory(), ...baseExtras };

    const handler = (fn: (req: ServerRequest, res: ServerResponse, next: NextFn) => A[0]) => {
      const baseHandler = async (req: ServerRequest, res: ServerResponse, next: NextFn) => {
        try {
          const result = (await invoker.runFlow(flow as any, extras, fn(req, res, next))) as Promise<C['output']>;
          return commonSuccessResponseHandler(res, result);
        } catch (e) {
          return commonFailResponseHandler(res, e);
        }
      };
      baseHandler.success = (
        onSuccess: (res: ServerResponse, result: C['output'], req: ServerRequest, next: NextFn) => void | Promise<void>,
      ) => {
        const successHandler = async (req: ServerRequest, res: ServerResponse, next: NextFn) => {
          try {
            const result = (await invoker.runFlow(flow as any, extras, fn(req, res, next))) as Promise<C['output']>;
            return onSuccess(res, result, req, next);
          } catch (e) {
            return commonFailResponseHandler(res, e);
          }
        };
        successHandler.fail = (
          onFail: (res: ServerResponse, err: any, req: ServerRequest, next: NextFn) => void | Promise<void>,
        ) => {
          return async (req: ServerRequest, res: ServerResponse, next: NextFn) => {
            try {
              const result = (await invoker.runFlow(flow as any, extras, fn(req, res, next))) as Promise<C['output']>;
              return onSuccess(res, result, req, next);
            } catch (e) {
              return onFail(res, e, req, next);
            }
          };
        };
        return successHandler;
      };
      return baseHandler;
    };

    const httpMiddleware = async (request: ServerRequest, response: ServerResponse, next: NextFn) => {
      const result: any = await invoker.runFlow(flow as any, extras, { request, response, next });
      const parsed = httpOutputSchema.safeParse(result);
      if (!parsed.success) {
        console.error('Invalid HTTP response:', parsed.error.format());
        next();
      } else {
        switch (parsed.data.kind) {
          case 'next':
            return next();
          case 'consumed':
            return;
          default:
            return writeHttpResponse(response, parsed.data);
        }
      }
    };
    return {
      run: (args: A) => invoker.runFlow(flow as any, extras, args) as Promise<C['output']>,
      handler,
      httpMiddleware,
    } as RunOptions<any, any>;
  }
}
