import { FrontMcpFlowHookTokens, type HookMetadata } from '../common';
import { resolvePendingTC39HooksForClass } from '../common/decorators/hook.decorator';
import { orderByConstraints } from '../hooks/hook-order';

export type StageEntry<C> = {
  /** `next` is passed only to an Around hook: it runs the rest of the stage. */
  method: (ctx: C, next?: () => Promise<void>) => Promise<void>;
  /** The flow step or hook this entry runs. */
  hook: HookMetadata;
  _priority: number;
  _order: number;
};

export type StageMap<C> = Record<string, StageEntry<C>[]>;

/** Runs one hook a plugin, app or entry injected into a flow (`run`), so the run's observers can wrap it. */
export type HookRunner = (
  hook: { stage: string; target: unknown; metadata: HookMetadata },
  run: () => Promise<void>,
) => Promise<void>;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const CACHE: WeakMap<Function, StageMap<any>> = new WeakMap();

/** The `next` a stage body or a will/did hook gets: nothing wraps it. */
const NO_NEXT = async () => undefined;

/** Each list in priority order, then registration order, with the hooks its `before` / `after` options move. */
export function sortStageMap<C>(table: StageMap<C>) {
  for (const key of Object.keys(table)) {
    const list = table[key];
    list.sort((a, b) => a._priority - b._priority || a._order - b._order);
    const ordered = orderByConstraints(list, (entry) => entry.hook);
    if (ordered !== list) list.splice(0, list.length, ...ordered);
  }
}

export function cloneStageMap<C>(table: StageMap<C>): StageMap<C> {
  const out: StageMap<C> = {};
  for (const [k, v] of Object.entries(table)) out[k] = v.slice();
  return out;
}

export function resolveStageKey(type: HookMetadata['type'], stage: string) {
  return type === 'stage' ? stage : `${type}${cap(stage)}`;
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
      hook: m,
      _priority: m.priority ?? 0,
      _order: order++,
      method: async (ctx: any, next = NO_NEXT) => {
        const skipHook = () => (m.type === 'around' ? next() : undefined);
        const target = m.static ? (FlowClass as any) : ctx;
        const impl =
          typeof (m as any).method === 'function' ? (m as any).method : target?.[m.method as keyof typeof target];

        if (typeof impl !== 'function') return skipHook();
        if (m.filter && !(await m.filter(ctx))) return skipHook();

        if (m.type === 'around') {
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
  runHook: HookRunner = (_hook, run) => run(),
) {
  let order = orderStart;

  const sorted = metas
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.priority ?? 0) - (b.m.priority ?? 0) || a.i - b.i)
    .map((x) => x.m);

  for (const m of sorted) {
    const resolved = resolveStageKey(m.type, m.stage);

    const entry: StageEntry<C> = {
      hook: m,
      _priority: m.priority ?? 0,
      _order: order++,
      method: async (ctx: any, next = NO_NEXT) => {
        const skipHook = () => (m.type === 'around' ? next() : undefined);
        const target = m.target;
        if (!target) {
          console.warn(`[flow] Hook target is missing for method ${m.method}`);
          return skipHook();
        }
        const impl =
          typeof (m as any).method === 'function'
            ? (m as any).method
            : target?.[m.method as keyof typeof target].bind(target);

        if (typeof impl !== 'function') return skipHook();
        if (m.filter && !(await m.filter(ctx))) return skipHook();

        return runHook({ stage: resolved, target, metadata: m }, async () =>
          m.type === 'around' ? impl.call(target, ctx, next) : impl.call(target, ctx),
        );
      },
    };

    (table[resolved] ??= []).push(entry);
  }

  sortStageMap(table);
}

const HOOK_TYPES_IN_RUN_ORDER = ['will', 'around', 'stage', 'did', 'finally'] as const;

/** `will SomePlugin.method (0, before cache)`: a step's type, the class that declares it, its method, its priority and constraints. */
function describeStep(hook: HookMetadata, flowClassName: string): string {
  // A plugin or provider hook's `target` is the instance its method runs on.
  const target: unknown = hook.target;
  const owner =
    typeof target === 'function' ? target.name : target && typeof target === 'object' ? target.constructor.name : '';
  const placement = [
    hook.priority ?? 0,
    ...(hook.before ?? []).map((name) => `before ${name}`),
    ...(hook.after ?? []).map((name) => `after ${name}`),
  ];
  return `${hook.type} ${owner || flowClassName}.${hook.method} (${placement.join(', ')})`;
}

/** One line per stage of `stages` that `resolved` adds a hook to over `base`, listing its steps in the order they run. */
export function describeHookOrder<C>(
  stages: readonly string[],
  base: StageMap<C>,
  resolved: StageMap<C>,
  flowClassName: string,
): string[] {
  const lines: string[] = [];
  for (const stage of stages) {
    const keys = HOOK_TYPES_IN_RUN_ORDER.map((type) => resolveStageKey(type, stage));
    if (!keys.some((key) => (resolved[key]?.length ?? 0) > (base[key]?.length ?? 0))) continue;

    const [will, around, body, did, after] = keys.map((key) =>
      (resolved[key] ?? []).map((entry) => describeStep(entry.hook, flowClassName)),
    );
    const wrapped = around.reduceRight((inner, outer) => `${outer} [ ${inner} ]`, body.join(' → '));
    lines.push(`  ${stage}: ${[...will, wrapped, ...did, ...after].filter(Boolean).join(' → ')}`);
  }
  return lines;
}
