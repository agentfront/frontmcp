import z from 'zod/v4';
import { ToolMetadata, Token, ToolHookStage, Type } from '@frontmcp/sdk';
import { ToolInvokeContext } from './tool.context';
import { HookMethodMeta } from './tool.decorators';
import { ToolProvidedByKind } from './tool.types';
import { getMetadata } from '../utils/metadata.utils';
import { CAN_ACTIVATE_META, HOOK_FILTERS_META, HOOKS_META } from './tool.tokens';
import { ZodObject } from 'zod';

export interface ToolRecordInit<
  InputSchema extends Record<string, ZodObject<any>> = Record<string, ZodObject<any>>,
  OutputSchema extends Record<string, ZodObject<any>> = never,
> {
  id: string;
  name: string;
  description: string;
  kind: ToolProvidedByKind;
  provider?: Token | string;

  toolClass: Type;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  hooksByStage?: Partial<Record<ToolHookStage, Type[]>>; // class-based hooks
  capabilityHash?: string;
  /** Optional direct executor. If provided, invoke() will use this instead of resolving an instance. */
  execute?: (
    input: z.infer<InputSchema>,
    ctx: ToolInvokeContext<InputSchema, OutputSchema>,
  ) => Promise<z.infer<OutputSchema>>;
}

export class ToolRecordImpl<
  InputSchema extends Record<string, ZodObject<any>> = Record<string, ZodObject<any>>,
  OutputSchema extends Record<string, ZodObject<any>> = Record<string, ZodObject<any>>,
> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: ToolProvidedByKind;
  readonly provider?: Token | string;
  readonly toolClass: Type;
  readonly metadata: ToolMetadata;
  readonly inputSchema: InputSchema;
  readonly outputSchema: OutputSchema;

  private readonly directExecute?: (
    input: z.infer<InputSchema>,
    ctx: ToolInvokeContext<InputSchema, OutputSchema>,
  ) => Promise<z.infer<OutputSchema>>;

  readonly hooksByStage: Partial<Record<ToolHookStage, Type[]>>;

  /** NEW: function-based hooks discovered via decorators (method references) */
  readonly hookFnsByStage: Partial<Record<ToolHookStage, HookMethodMeta[]>>;

  constructor(init: ToolRecordInit<InputSchema, OutputSchema>) {
    this.id = init.id;
    this.name = init.name;
    this.description = init.description;
    this.kind = init.kind;
    this.provider = init.provider;
    this.toolClass = init.toolClass;
    this.inputSchema = init.inputSchema;
    this.outputSchema = init.outputSchema;
    this.directExecute = init.execute;
    this.hooksByStage = init.hooksByStage ?? {};
    // const keys = (getMetadata(MCP_TOOL_KEYS_META, this.toolClass) as string[]) ?? [];
    // this.metadata = keys.reduce(
    //   (acc, key) => ({
    //     ...acc,
    //     [key]: getMetadata(key, this.toolClass),
    //   }),
    //   {} as ToolMetadata,
    // );

    const hookMethods: HookMethodMeta[] = getMetadata(HOOKS_META, this.toolClass) ?? [];
    const hookFilters: HookMethodMeta[] = getMetadata(HOOK_FILTERS_META, this.toolClass) ?? [];

    this.hookFnsByStage = [...hookMethods, ...hookFilters].reduce(
      (filters, hook) => ({
        ...filters,
        [hook.stage]: [...(filters[hook.stage] ?? []), hook],
      }),
      {} as Partial<Record<ToolHookStage, HookMethodMeta[]>>,
    );
  }

  getExecutor(resolve: <T>(cls: Type<T>) => T) {
    if (this.directExecute) return (input, ctx) => this.directExecute?.(input, ctx);

    return async (input, ctx) => {
      const inst: any = resolve(this.toolClass);
      if (!inst || typeof inst.execute !== 'function') throw new Error(`Tool ${this.id} missing execute()`);
      return inst.execute(input, ctx);
    };
  }

  /** Discover a canActivate guard provided via decorator (preferred) or static/instance method of that name */
  getCanActivate(resolve: <T>(cls: Type<T>) => T) {
    const metas: HookMethodMeta[] =
      Reflect.getOwnMetadata(CAN_ACTIVATE_META, this.toolClass) ??
      Reflect.getOwnMetadata(CAN_ACTIVATE_META, this.toolClass.prototype) ??
      [];

    for (const meta of metas) {
      if (meta?.methodName) {
        if (meta.isStatic) {
          const fn = (this.toolClass as any)[meta.methodName];
          if (typeof fn === 'function')
            return (ctx: ToolInvokeContext<InputSchema, OutputSchema>) => fn.call(this.toolClass, ctx);
        } else {
          try {
            const inst: any = resolve(this.toolClass);
            const fn = inst?.[meta.methodName];
            if (typeof fn === 'function')
              return (ctx: ToolInvokeContext<InputSchema, OutputSchema>) => fn.call(inst, ctx);
          } catch {
            // TODO: use logger
            console.log('Failed to resolve instance method for canActivate: ', meta.methodName);
          }
        }
      }
      // fallback: static canActivate / instance canActivate without decorator
      const C: any = this.toolClass;
      if (typeof C.canActivate === 'function')
        return (ctx: ToolInvokeContext<InputSchema, OutputSchema>) => C.canActivate(ctx);
      try {
        const inst: any = resolve(this.toolClass);
        if (typeof inst?.canActivate === 'function')
          return (ctx: ToolInvokeContext<InputSchema, OutputSchema>) => inst.canActivate(ctx);
      } catch {
        // TODO: use logger
        console.log('Failed to resolve instance method for canActivate: ', meta.methodName);
      }
    }
    return undefined;
  }

}
