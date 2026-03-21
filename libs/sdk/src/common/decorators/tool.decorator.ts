import 'reflect-metadata';
import { extendedToolMetadata, FrontMcpToolTokens } from '../tokens';
import {
  ToolMetadata,
  frontMcpToolMetadataSchema,
  ImageOutputSchema,
  AudioOutputSchema,
  ResourceOutputSchema,
  ResourceLinkOutputSchema,
  ToolInputType,
  ToolOutputType,
} from '../metadata';
import type { ToolUIConfig } from '../metadata/tool-ui.metadata';
import type { EsmOptions, RemoteOptions } from '../metadata';
import type { ConcurrencyConfigInput, RateLimitConfigInput, TimeoutConfigInput } from '@frontmcp/guard';
import z from 'zod';
import { ToolContext } from '../interfaces';
import { ToolKind } from '../records/tool.record';
import type { ToolEsmTargetRecord, ToolRemoteRecord } from '../records/tool.record';
import { parsePackageSpecifier } from '../../esm-loader/package-specifier';
import { validateRemoteUrl } from '../utils/validate-remote-url';

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

export type FrontMcpToolExecuteHandler<
  InSchema extends ToolInputType,
  OutSchema extends ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> = (input: In, ctx: ToolContext<InSchema, OutSchema>) => Out | Promise<Out>;

/**
 * Decorator that marks a class as a McpTool module and provides metadata
 */
function frontMcpTool<
  T extends ToolMetadata,
  InSchema extends ToolInputType = T['inputSchema'],
  OutSchema extends ToolOutputType = T['outputSchema'],
>(providedMetadata: T): (handler: FrontMcpToolExecuteHandler<InSchema, OutSchema>) => () => void {
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

// ═══════════════════════════════════════════════════════════════════
// STATIC METHODS: Tool.esm() and Tool.remote()
// ═══════════════════════════════════════════════════════════════════

function toolEsm(specifier: string, targetName: string, options?: EsmOptions<ToolMetadata>): ToolEsmTargetRecord {
  const parsed = parsePackageSpecifier(specifier);
  return {
    kind: ToolKind.ESM,
    provide: Symbol(`esm-tool:${parsed.fullName}:${targetName}`),
    specifier: parsed,
    targetName,
    options,
    metadata: {
      name: targetName,
      description: `Tool "${targetName}" from ${parsed.fullName}`,
      inputSchema: {},
      ...options?.metadata,
    },
  };
}

function toolRemote(url: string, targetName: string, options?: RemoteOptions<ToolMetadata>): ToolRemoteRecord {
  validateRemoteUrl(url);
  return {
    kind: ToolKind.REMOTE,
    provide: Symbol(`remote-tool:${url}:${targetName}`),
    url,
    targetName,
    transportOptions: options?.transportOptions,
    remoteAuth: options?.remoteAuth,
    metadata: {
      name: targetName,
      description: `Remote tool "${targetName}" from ${url}`,
      inputSchema: {},
      ...options?.metadata,
    },
  };
}

Object.assign(FrontMcpTool, {
  esm: toolEsm,
  remote: toolRemote,
});

export { FrontMcpTool, FrontMcpTool as Tool, frontMcpTool, frontMcpTool as tool };

/**
 * This is a modified version of the original decorator, with the following changes:
 * - Added support for ZodRawShape as inputSchema
 * - Added support for outputSchema: any of the allowed forms
 * - Added rich error messages for input/output type mismatches
 *
 * Don't move below code outside the decorator file, it will break the module augmentation.
 */
// ---------- zod helpers ----------
type __Shape = z.ZodRawShape;
type __AsZodObj<T> = T extends z.ZodRawShape ? z.ZodObject<T> : never;

export type ToolInputOf<Opt> = Opt extends { inputSchema: infer I } ? z.output<__AsZodObj<I>> : never;

// ---------- output inference helpers for NEW schemas ----------

/**
 * Helper to infer the return type from any Zod schema,
 * including ZodRawShape.
 */
type __InferZod<S> = S extends z.ZodType ? z.infer<S> : S extends z.ZodRawShape ? z.infer<z.ZodObject<S>> : never;

/**
 * Infers the *output type* from a *single schema definition*
 * based on the new ToolSingleOutputType.
 */
type __InferFromSingleSchema<S> =
  // Handle specific MCP type literals
  S extends 'image'
    ? z.infer<typeof ImageOutputSchema>
    : S extends 'audio'
      ? z.infer<typeof AudioOutputSchema>
      : S extends 'resource'
        ? z.infer<typeof ResourceOutputSchema>
        : S extends 'resource_link'
          ? z.infer<typeof ResourceLinkOutputSchema>
          : // Handle primitive type literals
            S extends 'string'
            ? string
            : S extends 'number'
              ? number
              : S extends 'boolean'
                ? boolean
                : S extends 'date'
                  ? Date
                  : // Handle all Zod schemas (primitives, objects, arrays, etc.)
                    // This will correctly infer z.ZodString to string, etc.
                    S extends z.ZodType | z.ZodRawShape
                    ? __InferZod<S>
                    : // Fallback for unknown/unrecognized schema
                      any;

/**
 * Infers a tuple/array of output types from an array of schemas
 */
type __InferFromArraySchema<A> = A extends readonly any[] ? { [K in keyof A]: __InferFromSingleSchema<A[K]> } : never;

/**
 * Main output type inference.
 * Handles single schemas, arrays of schemas, or no schema.
 */
export type ToolOutputOf<Opt> = Opt extends { outputSchema: infer O }
  ? O extends readonly any[] // Check for array/tuple first
    ? __InferFromArraySchema<O>
    : __InferFromSingleSchema<O> // Handle a single schema
  : any; // no outputSchema property at all -> allow anything

// --- Define the schema types locally to constrain the generic ---
// This mirrors your `ToolOutputType` definitions for use in constraints.

type __PrimitiveOutputType =
  | 'string'
  | 'number'
  | 'date'
  | 'boolean'
  | z.ZodString
  | z.ZodNumber
  | z.ZodBoolean
  | z.ZodBigInt
  | z.ZodDate;
type __ImageOutputType = 'image';
type __AudioOutputType = 'audio';
type __ResourceOutputType = 'resource';
type __ResourceLinkOutputType = 'resource_link';
type __StructuredOutputType =
  | z.ZodRawShape
  | z.ZodObject<any>
  | z.ZodArray<z.ZodType>
  | z.ZodUnion<[z.ZodObject<any>, ...z.ZodObject<any>[]]>
  | z.ZodDiscriminatedUnion<[z.ZodObject<any>, ...z.ZodObject<any>[]]>;

type __ToolSingleOutputType =
  | __PrimitiveOutputType
  | __ImageOutputType
  | __AudioOutputType
  | __ResourceOutputType
  | __ResourceLinkOutputType
  | __StructuredOutputType;

// This is the final constraint for the `outputSchema` option
type __OutputSchema = __ToolSingleOutputType | __ToolSingleOutputType[];

/**
 * Base tool metadata options without UI field.
 */
type __ToolMetadataBase<I extends __Shape, O extends __OutputSchema> = ToolMetadata<
  I, // inputSchema: ZodRawShape only
  O // outputSchema: any of the allowed forms
>;

/**
 * Tool metadata options with optional UI configuration.
 *
 * The `ui` property accepts a `ToolUIConfig` from `@frontmcp/ui/types`
 * for configuring interactive widget rendering.
 */
/**
 * Tool metadata options with permissive guard config types for IDE IntelliSense.
 *
 * Guard fields (concurrency, rateLimit, timeout) use auto-generated Input types
 * where all fields are optional. Required fields are validated at runtime by Zod.
 * @see schemas.generated.ts in @frontmcp/guard
 */
export type ToolMetadataOptions<I extends __Shape, O extends __OutputSchema> = Omit<
  __ToolMetadataBase<I, O>,
  'concurrency' | 'rateLimit' | 'timeout' | 'ui'
> & {
  concurrency?: ConcurrencyConfigInput;
  rateLimit?: RateLimitConfigInput;
  timeout?: TimeoutConfigInput;
  ui?: ToolUIConfig<ToolInputOf<{ inputSchema: I }>, ToolOutputOf<{ outputSchema: O }>>;
};

// ---------- ctor & reflection ----------
type __Ctor = (new (...a: any[]) => any) | (abstract new (...a: any[]) => any);
type __A<C extends __Ctor> = C extends new (...a: infer A) => any
  ? A
  : C extends abstract new (...a: infer A) => any
    ? A
    : never;
type __R<C extends __Ctor> = C extends new (...a: any[]) => infer R
  ? R
  : C extends abstract new (...a: any[]) => infer R
    ? R
    : never;
type __Param<C extends __Ctor> = __R<C> extends { execute: (arg: infer P, ...r: any) => any } ? P : never;
type __Return<C extends __Ctor> = __R<C> extends { execute: (...a: any) => infer R } ? R : never;
type __Unwrap<T> = T extends Promise<infer U> ? U : T;
type __IsAny<T> = 0 extends 1 & T ? true : false;

// ---------- friendly branded errors (UPDATED) ----------

// Must extend ToolContext (assuming ToolContext is exported by the SDK)
type __MustExtendCtx<C extends __Ctor> =
  __R<C> extends ToolContext ? unknown : { 'Tool class error': 'Class must extend ToolContext' };

// execute param must exactly match In (and not be any)
type __MustParam<C extends __Ctor, In> =
  // 1. If 'In' (from schema) is 'any', we can't check, so allow.
  __IsAny<In> extends true
    ? unknown
    : // 2. Check if the actual param type is 'any'. This is an error.
      __IsAny<__Param<C>> extends true
      ? { 'execute() parameter error': "Parameter type must not be 'any'."; expected_input_type: In }
      : // 3. Check for the exact match: Param extends In AND In extends Param
        __Param<C> extends In
        ? In extends __Param<C>
          ? unknown // OK, exact match
          : {
              'execute() parameter error': 'Parameter type is too wide. It must exactly match the input schema.';
              expected_input_type: In;
              actual_parameter_type: __Param<C>;
            }
        : {
            'execute() parameter error': 'Parameter type does not match the input schema.';
            expected_input_type: In;
            actual_parameter_type: __Param<C>;
          };

// execute return must be Out or Promise<Out>
type __MustReturn<C extends __Ctor, Out> =
  // 1. If 'Out' (from schema) is 'any', no check is needed.
  __IsAny<Out> extends true
    ? unknown
    : // 2. Check if the unwrapped return type is assignable to Out.
      __Unwrap<__Return<C>> extends Out
      ? unknown // OK
      : {
          'execute() return type error': "The method's return type is not assignable to the expected output schema type.";
          expected_output_type: Out;
          'actual_return_type (unwrapped)': __Unwrap<__Return<C>>;
        };

// Rewrapped constructor with updated ToolContext generic params
type __Rewrap<C extends __Ctor, In, Out> = C extends abstract new (...a: __A<C>) => __R<C>
  ? C & (abstract new (...a: __A<C>) => ToolContext<any, any, In, Out> & __R<C>)
  : C extends new (...a: __A<C>) => __R<C>
    ? C & (new (...a: __A<C>) => ToolContext<any, any, In, Out> & __R<C>)
    : never;

declare module '@frontmcp/sdk' {
  // ---------- the decorator (overloads) ----------

  // 1) Overload: outputSchema PROVIDED → strict return typing
  // @ts-expect-error - Module augmentation requires decorator overload
  export function Tool<I extends __Shape, O extends __OutputSchema>(
    opts: ToolMetadataOptions<I, O> & { outputSchema: O },
  ): <C extends __Ctor>(
    cls: C &
      __MustExtendCtx<C> &
      __MustParam<C, ToolInputOf<{ inputSchema: I }>> &
      __MustReturn<C, ToolOutputOf<{ outputSchema: O }>>,
  ) => __Rewrap<C, ToolInputOf<{ inputSchema: I }>, ToolOutputOf<{ outputSchema: O }>>;

  // 2) Overload: outputSchema NOT PROVIDED → execute() can return any
  // @ts-expect-error - Module augmentation requires decorator overload
  export function Tool<I extends __Shape>(
    opts: ToolMetadataOptions<I, any> & { outputSchema?: never },
  ): <C extends __Ctor>(
    cls: C & __MustExtendCtx<C> & __MustParam<C, ToolInputOf<{ inputSchema: I }>> & __MustReturn<C, ToolOutputOf<{}>>,
  ) => __Rewrap<C, ToolInputOf<{ inputSchema: I }>, ToolOutputOf<{}>>;
}
