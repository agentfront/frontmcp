import { Type } from '@frontmcp/sdk';
import { ControlRespond } from '../types/invoke.type';
import {
  AllStages,
  CollectorOptions,
  GenerateFromArray,
  HookCollector,
  InvokeBaseContext,
  InvokerHook,
  RunPlan,
} from './invoker.types';

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const defaultSortForStage = <Ctx extends InvokeBaseContext = InvokeBaseContext, Stage extends string = string>(
  stage: AllStages<Stage>,
  hooks: InvokerHook<Ctx, AllStages<Stage>>[],
) => {
  const getPrio = (h: InvokerHook<Ctx, AllStages<Stage>>) =>
    typeof h.priority === 'function'
      ? Number(h.priority())
      : typeof h.priority === 'number'
      ? Number(h.priority)
      : 0;
  return String(stage).startsWith('did')
    ? hooks.sort((a, b) => getPrio(a) - getPrio(b)) // did* ascending
    : hooks.sort((a, b) => getPrio(b) - getPrio(a)); // will*/around*/on* desc
};

/**
 * Merge multiple { stage -> Type[] } maps.
 * Keeps order (left to right). No duplicates.
 */
export function mergeHooksByStage<Stage extends string, T = unknown>(
  ...maps: Array<Partial<Record<Stage, T[]>> | undefined>
): Partial<Record<Stage, T[]>> {
  const out: Partial<Record<Stage, T[]>> = {};

  for (const m of maps) {
    if (!m) continue;
    for (const k of Object.keys(m) as Stage[]) {
      const src = m[k];
      if (!src?.length) continue;

      const dst = (out[k] ??= []);
      // de-dupe while preserving order
      for (const t of src) {
        if (!dst.includes(t)) dst.push(t);
      }
    }
  }
  return out;
}

export const isControlResponse = (e: any): e is { value: unknown } =>
  !!e && (e instanceof ControlRespond || e.name === 'ControlRespond');

export function makeDefaultCollector<Stage extends string>(): HookCollector<Stage> {
  return async (
    stage: AllStages<Stage>,
    args: CollectorOptions<InvokeBaseContext, Stage>,
  ) => {
    const { pluginHooksByStage, localHooksByStage, resolve, fnHooksProvider } = args;

    const isAround = (s: string) => s.startsWith('around');

    const accepts = (h: unknown): h is InvokerHook<InvokeBaseContext, AllStages<Stage>> => {
      const obj = h as any;
      if (typeof obj?.[stage as any] === 'function') return true;
      if (isAround(stage as string) && typeof obj?.aroundExecute === 'function') return true;
      return false;
    };

    const merged = mergeHooksByStage<AllStages<Stage>, Type>(
      pluginHooksByStage as any, localHooksByStage as any,
    );
    const entries = (merged[stage] ?? []) as Type<any>[];

    const fromClasses = entries
      .map((t) => resolve?.(t as Type<any>))
      .filter(Boolean)
      .filter(accepts);

    const fnHooksAll = (await (fnHooksProvider?.(stage) ?? [])) as unknown[];
    const fnHooks = fnHooksAll.filter(accepts) as InvokerHook<InvokeBaseContext, AllStages<Stage>>[];

    return [...fromClasses, ...fnHooks];
  };
}

export const stripBootstrapStages = <S extends string>(plan: RunPlan<S>) => {
  const drop = new Set<S>(['initContext', 'bindProviders'] as unknown as S[]);
  const keep = (arr?: S[]) => (arr ?? []).filter((s) => !drop.has(s));
  return {
    ...plan,
    pre: keep(plan.pre),
    execute: keep(plan.execute),
    post: keep(plan.post),
    finalize: keep(plan.finalize),
    error: keep(plan.error),
  };
};

export function generateStages<A extends readonly string[]>(stages: A): GenerateFromArray<A> {
  const out: Record<string, string> = {};
  const prefixes = ['will', 'around', 'did'];

  for (const stage of stages) {
    if (stage === 'initContext') continue;

    if (stage === 'bindProviders') {
      const k = `did${capitalize(stage)}` as const;
      out[k] = k as string;
      continue;
    }

    for (const p of prefixes) {
      const k = `${p}${capitalize(stage)}` as const;
      out[k] = k as string;
    }
  }
  return out as GenerateFromArray<A>;
}
