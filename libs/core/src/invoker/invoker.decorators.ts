// invoker/invoker.decorators.ts
import 'reflect-metadata';
import {Token} from '@frontmcp/sdk';

export type HookKind = 'stage' | 'will' | 'did' | 'around';
export type Priority = number;

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

/** Plan type + decorator */
export type Plan<T extends string> = {
  name: T;
  pre?: readonly T[];
  execute?: readonly T[];
  post?: readonly T[];
  finalize?: readonly T[];
  error?: readonly T[];
};

type PlanOptions = {
  dependsOn: Token[]
}

export function InvokePlan<T extends string>(plan: Plan<T>, options?: PlanOptions) {
  return function (ctor: Function) {
    Reflect.defineMetadata(DecoratorMD.PLAN, plan, ctor);
    Reflect.defineMetadata(DecoratorMD.PLAN_NAME, plan.name, ctor);
    Reflect.defineMetadata(DecoratorMD.PLAN_DEPENDS_ON, options?.dependsOn ?? [], ctor);
  };
}


type Values<T> = T[keyof T];
type ArrayElem<T> = T extends ReadonlyArray<infer U> ? U : never;

export type StagesFromPlan<P extends Plan<string>> = ArrayElem<Values<Required<P>>>;
