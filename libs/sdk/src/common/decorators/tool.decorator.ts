// @ts-ignore

import 'reflect-metadata';
import {extendedToolMetadata, FrontMcpToolTokens} from '../tokens';
import {ToolMetadata, frontMcpToolMetadataSchema} from '../metadata';
import z from 'zod';
import {ToolContext} from "../interfaces";

/**
 * Decorator that marks a class as a McpTool module and provides metadata
 */
function FrontMcpTool(providedMetadata: ToolMetadata): ClassDecorator {

  return (target: any) => {
    const metadata = frontMcpToolMetadataSchema.parse(providedMetadata);
    Reflect.defineMetadata(FrontMcpToolTokens.type, true, target);
    const extended = {};
    for (const property in metadata) {
      if (FrontMcpToolTokens[property]) {
        Reflect.defineMetadata(FrontMcpToolTokens[property], metadata[property], target);
      } else {
        extended[property] = metadata[property];
      }
    }
    Reflect.defineMetadata(extendedToolMetadata, extended, target);
  };
}


export type FrontMcpToolExecuteHandler<In extends object, Out extends object> = (input: In, ctx: ToolContext<In, Out>) => Out | Promise<Out>;

/**
 * Decorator that marks a class as a McpTool module and provides metadata
 */
function frontMcpTool<T extends ToolMetadata,
  In extends object = z.baseObjectInputType<T['inputSchema']>,
  Out extends object = T['outputSchema'] extends z.ZodRawShape ? z.baseObjectInputType<T['outputSchema']> : object
>(providedMetadata: T): (handler: FrontMcpToolExecuteHandler<In, Out>) => (() => void) {
  return (execute) => {
    const metadata = frontMcpToolMetadataSchema.parse(providedMetadata);
    const toolFunction = function () {
      return execute;
    };
    Object.assign(toolFunction, {
      [FrontMcpToolTokens.type]: 'function-tool',
      [FrontMcpToolTokens.metadata]: metadata,
    });
    return toolFunction;
  };
}

export {
  FrontMcpTool,
  FrontMcpTool as Tool,
  frontMcpTool,
  frontMcpTool as tool,
};


declare module "@frontmcp/sdk" {
  // ---------- zod helpers ----------
  type __Shape = z.ZodRawShape; // = Record<string, z.ZodTypeAny>
  type __AsZodObj<T> =
    T extends z.ZodObject<infer S> ? z.ZodObject<S> :
      T extends z.ZodRawShape ? z.ZodObject<T> :
        never;

  export type __InputOf<Opt> =
    Opt extends { inputSchema: infer I } ? z.infer<__AsZodObj<I>> : never;

  export type __OutputOf<Opt> =
    Opt extends { outputSchema: infer O } ? z.infer<__AsZodObj<O>> : never;

  export type __ToolOptions<I extends __Shape, O extends __Shape> = ToolMetadata<I | z.ZodObject<I>, O | z.ZodObject<O>>;

  // ---------- ctor & reflection ----------
  type __Ctor = new (...a: any[]) => any | (abstract new (...a: any[]) => any);
  type __A<C extends __Ctor> = C extends new (...a: infer A) => any ? A
    : C extends abstract new (...a: infer A) => any ? A : never;
  type __R<C extends __Ctor> = C extends new (...a: any[]) => infer R ? R
    : C extends abstract new (...a: any[]) => infer R ? R : never;

  type __Param<C extends __Ctor> =
    __R<C> extends { execute: (arg: infer P, ...r: any) => any } ? P : never;

  type __Return<C extends __Ctor> =
    __R<C> extends { execute: (...a: any) => infer R } ? R : never;

  type __Unwrap<T> = T extends Promise<infer U> ? U : T;
  type __IsAny<T> = 0 extends (1 & T) ? true : false;

  // ---------- friendly branded errors ----------
  type __Err<M extends string> = { __type_error__: M } & { never?: never };

  // Must extend ToolContext
  type __MustExtendCtx<C extends __Ctor> =
    __R<C> extends ToolContext ? {} :
      __Err<"Class must extend ToolContext">;

  // execute param must exactly match In (and not be any)
  type __MustParam<C extends __Ctor, In> =
    __IsAny<__Param<C>> extends true
      ? __Err<"execute(input) must not be any and must exactly match input schema">
      : __Param<C> extends In
        ? (In extends __Param<C> ? {} : __Err<"execute(input) must be exactly the input schema (no widening or narrowing)">)
        : __Err<"execute(input) parameter does not match input schema">;

  // execute return must be Out or Promise<Out>
  type __MustReturn<C extends __Ctor, Out> =
    __Unwrap<__Return<C>> extends Out ? {} :
      __Err<"execute return type must be output schema or Promise<output schema>">;

  // Rewrapped constructor: preserve concrete/abstract + original type, but guarantee ToolContext<In,Out> on instance
  type __Rewrap<C extends __Ctor, In, Out> =
    C extends abstract new (...a: __A<C>) => __R<C>
      ? C & (abstract new (...a: __A<C>) => (ToolContext<In, Out> & __R<C>))
      : C extends new (...a: __A<C>) => __R<C>
        ? C & (new (...a: __A<C>) => (ToolContext<In, Out> & __R<C>))
        : never;

  // ---------- the decorator ----------
  // @ts-expect-error - Module augmentation requires decorator overload
  export function Tool<
    I extends __Shape,
    O extends __Shape,
    T extends __ToolOptions<I, O>
  >(opts: T): <
    C extends __Ctor
  >(cls: C &
    __MustExtendCtx<C> &
    __MustParam<C, __InputOf<T>> &
    __MustReturn<C, __OutputOf<T>>
  ) => __Rewrap<C, __InputOf<T>, __OutputOf<T>>;
}