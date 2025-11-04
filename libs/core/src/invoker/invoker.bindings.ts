import { ProviderScope, Token } from '@frontmcp/sdk';
import { BindingsGetter, InvokeBaseContext, ProviderBinding } from './invoker.types';
import { AppLocalInstance } from '../app/instances';

/* -------------------- Core helpers -------------------- */

function mapToBindings(m: ReadonlyMap<Token, unknown> | undefined, scope: ProviderScope): ProviderBinding[] {
  if (!m) return [];
  const out: ProviderBinding[] = [];
  for (const [t, v] of m.entries()) out.push([t, v, scope]);
  return out;
}

export async function appViewsFor(
  app: AppLocalInstance,
  sessionId?: string,
  requestId?: string | number,
): Promise<{
  global: ReadonlyMap<Token, unknown>;
  session: ReadonlyMap<Token, unknown>;
  request: ReadonlyMap<Token, unknown>
}> {
  if (sessionId == null) {
    // unauth path: global only
    return {
      global: app.providers.getAllSingletons(),
      session: new Map<Token, unknown>(),
      request: new Map<Token, unknown>(),
    };
  }
  return app.providers.buildViews(sessionId);
}

function viewsToBindings(views: {
  global: ReadonlyMap<Token, unknown>;
  session: ReadonlyMap<Token, unknown>;
  request: ReadonlyMap<Token, unknown>
}): ProviderBinding[] {
  return [
    ...mapToBindings(views.global, ProviderScope.GLOBAL),
    ...mapToBindings(views.session, ProviderScope.SESSION),
    ...mapToBindings(views.request, ProviderScope.REQUEST),
  ];
}

/** Single-app getter that uses ctx.sessionId/requestId exactly. */
export function makeAppGetters(app: AppLocalInstance): BindingsGetter[] {
  return [async ({ ctx }) => {
    const { sessionId, requestId } = (ctx as any);
    const views = await appViewsFor(app, sessionId, requestId);
    return viewsToBindings(views);
  }];
}

/** Multi-app getter; folds apps with first-wins; skips session/request when undefined. */
export function makeAppsGetters(apps: AppLocalInstance[]): BindingsGetter[] {
  return [async ({ ctx }) => {
    const { sessionId, requestId } = (ctx as any);

    const merged = {
      global: new Map<Token, unknown>(),
      session: new Map<Token, unknown>(),
      request: new Map<Token, unknown>(),
    };

    for (const app of apps) {
      const v = await appViewsFor(app, sessionId, requestId);
      for (const [t, val] of v.global) if (!merged.global.has(t)) merged.global.set(t, val);
      if (sessionId != null) {
        // only fold these when authenticated
        for (const [t, val] of v.session) if (!merged.session.has(t)) merged.session.set(t, val);
        for (const [t, val] of v.request) if (!merged.request.has(t)) merged.request.set(t, val);
      }
    }
    return viewsToBindings(merged);
  }];
}

/* -------------------- Quality-of-life: scoped getters -------------------- */
/**
 * Build a scoped getter quickly.
 * Source can be:
 *  - a Map<Token, unknown>
 *  - an array of [Token, value]
 *  - a function returning either of the above OR a ProviderBinding[]
 */
export type MapOrPairsOrBindings<Ctx = any> =
  | ReadonlyMap<Token, unknown>
  | Array<[Token, unknown]>
  | ProviderBinding[]
  | ((args: {
  ctx: Ctx
}) => ReadonlyMap<Token, unknown> | Array<[Token, unknown]> | ProviderBinding[] | undefined | Promise<ReadonlyMap<Token, unknown> | Array<[Token, unknown]> | ProviderBinding[] | undefined>);

function toBindings<Ctx>(scope: ProviderScope, src: MapOrPairsOrBindings<Ctx>, ctx: Ctx): Promise<ProviderBinding[] | undefined> | ProviderBinding[] | undefined {
  const materialize = (val: any): ProviderBinding[] | undefined => {
    if (!val) return undefined;
    if (Array.isArray(val) && val.length && Array.isArray(val[0])) {
      // [[token, value], ...]
      return (val as Array<[Token, unknown]>).map(([t, v]) => [t, v, scope]);
    }
    if (val instanceof Map) {
      return Array.from((val as ReadonlyMap<Token, unknown>).entries()).map(([t, v]) => [t, v, scope] as ProviderBinding);
    }
    if (Array.isArray(val) && val.length && Array.isArray(val[0]) === false) {
      // might already be ProviderBinding[]
      const as = val as ProviderBinding[];
      return as.every(x => Array.isArray(x) && x.length === 3) ? as : undefined;
    }
    if (Array.isArray(val) && val.length === 0) return [];
    return undefined;
  };

  if (typeof src === 'function') {
    const out = (src as any)({ ctx });
    if (out && typeof (out as any).then === 'function') {
      return (out as Promise<any>).then(materialize);
    }
    return materialize(out);
  }
  return materialize(src);
}

export const scoped = {
  global<Ctx extends InvokeBaseContext>(src: MapOrPairsOrBindings<Ctx>): BindingsGetter<Ctx> {
    return ({ ctx }) => toBindings(ProviderScope.GLOBAL, src, ctx);
  },
  session<Ctx extends InvokeBaseContext>(src: MapOrPairsOrBindings<Ctx>): BindingsGetter<Ctx> {
    return ({ ctx }) => toBindings(ProviderScope.SESSION, src, ctx);
  },
  request<Ctx extends InvokeBaseContext>(src: MapOrPairsOrBindings<Ctx>): BindingsGetter<Ctx> {
    return ({ ctx }) => toBindings(ProviderScope.REQUEST, src, ctx);
  },
};
