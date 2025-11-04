import {z} from 'zod';
import {RawZodShape} from '../types';
import {HttpMethod, ServerRequest, Token} from '../interfaces';
import {ScopeEntry} from '../entries';

declare global {
  // eslint-disable-next-line
  export interface ExtendFlows {

  }
}

export type FlowName = keyof ExtendFlows;

export type CanActivateFlow = (request: ServerRequest, scope: ScopeEntry) => Promise<boolean>;

export interface FlowMiddlewareOptions {
  path?: RegExp | string; // string can be "/test/**" or "/test/*/asds", default to all paths
  method?: HttpMethod; // default to all methods
  canActivate?: CanActivateFlow[];
}

export type FlowRunOptions<Ctx, Plan extends FlowPlan<string>, Input, Output extends (z.ZodObject<any> | z.ZodUnion<any> | z.ZodDiscriminatedUnion<any, any>), State extends z.ZodObject<any>> = {
  ctx: Ctx;
  plan: Plan;
  input: Input;
  output: Output;
  state: State;
  stage: StagesFromPlan<Plan>;
}

/**
 * Declarative metadata describing what a FrontMcpFlow contributes at app scope.
 */
export interface FlowMetadata<Name extends FlowName> {
  name: Name;
  description?: string;
  plan: FlowPlan<ExtendFlows[Name]['stage']>;
  inputSchema: ExtendFlows[Name]['input'];
  outputSchema: ExtendFlows[Name]['output'];
  access: 'public' | 'authorized';
  dependsOn?: Token[];
  middleware?: FlowMiddlewareOptions;
}


export type StepInfo = string | { title?: string; description?: string; };
export type FlowPhase = 'pre' | 'execute' | 'post' | 'finalize' | 'error';
type Values<T> = T[keyof T];
type ArrayElem<T> = T extends ReadonlyArray<infer U> ? U : never;

export type StagesFromPlan<P extends FlowPlan<string>> = ArrayElem<Values<Required<P>>>;

export type FlowPlan<Base extends string> = {
  steps?: Record<Base, StepInfo>;
} & Partial<Record<FlowPhase, Base[]>>;


export const frontMcpFlowMetadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  access: z.enum(['public', 'authorized']).optional().default('public'),
  inputSchema: z.instanceof(Object),
  outputSchema: z.instanceof(Object).optional(),
  plan: z.instanceof(Object),
  dependsOn: z.array(z.any()).optional(),
  middleware: z.instanceof(Object).optional(),
} satisfies RawZodShape<FlowMetadata<never>>).passthrough();
