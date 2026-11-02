/**
 * Flow Hook Decorators
 *
 * This module provides decorators for defining flow stages and lifecycle hooks.
 * Supports both legacy TypeScript decorators and TC39 Stage 3 decorators.
 */

import { InvalidDecoratorMetadataError } from '../../errors/decorator.errors';
import { hookOptionsSchema, type FlowName, type HookMetadata, type HookOptions, type HookStageType } from '../metadata';
import { FrontMcpFlowHookTokens } from '../tokens';
import { isTC39MethodContext, PendingMetadataRegistry, type TC39MethodContext } from './decorator-utils';

/**
 * Pending metadata registry for TC39 decorators
 * Stores hook metadata keyed by method function until class is processed
 */
const pendingHookRegistry = new PendingMetadataRegistry<HookMetadata>();

/**
 * Register hook metadata on a class constructor
 */
function registerHookOnClass(ctor: Function, meta: HookMetadata): void {
  const arr = Reflect.getMetadata(FrontMcpFlowHookTokens.hooks, ctor) ?? [];
  arr.push(meta);
  Reflect.defineMetadata(FrontMcpFlowHookTokens.hooks, arr, ctor);
}

/**
 * Resolve all pending TC39 hooks for a class by scanning its prototype
 * This is called by collectFlowHookMap during flow registration
 */
export function resolvePendingTC39HooksForClass(ctor: Function): HookMetadata[] {
  return pendingHookRegistry.resolveForClass(ctor);
}

/** The pending TC39 hooks of a class, left pending for the flow registration that resolves them. */
export function peekPendingTC39HooksForClass(ctor: Function): HookMetadata[] {
  return pendingHookRegistry.resolveForClass(ctor, false);
}

/**
 * Store a pending hook for TC39 mode
 * @internal
 */
export function registerPendingTC39Hook(method: Function, meta: HookMetadata): void {
  pendingHookRegistry.store(method, meta);
}

/**
 * Get and clear pending hooks for a method (TC39 mode)
 * @internal
 */
export function consumePendingTC39Hooks(method: Function): HookMetadata[] {
  return pendingHookRegistry.consume(method);
}

/** The method a Stage, Will, Did or Finally hook decorates: the runner calls it with the flow (`FlowCtxOf<Name>`). */
export type FlowHookMethod<Ctx> = (ctx: Ctx) => unknown;

/** The method an Around hook decorates: `next()` runs the rest of the stage, and rejects when it fails. */
export type AroundFlowHookMethod<Ctx> = (ctx: Ctx, next: () => Promise<void>) => unknown;

/** A hook decorator: the method's parameter must be the flow's ctx or a structural subset of it, or be omitted. */
export type FlowHookDecorator<Method> = <T extends Method>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<T>,
) => void;

/** Throws where the hook is declared when its `appliesTo`, `before` or `after` is not one the SDK can apply. */
function assertHookOptions(type: HookStageType, stage: string, opts: unknown): void {
  const parsed = hookOptionsSchema.safeParse(opts);
  if (parsed.success) return;
  const [issue] = parsed.error.issues;
  const decoratorName = `${type[0].toUpperCase()}${type.slice(1)}('${stage}')`;
  throw new InvalidDecoratorMetadataError(decoratorName, String(issue?.path[0] ?? 'options'), issue?.message ?? '');
}

/**
 * Base factory for creating hook decorators
 * Works with both legacy TypeScript and TC39 Stage 3 decorators
 */
function make(flow: FlowName, type: HookStageType) {
  return function <Ctx, T extends string, Method>(stage: T, opts: HookOptions<Ctx> = {}): FlowHookDecorator<Method> {
    assertHookOptions(type, stage, opts);
    return (target: any, keyOrContext: any, _desc?: PropertyDescriptor): any => {
      const { priority = 0, filter, ...rest } = opts;

      // Detect TC39 Stage 3 decorators vs legacy TypeScript decorators
      if (isTC39MethodContext(keyOrContext)) {
        // TC39 Stage 3 decorator style
        const context = keyOrContext as TC39MethodContext;
        const methodName = String(context.name);
        const isStatic = context.static;
        const method = target; // In TC39, target is the method function itself

        const meta: HookMetadata = {
          ...rest,
          [FrontMcpFlowHookTokens.type]: true,
          flow: flow,
          type: type,
          stage: stage,
          method: methodName,
          priority: priority,
          filter: filter,
          target: null, // Will be resolved at execution time
          static: isStatic,
        };

        // Store as pending - resolved when collectFlowHookMap processes the class
        pendingHookRegistry.store(method, meta);

        // Return the original method unchanged
        return target;
      } else {
        // Legacy TypeScript decorator style
        const key = keyOrContext;
        const methodName = String(key);
        const isStatic = typeof target === 'function';
        const ctor = isStatic ? target : target.constructor;

        const meta: HookMetadata = {
          ...rest,
          [FrontMcpFlowHookTokens.type]: true,
          flow: flow,
          type: type,
          stage: stage,
          method: methodName,
          priority: priority,
          filter: filter,
          target: target,
          static: isStatic,
        };

        // Register immediately on the class
        registerHookOnClass(ctor, meta);

        return undefined;
      }
    };
  };
}

/**
 * Creates a typed Stage hook decorator for a specific flow
 * @example
 * ```typescript
 * const { Stage } = FlowHooksOf('http:request');
 *
 * class HttpRequestFlow {
 *   @Stage('checkAuthorization')
 *   async checkAuthorization() { ... }
 * }
 * ```
 */
export function StageHookOf<Name extends FlowName>(flow: Name) {
  type T = ExtendFlows[Name]['stage'];
  type Ctx = ExtendFlows[Name]['ctx'];
  const base = make(flow, 'stage');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T, FlowHookMethod<Ctx>>(stage, opts);
  };
}

/**
 * Creates a typed Will hook decorator (runs before stage)
 */
export function WillHookOf<Name extends FlowName>(flow: Name) {
  type T = ExtendFlows[Name]['stage'];
  type Ctx = ExtendFlows[Name]['ctx'];
  const base = make(flow, 'will');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T, FlowHookMethod<Ctx>>(stage, opts);
  };
}

/**
 * Creates a typed Did hook decorator (runs after the stage succeeds, and not when it fails)
 */
export function DidHookOf<Name extends FlowName>(flow: Name) {
  type T = ExtendFlows[Name]['stage'];
  type Ctx = ExtendFlows[Name]['ctx'];
  const base = make(flow, 'did');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T, FlowHookMethod<Ctx>>(stage, opts);
  };
}

/**
 * Creates a typed Around hook decorator (wraps stage execution)
 */
export function AroundHookOf<Name extends FlowName>(name: Name) {
  type T = ExtendFlows[Name]['stage'];
  type Ctx = ExtendFlows[Name]['ctx'];
  const base = make(name, 'around');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T, AroundFlowHookMethod<Ctx>>(stage, opts);
  };
}

/**
 * Creates a typed Finally hook decorator (runs after the stage whatever its outcome; cannot change it)
 */
export function FinallyHookOf<Name extends FlowName>(name: Name) {
  type T = ExtendFlows[Name]['stage'];
  type Ctx = ExtendFlows[Name]['ctx'];
  const base = make(name, 'finally');
  return function (stage: T, opts: HookOptions<Ctx> = {}) {
    return base<Ctx, T, FlowHookMethod<Ctx>>(stage, opts);
  };
}

/**
 * Creates all hook decorators for a specific flow
 * @example
 * ```typescript
 * const { Stage, Will, Did, Around, Finally } = FlowHooksOf('http:request');
 *
 * class HttpRequestFlow {
 *   @Stage('checkAuthorization')
 *   async checkAuthorization() { ... }
 *
 *   @Will('execute', { priority: 10 })
 *   async beforeExecute() { ... }
 * }
 * ```
 */
export function FlowHooksOf<Name extends FlowName>(name: Name) {
  return {
    Stage: StageHookOf(name),
    Will: WillHookOf(name),
    Did: DidHookOf(name),
    Around: AroundHookOf(name),
    Finally: FinallyHookOf(name),
  };
}
