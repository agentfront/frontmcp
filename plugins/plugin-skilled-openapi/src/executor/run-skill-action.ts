import { SkillAuditWriterToken, type SkillAuditWriter } from '@frontmcp/adapters/skills';
import { type Token } from '@frontmcp/di';
import type { FrontMcpLogger } from '@frontmcp/sdk';

import { type OperationListings } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkilledOpenApiConfig } from '../skilled-openapi.symbols';
import { askingBeforeEachCall, type AskUser, type ConfirmAction } from './action-confirmation';
import { actionOutcome, type ActionOutcome } from './action-outcome';
import { credentialResolverOf, type CallerAuthInfo } from './credential-resolver';
import { executeSkillAction, type SkillActionDeps } from './execute-skill-action';

/** What a tool's context lends an action call: its providers, its name, the caller and the call's signal. */
export interface SkillActionContext {
  get<T>(token: Token<T>): T;
  tryGet<T>(token: Token<T>): T | undefined;
  metadata: { name: string };
  authInfo: CallerAuthInfo;
  signal?: AbortSignal;
}

/** What an operation tool answers: the outcome a script's `callTool(..., { throwOnError: false })` gets, and the answer's content type. */
export type OperationToolResult = ActionOutcome & { contentType?: string };

/** The shared executor's dependencies, resolved from a tool's context, with how the tool confirms an action. */
export function skillActionDepsOf(
  ctx: SkillActionContext,
  logger: FrontMcpLogger,
  confirmAction: ConfirmAction,
): SkillActionDeps {
  const config = ctx.get(SkilledOpenApiConfig);
  const resolver = credentialResolverOf(ctx);
  const auditWriter = ctx.tryGet<SkillAuditWriter>(SkillAuditWriterToken);
  return {
    config: { outbound: config.outbound, unprotectedOps: config.unprotectedOps, confirm: config.confirm },
    confirmAction,
    resolver: { resolve: (ref, opts) => resolver.resolve(ref, opts) },
    guard: ctx.get(AuthorityGuard),
    logger,
    ...(auditWriter ? { audit: { writer: auditWriter, subject: ctx.authInfo?.user?.sub ?? 'anonymous' } } : {}),
  };
}

/**
 * Run one action with the checks and audit records of a `run_workflow` call, and the error body `outbound.errorBodies`
 * allows. An action the `confirm` option names asks the user, through `askUser`, before its request.
 */
export async function runSkillAction(args: {
  ctx: SkillActionContext;
  logger: FrontMcpLogger;
  listings: OperationListings;
  input: Record<string, unknown>;
  askUser: AskUser;
}): Promise<OperationToolResult> {
  const { ctx, logger, listings, input, askUser } = args;
  const whenUnsupported = ctx.get(SkilledOpenApiConfig).confirm?.whenUnsupported ?? 'refuse';
  const deps = skillActionDepsOf(ctx, logger, askingBeforeEachCall(askUser, whenUnsupported));
  const result = await executeSkillAction({ listings, input, authInfo: ctx.authInfo, signal: ctx.signal, deps });
  const outcome = actionOutcome(result, deps.config.outbound.errorBodies, listings[0].authBinding);
  return result.contentType ? { ...outcome, contentType: result.contentType } : outcome;
}
