import { FlowHookKind, FlowHookOptions, FlowHookMeta, FlowName } from '../metadata';
import { FrontMcpFlowHookTokens } from '../tokens';


function registerFlowHook(target: any, meta: FlowHookMeta) {
  const ctor = target.constructor;
  const arr: FlowHookMeta[] = Reflect.getMetadata(FrontMcpFlowHookTokens.hooks, ctor) ?? [];
  arr.push(meta);
  Reflect.defineMetadata(FrontMcpFlowHookTokens.hooks, arr, ctor);
}

/** Base factory (kept internal) */
function make(kind: FlowHookKind) {
  return function <Ctx = unknown, T extends string = string>(stage: T, opts: FlowHookOptions<Ctx> = {}): MethodDecorator {
    return (target: any, key, _desc) => {
      registerFlowHook(target, {
        kind,
        stage: String(stage),
        method: String(key),
        priority: opts.priority ?? 0,
        filter: opts.filter as any,
        static: Boolean(target.constructor[key]),
      });
    };
  };
}

/** NEW: typed variants */
export function StageHookOf<Name extends FlowName>(name: Name) {
  type T = ExtendFlows[Name]['stage']
  type Ctx = ExtendFlows[Name]['ctx']
  const base = make('stage');
  return function(stage: T, opts: FlowHookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}

export function WillHookOf<Name extends FlowName>(name: Name) {
  type T = ExtendFlows[Name]['stage']
  type Ctx = ExtendFlows[Name]['ctx']
  const base = make('will');
  return function(stage: T, opts: FlowHookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}

export function DidHookOf<Name extends FlowName>(name: Name) {
  type T = ExtendFlows[Name]['stage']
  type Ctx = ExtendFlows[Name]['ctx']
  const base = make('did');
  return function(stage: T, opts: FlowHookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}

export function AroundHookOf<Name extends FlowName>(name: Name) {
  type T = ExtendFlows[Name]['stage']
  type Ctx = ExtendFlows[Name]['ctx']
  const base = make('around');
  return function(stage: T, opts: FlowHookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}

export function FlowHooksOf<Name extends FlowName>(name: Name) {
  return {
    Stage: StageHookOf(name),
    Will: WillHookOf(name),
    Did: DidHookOf(name),
    Around: AroundHookOf(name),
  };
}

