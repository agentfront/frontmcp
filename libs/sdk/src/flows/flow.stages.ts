import { HookMetadata, FrontMcpFlowHookTokens } from '../common';
import { resolvePendingTC39HooksForClass } from '../common/decorators/hook.decorator';

export type StageEntry<C> = {
  method: (ctx: C) => Promise<void>;
  _priority: number;
  _order: number;
};

export type StageMap<C> = Record<string, StageEntry<C>[]>;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const CACHE: WeakMap<Function, StageMap<any>> = new WeakMap();

export function sortStageMap<C>(table: StageMap<C>) {
  for (const key of Object.keys(table)) {
    table[key].sort((a, b) => a._priority - b._priority || a._order - b._order);
  }
}

export function cloneStageMap<C>(table: StageMap<C>): StageMap<C> {
  const out: StageMap<C> = {};
  for (const [k, v] of Object.entries(table)) out[k] = v.slice();
  return out;
}

export function resolveStageKey(type: HookMetadata['type'], stage: string) {
  return type === 'will'
    ? `will${cap(stage)}`
    : type === 'did'
      ? `did${cap(stage)}`
      : type === 'around'
        ? `around${cap(stage)}`
        : stage;
}

export function collectFlowHookMap<C>(FlowClass: any): StageMap<C> {
  const cached = CACHE.get(FlowClass as any);
  if (cached) {
    return cached;
  }

  // Get existing metadata (from legacy decorators)
  const existingMetas = (Reflect.getMetadata(FrontMcpFlowHookTokens.hooks, FlowClass) ?? []) as HookMetadata[];

  // Resolve any pending TC39 decorator hooks
  const tc39Metas = resolvePendingTC39HooksForClass(FlowClass);

  // Combine both sources
  const metas = [...existingMetas, ...tc39Metas];

  const sorted = metas
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.priority ?? 0) - (b.m.priority ?? 0) || a.i - b.i)
    .map((x) => x.m);

  const table: StageMap<C> = {};
  let order = 0;

  for (const m of sorted) {
    const resolved = resolveStageKey(m.type, m.stage);

    const entry: StageEntry<C> = {
      _priority: m.priority ?? 0,
      _order: order++,
      method: async (ctx: any) => {
        const target = m.static ? (FlowClass as any) : ctx;
        const impl =
          typeof (m as any).method === 'function' ? (m as any).method : target?.[m.method as keyof typeof target];

        if (typeof impl !== 'function') return;
        if (m.filter && !(await m.filter(ctx))) return;

        if (m.type === 'around') {
          const next = async () => {};
          return m.static ? impl.call(FlowClass, ctx, next) : impl.call(ctx, ctx, next);
        } else {
          return m.static ? impl.call(FlowClass, ctx) : impl.call(ctx, ctx);
        }
      },
    };

    (table[resolved] ??= []).push(entry);
  }

  sortStageMap(table);
  CACHE.set(FlowClass as any, table);
  return table;
}

export function mergeHookMetasIntoStageMap<C>(
  FlowClass: any,
  table: StageMap<C>,
  metas: HookMetadata[],
  orderStart = 100_000,
) {
  let order = orderStart;

  const sorted = metas
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.priority ?? 0) - (b.m.priority ?? 0) || a.i - b.i)
    .map((x) => x.m);

  for (const m of sorted) {
    const resolved = resolveStageKey(m.type, m.stage);

    const entry: StageEntry<C> = {
      _priority: m.priority ?? 0,
      _order: order++,
      method: async (ctx: any) => {
        const target = m.target;
        if (!target) {
          console.warn(`[flow] Hook target is missing for method ${m.method}`);
          return;
        }
        const impl =
          typeof (m as any).method === 'function'
            ? (m as any).method
            : target?.[m.method as keyof typeof target].bind(target);

        if (typeof impl !== 'function') return;
        if (m.filter && !(await m.filter(ctx))) return;

        if (m.type === 'around') {
          const next = async () => {};
          return m.static ? impl.call(target, ctx, next) : impl.call(target, ctx, next);
        } else {
          return m.static ? impl.call(target, ctx) : impl.call(target, ctx);
        }
      },
    };

    (table[resolved] ??= []).push(entry);
  }

  sortStageMap(table);
}
