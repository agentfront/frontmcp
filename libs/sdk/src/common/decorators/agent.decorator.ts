import 'reflect-metadata';
import { extendedAgentMetadata, FrontMcpAgentTokens } from '../tokens';
import { ToolInputType, ToolOutputType, AgentMetadata, frontMcpAgentMetadataSchema } from '../metadata';
import z from 'zod';

// Forward reference - AgentContext will be defined in agent.interface.ts
type AgentContextBase = { execute: (...args: any[]) => any };

/**
 * Class decorator that marks a class as an FrontMCP Agent and provides metadata.
 *
 * @example
 * ```typescript
 * @Agent({
 *   name: 'research-agent',
 *   description: 'Researches topics and compiles reports',
 *   llm: { adapter: 'openai', model: 'gpt-4-turbo', apiKey: { env: 'OPENAI_API_KEY' } },
 *   tools: [WebSearchTool, SummarizeTool],
 * })
 * export default class ResearchAgent extends AgentContext { ... }
 * ```
 */
function FrontMcpAgent<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
>(providedMetadata: AgentMetadata<InSchema, OutSchema>): ClassDecorator {
  return (target: any) => {
    const metadata = frontMcpAgentMetadataSchema.parse(providedMetadata);
    Reflect.defineMetadata(FrontMcpAgentTokens.type, true, target);
    const extended: Record<string, unknown> = {};
    for (const property in metadata) {
      if (FrontMcpAgentTokens[property as keyof typeof FrontMcpAgentTokens]) {
        Reflect.defineMetadata(
          FrontMcpAgentTokens[property as keyof typeof FrontMcpAgentTokens],
          (metadata as Record<string, unknown>)[property],
          target,
        );
      } else {
        extended[property] = (metadata as Record<string, unknown>)[property];
      }
    }
    Reflect.defineMetadata(extendedAgentMetadata, extended, target);
  };
}

/**
 * Handler type for function-based agents.
 */
export type FrontMcpAgentExecuteHandler<
  InSchema extends ToolInputType,
  OutSchema extends ToolOutputType,
  In = AgentInputOf<{ inputSchema: InSchema }>,
  Out = AgentOutputOf<{ outputSchema: OutSchema }>,
> = (input: In, ctx: AgentContextBase) => Out | Promise<Out>;

/**
 * Return type for function-based agents created with agent().
 * Contains the handler function and agent metadata symbols.
 */
export type FrontMcpAgentFunction<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
> = (() => FrontMcpAgentExecuteHandler<InSchema, OutSchema>) & {
  [FrontMcpAgentTokens.type]: 'function-agent';
  [FrontMcpAgentTokens.metadata]: AgentMetadata<InSchema, OutSchema>;
};

/**
 * Function decorator that creates an agent from a handler function.
 *
 * @example
 * ```typescript
 * const researchAgent = agent({
 *   name: 'research-agent',
 *   inputSchema: { topic: z.string() },
 *   llm: { adapter: 'openai', model: 'gpt-4-turbo', apiKey: { env: 'OPENAI_API_KEY' } },
 * })((input, ctx) => {
 *   // Agent implementation
 *   return { result: 'done' };
 * });
 * ```
 */
function frontMcpAgent<
  T extends AgentMetadata<InSchema, OutSchema>,
  InSchema extends ToolInputType = T['inputSchema'] extends ToolInputType ? T['inputSchema'] : ToolInputType,
  OutSchema extends ToolOutputType = T['outputSchema'],
>(
  providedMetadata: T,
): (handler: FrontMcpAgentExecuteHandler<InSchema, OutSchema>) => FrontMcpAgentFunction<InSchema, OutSchema> {
  return (execute) => {
    const metadata = frontMcpAgentMetadataSchema.parse(providedMetadata);
    const agentFunction = function () {
      return execute;
    } as FrontMcpAgentFunction<InSchema, OutSchema>;
    Object.assign(agentFunction, {
      [FrontMcpAgentTokens.type]: 'function-agent',
      [FrontMcpAgentTokens.metadata]: metadata,
    });
    return agentFunction;
  };
}

export { FrontMcpAgent, FrontMcpAgent as Agent, frontMcpAgent, frontMcpAgent as agent };

// ============================================================================
// Type Inference Helpers
// ============================================================================

/**
 * This is a modified version following the tool decorator pattern.
 * Provides type inference for agent input/output schemas.
 */

// ---------- zod helpers ----------
type __Shape = z.ZodRawShape;
type __AsZodObj<T> = T extends z.ZodObject<any> ? T : T extends z.ZodRawShape ? z.ZodObject<T> : never;

/**
 * Infers the input type from an agent's inputSchema.
 */
export type AgentInputOf<Opt> = Opt extends { inputSchema: infer I } ? z.infer<__AsZodObj<I>> : never;

// ---------- output inference helpers ----------

/**
 * Helper to infer the return type from any Zod schema.
 */
type __InferZod<S> = S extends z.ZodType ? z.infer<S> : S extends z.ZodRawShape ? z.infer<z.ZodObject<S>> : never;

/**
 * Infers the output type from a single schema definition.
 */
type __InferFromSingleSchema<S> = S extends 'string'
  ? string
  : S extends 'number'
  ? number
  : S extends 'boolean'
  ? boolean
  : S extends 'date'
  ? Date
  : S extends z.ZodType | z.ZodRawShape
  ? __InferZod<S>
  : any;

/**
 * Infers a tuple/array of output types from an array of schemas.
 */
type __InferFromArraySchema<A> = A extends readonly any[] ? { [K in keyof A]: __InferFromSingleSchema<A[K]> } : never;

/**
 * Main output type inference for agents.
 * Handles single schemas, arrays of schemas, or no schema.
 */
export type AgentOutputOf<Opt> = Opt extends { outputSchema: infer O }
  ? O extends readonly any[]
    ? __InferFromArraySchema<O>
    : __InferFromSingleSchema<O>
  : any;

// ============================================================================
// Module Augmentation for Strict Type Checking
// ============================================================================

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

// ---------- friendly branded errors ----------

// Check if param is the base class default (indicates no override, using default execute())
type __IsBaseClassDefault<P> = P extends Record<string, unknown>
  ? Record<string, unknown> extends P
    ? true // P is exactly Record<string, unknown> - no override
    : false
  : false;

// execute param must exactly match In (and not be any), or be the base class default
type __MustParam<C extends __Ctor, In> = __IsAny<In> extends true
  ? unknown
  : __IsAny<__Param<C>> extends true
  ? { 'execute() parameter error': "Parameter type must not be 'any'."; expected_input_type: In }
  : __IsBaseClassDefault<__Param<C>> extends true
  ? unknown // Allow base class default - user is using default execute()
  : __Param<C> extends In
  ? In extends __Param<C>
    ? unknown
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
type __MustReturn<C extends __Ctor, Out> = __IsAny<Out> extends true
  ? unknown
  : __Unwrap<__Return<C>> extends Out
  ? unknown
  : {
      'execute() return type error': "The method's return type is not assignable to the expected output schema type.";
      expected_output_type: Out;
      'actual_return_type (unwrapped)': __Unwrap<__Return<C>>;
    };

// Rewrapped constructor with updated AgentContext generic params
type __Rewrap<C extends __Ctor, In, Out> = C extends abstract new (...a: __A<C>) => __R<C>
  ? C & (abstract new (...a: __A<C>) => AgentContextBase & __R<C>)
  : C extends new (...a: __A<C>) => __R<C>
  ? C & (new (...a: __A<C>) => AgentContextBase & __R<C>)
  : never;

// Output schema constraint types
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
type __StructuredOutputType =
  | z.ZodRawShape
  | z.ZodObject<any>
  | z.ZodArray<z.ZodType>
  | z.ZodUnion<[z.ZodObject<any>, ...z.ZodObject<any>[]]>
  | z.ZodDiscriminatedUnion<z.ZodObject<any>[]>;

type __AgentSingleOutputType = __PrimitiveOutputType | __StructuredOutputType;
type __OutputSchema = __AgentSingleOutputType | __AgentSingleOutputType[];

/**
 * Agent metadata options with type constraints.
 */
export type AgentMetadataOptions<I extends __Shape, O extends __OutputSchema> = AgentMetadata<I | z.ZodObject<I>, O>;

declare module '@frontmcp/sdk' {
  // ---------- the decorator (overloads) ----------

  // 1) Overload: outputSchema PROVIDED → strict return typing
  // @ts-expect-error - Module augmentation requires decorator overload
  export function Agent<
    I extends __Shape,
    O extends __OutputSchema,
    T extends AgentMetadataOptions<I, O> & { outputSchema: any },
  >(
    opts: T,
  ): <C extends __Ctor>(
    cls: C & __MustParam<C, AgentInputOf<T>> & __MustReturn<C, AgentOutputOf<T>>,
  ) => __Rewrap<C, AgentInputOf<T>, AgentOutputOf<T>>;

  // 2) Overload: outputSchema NOT PROVIDED → execute() can return any
  // @ts-expect-error - Module augmentation requires decorator overload
  export function Agent<I extends __Shape, T extends AgentMetadataOptions<I, any> & { outputSchema?: never }>(
    opts: T,
  ): <C extends __Ctor>(
    cls: C & __MustParam<C, AgentInputOf<T>> & __MustReturn<C, AgentOutputOf<T>>,
  ) => __Rewrap<C, AgentInputOf<T>, AgentOutputOf<T>>;
}
