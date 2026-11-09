import { type Token } from '@frontmcp/di';
import { internalZ as z } from '@frontmcp/lazy-zod';

import { type ScopeEntry } from '../entries';
import { type HttpMethod, type ServerRequest } from '../interfaces';
import { type RawZodShape } from '../types';

declare module '@frontmcp/sdk' {
  export interface ExtendFlows {}
}

export type FlowName = keyof ExtendFlows;

export type CanActivateFlow = (request: ServerRequest, scope: ScopeEntry) => Promise<boolean>;

export interface FlowMiddlewareOptions {
  path?: RegExp | string; // string can be "/test/**" or "/test/*/asds", default to all paths
  method?: HttpMethod; // default to all methods
  canActivate?: CanActivateFlow[];
  /** Headers every response of the route carries: a stage's, a hook's or a guard's, and a failure's. */
  responseHeaders?: Readonly<Record<string, string>>;
}

export type FlowRunOptions<
  Ctx,
  Plan extends FlowPlan<string>,
  Input,
  Output extends z.ZodObject<any> | z.ZodUnion<any> | z.ZodDiscriminatedUnion<any, any>,
  State extends z.ZodObject<any>,
> = {
  ctx: Ctx;
  plan: Plan;
  input: Input;
  output: Output;
  state: State;
  stage: StagesFromPlan<Plan>;
  executeStage: ExecuteStagesFromPlan<Plan>;
};

/**
 * Declarative metadata describing what a FrontMcpFlow contributes at app scope.
 */
export interface FlowMetadata<Name extends FlowName> {
  name: Name;
  description?: string;
  plan: FlowPlan<ExtendFlows[Name]['stage']>;
  inputSchema: ExtendFlows[Name]['input'];
  outputSchema: ExtendFlows[Name]['output'];
  /**
   * Who the flow runs for, checked before its first stage.
   *
   * - `'authorized'`: a caller the server's auth admitted. Over HTTP, `session:verify` must accept the request: a flow
   *   that serves a request no flow has verified yet (one mounted with `middleware`, or one it runs) verifies it
   *   first, and refuses it with `UnauthorizedError` (401) or an `INSUFFICIENT_SCOPE` error (403), each with its
   *   `WWW-Authenticate` challenge. The anonymous callers of public mode and `allowAnonymous` are admitted. stdio,
   *   `connect()`, direct calls and the work the server starts itself (a scheduled job, a channel notification) are
   *   the server process's own callers. A flow run from another flow, a tool or a job is checked against the caller of
   *   the request it runs in.
   * - `'public'`: any caller that reaches it; the flow authorizes in its stages, if at all.
   *
   * A flow whose metadata lacks it at run time (JavaScript) is `'public'`.
   */
  access: 'public' | 'authorized';
  dependsOn?: Token[];
  middleware?: FlowMiddlewareOptions;
}

export type StepInfo = string | { title?: string; description?: string };
export type FlowPhase = 'pre' | 'execute' | 'post' | 'finalize' | 'error';
type Values<T> = T[keyof T];
type ArrayElem<T> = T extends ReadonlyArray<infer U> ? U : never;

export type StagesFromPlan<P extends FlowPlan<string>> = ArrayElem<Values<Required<P>>>;
export type ExecuteStagesFromPlan<P extends FlowPlan<string>> = ArrayElem<Required<P['execute']>>;

export type FlowPlan<Base extends string> = {
  steps?: Record<Base, StepInfo>;
} & Partial<Record<FlowPhase, Base[]>>;

export const frontMcpFlowMetadataSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    access: z.enum(['public', 'authorized']).optional().default('public'),
    inputSchema: z.instanceof(Object),
    outputSchema: z.instanceof(Object).optional(),
    plan: z.instanceof(Object),
    dependsOn: z.array(z.unknown()).optional(),
    middleware: z.instanceof(Object).optional(),
  } satisfies RawZodShape<FlowMetadata<never>>)
  .passthrough();
