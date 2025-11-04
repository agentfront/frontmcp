import { ToolHookStage } from '@frontmcp/sdk';
import { CAN_ACTIVATE_META, HOOK_FILTERS_META, HOOKS_META } from './tool.tokens';


export type HookMethodMeta = {
  stage: ToolHookStage;
  methodName: string;
  isStatic: boolean;
  priority?: number;
  // optional async filter: (ctx) => boolean
  filterKey?: string; // name of a method to call as filter
};

export type FilterMethodMeta = {
  methodName: string; // method returning boolean|Promise<boolean>
  isStatic: boolean;
};

type HookOptions = {
  priority?: number;
  /** Name of a filter method on same class (static or instance) */
  filter?: string;
};

function addHookMeta(target: any, isStatic: boolean, stage: ToolHookStage, methodName: string, opts?: HookOptions) {
  const clazz = isStatic ? target : target.constructor;
  const arr: HookMethodMeta[] = Reflect.getOwnMetadata(HOOKS_META, clazz) ?? [];
  arr.push({
    stage,
    methodName,
    isStatic,
    priority: opts?.priority,
    filterKey: opts?.filter,
  });
  Reflect.defineMetadata(HOOKS_META, arr, clazz);
}

/** Factory for stage decorators: @WillValidateInput(), @DidExecute(), etc. */
export function Hook(stage: ToolHookStage, opts?: HookOptions) {
  return function (target: any, propertyKey: string, _desc: PropertyDescriptor) {
    const isStatic = typeof target === 'function'; // static methods receive constructor as target
    addHookMeta(target, isStatic, stage, propertyKey, opts);
  };
}

/** Specific decorators (ergonomic sugar) */
export const WillBindProviders = (opts?: HookOptions) => Hook(ToolHookStage.willBindProviders, opts);
export const WillParseInput = (opts?: HookOptions) => Hook(ToolHookStage.willParseInput, opts);
export const WillValidateInput = (opts?: HookOptions) => Hook(ToolHookStage.willValidateInput, opts);
export const WillRedactInput = (opts?: HookOptions) => Hook(ToolHookStage.willRedactInput, opts);
export const AroundExecute = (opts?: HookOptions) => Hook(ToolHookStage.aroundExecute, opts);

export const WillReadCache = (opts?: HookOptions) => Hook(ToolHookStage.willReadCache, opts);
export const DidCacheHit = (opts?: HookOptions) => Hook(ToolHookStage.didCacheHit, opts);
export const DidCacheMiss = (opts?: HookOptions) => Hook(ToolHookStage.didCacheMiss, opts);
export const WillWriteCache = (opts?: HookOptions) => Hook(ToolHookStage.willWriteCache, opts);
export const WillExecute = (opts?: HookOptions) => Hook(ToolHookStage.willExecute, opts);
export const DidExecute = (opts?: HookOptions) => Hook(ToolHookStage.didExecute, opts);
export const WillRedactOutput = (opts?: HookOptions) => Hook(ToolHookStage.willRedactOutput, opts);
export const OnMetrics = (opts?: HookOptions) => Hook(ToolHookStage.onMetrics, opts);

/** Optional: method that returns boolean|Promise<boolean>, referenced by opts.filter */
export function HookFilter() {
  return function (target: any, propertyKey: string, _desc: PropertyDescriptor) {
    const isStatic = typeof target === 'function';
    const clazz = isStatic ? target : target.constructor;
    const filters: FilterMethodMeta[] = Reflect.getOwnMetadata(CAN_ACTIVATE_META, clazz) ?? [];
    filters.push({ methodName: propertyKey, isStatic });
    Reflect.defineMetadata(HOOK_FILTERS_META, filters, clazz); // reuse meta bag
  };
}

/** Per-session guard */
export function CanActivate() {
  return function (target: any, propertyKey: string, _desc: PropertyDescriptor) {
    const isStatic = typeof target === 'function';
    const clazz = isStatic ? target : target.constructor;
    const filters: FilterMethodMeta[] = Reflect.getOwnMetadata(CAN_ACTIVATE_META, clazz) ?? [];
    filters.push({ methodName: propertyKey, isStatic });
    Reflect.defineMetadata(CAN_ACTIVATE_META, filters, clazz);
  };
}
