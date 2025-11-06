import { HookMetadata, FlowType, FrontMcpFlowHookTokens } from '@frontmcp/sdk';

export type StageEntry<C> = {
  /** Call as: await entry.method(context) */
  method: (ctx: C) => Promise<void>;
};

export type StageMap<C> = Record<string, StageEntry<C>[]>;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Cache per class to avoid repeated reflection
const CACHE: WeakMap<Function, StageMap<any>> = new WeakMap();

/**
 * Build a stage->hooks map ready for:
 *   for (const s of plan.pre) for (const h of hooks[s] ?? []) await h.method(context)
 *
 * Keys include resolved names:
 *   - 'stageName' for kind==='stage'
 *   - 'willStageName' for kind==='will'
 *   - 'didStageName'  for kind==='did'
 *   - 'aroundStageName' for kind==='around'
 */
export function collectFLowHookMap<C>(FlowClass: FlowType): StageMap<C> {
  const cached = CACHE.get(FlowClass as any);
  if (cached) return cached;

  const metas = (Reflect.getMetadata(FrontMcpFlowHookTokens.hooks, FlowClass) ?? []) as HookMetadata[];

  // stable sort: priority asc, then definition order
  const sorted = metas
    .map((m, i) => ({ m, i }))
    .sort((a, b) => ((a.m.priority ?? 0) - (b.m.priority ?? 0)) || (a.i - b.i))
    .map(x => x.m);

  const table: StageMap<C> = {};

  for (const m of sorted) {
    const resolved =
      m.type === 'will'
        ? `will${cap(m.stage)}`
        : m.type === 'did'
          ? `did${cap(m.stage)}`
          : m.type === 'around'
            ? `around${cap(m.stage)}`
            : m.stage;

    // Prepare a wrapper that will be called later with the *request instance as context*.
    // We don’t bind to an instance here (prepare-time), we resolve the impl at call-time from ctx.
    const entry: StageEntry<C> = {
      method: async (ctx: any) => {
        // Resolve impl: static on class, otherwise on the instance (ctx)
        const target = m.static ? (FlowClass as any) : ctx;
        const impl = target?.[m.method];

        if (typeof impl !== 'function') return;

        // Filter (supports async)
        if (m.filter && !(await m.filter(ctx))) return;

        if (m.type === 'around') {
          // Provide a no-op next so your current loop signature stays stage.method(context)
          const next = async () => {
          };
          // Call as impl(ctx, next), with proper `this`
          return m.static ? impl.call(FlowClass, ctx, next) : impl.call(ctx, ctx, next);
        } else {
          // Call as impl(ctx), with proper `this`
          return m.static ? impl.call(FlowClass, ctx) : impl.call(ctx, ctx);
        }
      },
    };

    (table[resolved] ??= []).push(entry);
  }

  CACHE.set(FlowClass as any, table);
  return table;
}

