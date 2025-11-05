import {HookType, HookOptions, HookMetadata, FlowName} from '../metadata';
import {FrontMcpFlowHookTokens} from '../tokens';


function registerFlowHook(target: any, meta: HookMetadata) {
  const ctor = target.constructor;
  const arr: HookMetadata[] = Reflect.getMetadata(FrontMcpFlowHookTokens.hooks, ctor) ?? [];
  arr.push(meta);
  Reflect.defineMetadata(FrontMcpFlowHookTokens.hooks, arr, ctor);
}

/** Base factory (kept internal) */
function make(flow: FlowName, type: HookType) {
  return function <Ctx = unknown, T extends string = string>(stage: T, opts: HookOptions<Ctx> = {}): MethodDecorator {
    return (target: any, key, _desc) => {
      registerFlowHook(target, {
        flow,
        type,
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
export function StageHookOf<Name extends FlowName>(flow: Name) {
  type T = ExtendFlows[Name]['stage']
  type Ctx = ExtendFlows[Name]['ctx']
  const base = make(flow, 'stage');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}

export function WillHookOf<Name extends FlowName>(flow: Name) {
  type T = ExtendFlows[Name]['stage']
  type Ctx = ExtendFlows[Name]['ctx']
  const base = make(flow, 'will');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}

export function DidHookOf<Name extends FlowName>(flow: Name) {
  type T = ExtendFlows[Name]['stage']
  type Ctx = ExtendFlows[Name]['ctx']
  const base = make(flow, 'did');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T>(stage, opts);
  };
}

export function AroundHookOf<Name extends FlowName>(name: Name) {
  type T = ExtendFlows[Name]['stage']
  type Ctx = ExtendFlows[Name]['ctx']
  const base = make(name, 'around');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
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

