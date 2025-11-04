// invoker/invoker.decorators.ts
import 'reflect-metadata';
import { RunPlan } from './invoker.types';
import { FlowName } from '../plugin/plugin.types';
import { Token } from '@frontmcp/sdk';

export type HookKind = 'stage' | 'will' | 'did' | 'around';
export type Priority = number;

export interface HookOptions<Ctx> {
  priority?: Priority;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
  name?: string;
}

export const DecoratorMD = {
  HOOKS: Symbol.for('invoker:hooks'),
  PLAN: Symbol.for('invoker:plan'),
  PLAN_NAME: Symbol.for('invoker:plan:name'),
  PLAN_DEPENDS_ON: Symbol.for('invoker:plan:dependsOn'),
} as const;

export type HookMeta = {
  kind: HookKind;
  stage: string;
  method: string;
  priority: Priority;
  filter?: Function;
  name?: string;
};

function addHook(target: any, meta: HookMeta) {
  const ctor = target.constructor;
  const arr: HookMeta[] = Reflect.getMetadata(DecoratorMD.HOOKS, ctor) ?? [];
  arr.push(meta);
  Reflect.defineMetadata(DecoratorMD.HOOKS, arr, ctor);
}

/** Plan type + decorator */
export type Plan<T extends string> = {
  name: T;
  pre?: readonly T[];
  execute?: readonly T[];
  post?: readonly T[];
  finalize?: readonly T[];
  error?: readonly T[];
};

type PlanOptions ={
  dependsOn: Token[]
}
export function InvokePlan<T extends string>(plan: Plan<T>, options?: PlanOptions) {
  return function (ctor: Function) {
    Reflect.defineMetadata(DecoratorMD.PLAN, plan, ctor);
    Reflect.defineMetadata(DecoratorMD.PLAN_NAME, plan.name, ctor);
    Reflect.defineMetadata(DecoratorMD.PLAN_DEPENDS_ON, options?.dependsOn ?? [], ctor);
  };
}

/** Base factory (kept internal) */
function make(kind: HookKind) {
  return function <Ctx = unknown, T extends string = string>(stage: T, opts: HookOptions<Ctx> = {}): MethodDecorator {
    return (target: any, key, _desc) => {
      addHook(target, {
        kind,
        stage: String(stage),
        method: String(key),
        priority: opts.priority ?? 0,
        filter: opts.filter as any,
        name: opts.name ?? String(key),
      });
    };
  };
}

/** Backwards-compatible untyped exports (still available) */
export const Stage = make('stage');
export const Will = make('will');
export const Did = make('did');
export const Around = make('around');

/** NEW: typed variants */
export function StageOf<T extends string, Ctx>() {
  const base = make('stage');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}
export function WillOf<T extends string, Ctx>() {
  const base = make('will');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}
export function DidOf<T extends string, Ctx>() {
  const base = make('did');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}
export function AroundOf<T extends string, Ctx>() {
  const base = make('around');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}

/** Convenience bundle */
export function HooksOf<T extends string, Ctx = any>() {
  return {
    Stage: StageOf<T, Ctx>(),
    Will: WillOf<T, Ctx>(),
    Did: DidOf<T, Ctx>(),
    Around: AroundOf<T, Ctx>(),
  };
}

type DefaultPlanStage =
  | 'bindProviders'
  | 'acquireQuota'
  | 'acquireSemaphore'
  | 'deductInput'
  | 'parseInput'
  | 'validateInput'
  | 'redactOutput'
  | 'validateOutput'
  | 'audit'
  | 'metrics'
  | 'error';

export const defaultFlowPlan: Omit<RunPlan<DefaultPlanStage>, 'name'> = {
  pre: ['bindProviders', 'acquireQuota', 'acquireSemaphore', 'parseInput', 'deductInput', 'validateInput'],
  execute: [],
  post: ['redactOutput', 'validateOutput'],
  finalize: ['audit', 'metrics'],
  error: ['error'],
};

export const withDefaultFlowPlan = <T extends DefaultPlanStage>(name: FlowName, plan: Omit<RunPlan<T>, 'name'>) =>
  ({
    name,
    pre: plan.pre ?? defaultFlowPlan.pre,
    execute: plan.execute ?? defaultFlowPlan.execute,
    post: plan.post ?? defaultFlowPlan.post,
    finalize: plan.finalize ?? defaultFlowPlan.finalize,
    error: plan.error ?? defaultFlowPlan.error,
  } as const satisfies RunPlan<T>);

type Values<T> = T[keyof T];
type ArrayElem<T> = T extends ReadonlyArray<infer U> ? U : never;

export type StagesFromPlan<P extends Plan<string>> = ArrayElem<Values<Required<P>>>;
