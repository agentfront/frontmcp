import type { ReviewContext, ReviewerTool } from '@enclave-vm/core/worker';

import type { ToolEntry } from '@frontmcp/sdk';

import { DEFAULT_APPROVAL_MAX_AGE_SECONDS } from '../codecall.types';
import type CodeCallConfig from '../providers/code-call.config';
import { argumentsHashOf, type RunJournal } from '../runs/run-journal';
import type { CodeCallJournalEntry } from '../runs/run-record.types';
import {
  checkCodeCallToolAccess,
  checkCodeCallToolPolicy,
  readCodeCallPolicyConfig,
  toCodeCallPolicyTool,
} from '../security';
import { toolsWithheldByAuthorities } from '../security/codecall-discovery-authorities';
import { ReviewApprovals, type ApprovalServiceView } from './review-approvals';
import { ReviewRules, type ReviewedTool } from './review-rules';
import type CodeCallReviewService from './review.service';
import { RunReview } from './run-review';

/** Who a run is reviewed for, and what they may reach. */
export interface RunReviewCaller {
  scope: { tools: { getTools(includeHidden: boolean): ToolEntry[] } };
  config: CodeCallConfig;
  authInfo: unknown;
  surface?: string;
  /** The script's own `allowedTools`, which only narrows. */
  allowedTools?: ReadonlySet<string>;
  /** `codecall:invoke`: the `directCalls` options apply too. */
  directCall?: boolean;
  /** The Approval plugin's `this.approval`, when the plugin is installed. */
  approvalService?: ApprovalServiceView;
  /** Whether the client can answer an elicitation that asks a person to approve. */
  canElicit: boolean;
  /** Approval ids a person approved during this request. */
  granted: ReadonlySet<string>;
  /** The journal of the run, whose calls that reached their tool are the run's effects so far. */
  journal?: RunJournal;
}

/** Whether a journal entry's tool call reached its tool: it succeeded, is still running, or the tool itself failed. */
function reachedTool(entry: CodeCallJournalEntry): boolean {
  return entry.kind === undefined && (entry.outcome !== 'failure' || entry.phase === 'execute');
}

/** The tool context a review runs for: the call it serves, and who made it. */
export interface ReviewCallerContext {
  tryGetContext(): { verifiedSessionId?: string } | undefined;
  auth: { isAnonymous: boolean; user: { sub?: string } };
}

/** What the review hooks receive as `context`: the verified session, the signed-in subject and the surface. */
export function reviewContextOf(caller: ReviewCallerContext, surface: string | undefined): ReviewContext {
  const session = caller.tryGetContext()?.verifiedSessionId ?? null;
  const subject = caller.auth.isAnonymous ? null : (caller.auth.user.sub ?? null);
  return { session, subject, surface: surface ?? null };
}

function approvalContextOf(authInfo: unknown): { type: string; identifier: string } | undefined {
  const context = (authInfo as { extra?: Record<string, unknown> } | undefined)?.extra?.['approvalContext'];
  const { type, identifier } = (context ?? {}) as { type?: unknown; identifier?: unknown };
  return typeof type === 'string' && typeof identifier === 'string' ? { type, identifier } : undefined;
}

/** The tools any script may call, as the server's reviewers read them: names and descriptions. */
function reviewerToolsOf(caller: RunReviewCaller): ReviewerTool[] {
  const policyConfig = readCodeCallPolicyConfig(caller.config);
  return caller.scope.tools
    .getTools(true)
    .filter(
      (tool) => checkCodeCallToolPolicy(toCodeCallPolicyTool(tool, undefined, caller.scope), policyConfig).allowed,
    )
    .map((tool) => ({ name: tool.name, description: tool.metadata.description ?? '' }));
}

/** The approvals people granted this caller for this script, which the review and the budgets read. */
export function approvalsOf(
  caller: Pick<RunReviewCaller, 'authInfo' | 'approvalService' | 'granted'>,
  scriptHash: string,
  service?: CodeCallReviewService,
): ReviewApprovals {
  return new ReviewApprovals({
    scriptHash,
    policyVersion: service?.policyVersion ?? '',
    maxAgeMs: (service?.options.approvalMaxAgeSeconds ?? DEFAULT_APPROVAL_MAX_AGE_SECONDS) * 1000,
    service: caller.approvalService,
    approvalContext: approvalContextOf(caller.authInfo),
    granted: caller.granted,
  });
}

/** Whether the tool a script names is marked read-only, so running it again repeats no effect. */
function isReadOnlyTool(caller: RunReviewCaller, name: string): boolean {
  const access = checkCodeCallToolAccess<ToolEntry>(caller.scope, caller.config, name, {
    surface: caller.surface,
    directCall: caller.directCall,
  });
  return access.allowed && access.entry.metadata.annotations?.readOnlyHint === true;
}

/** A call as the journal recorded it: its tool and its arguments. */
export interface JournaledCall {
  toolName: string;
  args: unknown;
}

/** The entries of the run so far, without the one unfinished entry of `call`, the call that is starting. */
function entriesBefore(journal: RunJournal | undefined, call?: JournaledCall): CodeCallJournalEntry[] {
  const entries = [...(journal?.entriesSoFar() ?? [])];
  if (!call) return entries;
  const argumentsHash = argumentsHashOf(call.args);
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.outcome !== 'unfinished' || entry.tool !== call.toolName || entry.argumentsHash !== argumentsHash)
      continue;
    entries.splice(index, 1);
    break;
  }
  return entries;
}

/**
 * The tools without `readOnlyHint` whose calls reached the tool in the run so far, in the order they first ran; given
 * the call that is starting, its own entry is left out.
 */
export function effectsSoFarOf(
  caller: RunReviewCaller,
  isReadOnly = (name: string) => isReadOnlyTool(caller, name),
): (starting?: JournaledCall) => string[] {
  return (starting) => {
    const ranTools = entriesBefore(caller.journal, starting)
      .filter(reachedTool)
      .map((entry) => entry.tool);
    return [...new Set(ranTools)].filter((name) => !isReadOnly(name));
  };
}

/** The review of one script for this caller: its rules, the server's reviewers and the approvals people granted. */
export async function createRunReview(
  service: CodeCallReviewService,
  caller: RunReviewCaller,
  scriptHash: string,
): Promise<RunReview> {
  const { options } = service;
  const withheld = await toolsWithheldByAuthorities(caller.scope, caller.authInfo);
  const toolOf = (name: string): ReviewedTool | undefined => {
    const access = checkCodeCallToolAccess<ToolEntry>(caller.scope, caller.config, name, {
      surface: caller.surface,
      directCall: caller.directCall,
    });
    if (!access.allowed || withheld.has(access.entry.fullName)) return undefined;
    if (caller.allowedTools && !caller.allowedTools.has(name)) return undefined;
    const { entry } = access;
    return { name: entry.name, annotations: entry.metadata.annotations, inputSchema: entry.getInputJsonSchema() };
  };
  const hasApprovalChannel = caller.approvalService !== undefined || caller.canElicit;
  const rules =
    options.rules === false ? undefined : new ReviewRules({ rules: options.rules, toolOf, hasApprovalChannel });
  const approvals = approvalsOf(caller, scriptHash, service);
  const effectsSoFar = effectsSoFarOf(caller, (name) => toolOf(name)?.annotations?.readOnlyHint === true);
  return new RunReview({
    rules,
    hasApprovalChannel,
    effectsSoFar,
    reviewers: async () => (service.hasReviewers ? service.reviewersFor(reviewerToolsOf(caller)) : []),
    approvals,
    timeoutMs: options.timeoutMs,
  });
}
