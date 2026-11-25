import type { ReviewDecision, ReviewOptions } from '@enclave-vm/core/worker';

import { toMcpError, type FrontMcpLogger } from '@frontmcp/sdk';

import type { CodeCallBudget } from '../codecall.types';
import type { ReviewCallerContext } from '../review/create-run-review';
import type { CodeCallApprovalReference, ReviewApprovals } from '../review/review-approvals';
import { NO_APPROVAL_CHANNEL, type ApprovalCall } from '../review/review-rules';
import type { PendingApproval } from '../review/run-review';
import { isBlockedSelfReference } from '../security/self-reference-guard';
import type { CodeCallBudgetStore, ExceededBudget } from './budget-store';

export const BUDGET_EXCEEDED_RULE = 'budget-exceeded';
export const BUDGET_UNAVAILABLE_RULE = 'budget-unavailable';

/** The codes of a dispatch the tool flow refused before its tool ran: its input, an unknown tool, a rate or quota limit. */
const REFUSED_BEFORE_TOOL: ReadonlySet<string> = new Set([
  'INVALID_INPUT',
  'TOOL_NOT_FOUND',
  'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED',
  'CONCURRENCY_LIMIT',
  'QUEUE_TIMEOUT',
]);

const UNIT_BY_COUNT: Record<CodeCallBudget['counts'], string> = {
  toolCalls: 'tool calls',
  recordsChanged: 'records changed',
};

const SUGGESTION_BY_DECISION: Record<CodeCallBudget['onExceeded'], string> = {
  needs_approval: 'A person can approve this call; otherwise send it again once the window resets',
  denied: 'Send it again once the window resets',
};

/** A script can name any string as a tool; a finding shows at most this much of it. */
const MAX_TOOL_NAME_CHARS = 128;
const UNAVAILABLE_REASON = 'The budgets could not be checked, so the call did not run';
const REFUSED_BY_PERSON = 'a person refused to approve it';
const ALLOW: ReviewDecision = { decision: 'allow' };

/** Who budgets count for: the signed-in user or API key, else the verified session, else one shared anonymous bucket. */
export function budgetCallerOf(context: ReviewCallerContext): string {
  const { auth } = context;
  if (!auth.isAnonymous && auth.user.sub) return `subject:${auth.user.sub}`;
  const session = context.tryGetContext()?.verifiedSessionId;
  return session ? `session:${session}` : 'anonymous';
}

/** Whether a dispatch the tool flow failed reached its tool: any failure but a refusal of its input, its name or a limit. */
function reachedTool(error: unknown): boolean {
  if (error instanceof Error && error.name === 'ZodError') return false;
  const { code, statusCode } = toMcpError(error);
  return !REFUSED_BEFORE_TOOL.has(code) && statusCode !== 429;
}

function exceededDecision(
  { budget, resetsInSeconds }: ExceededBudget,
  toolName: string,
  deniedBecause?: string,
): ReviewDecision {
  const shownName = toolName.slice(0, MAX_TOOL_NAME_CHARS);
  const decision = deniedBecause ? 'denied' : budget.onExceeded;
  const reason =
    `Budget "${budget.name}" is used up: this caller reached ${budget.limit} ${UNIT_BY_COUNT[budget.counts]} ` +
    `in its ${budget.windowSeconds}-second window, which resets in ${resetsInSeconds} seconds, ` +
    `so the call to ${shownName} did not run${deniedBecause ? `; ${deniedBecause}` : ''}`;
  const suggestion = SUGGESTION_BY_DECISION[decision];
  return {
    decision,
    reason,
    findings: [{ rule: BUDGET_EXCEEDED_RULE, message: reason, suggestion, toolName: shownName }],
  };
}

function unavailableDecision(toolName: string): ReviewDecision {
  return {
    decision: 'denied',
    reason: UNAVAILABLE_REASON,
    findings: [
      {
        rule: BUDGET_UNAVAILABLE_RULE,
        message: UNAVAILABLE_REASON,
        suggestion: 'Send the script again later',
        toolName: toolName.slice(0, MAX_TOOL_NAME_CHARS),
      },
    ],
  };
}

/** One call's use of the budgets, counted when it ends. */
export interface BudgetedCall {
  /** The `onRecordsChanged` of the call's dispatch context: throws on a count that is not a non-negative integer. */
  onRecordsChanged(count: number): void;
  /** Counts the call once: as a tool call unless the flow refused it before its tool ran, and the records it reported. */
  end(dispatchError?: unknown): Promise<void>;
}

/** How a person approves a call over a budget, for one run. */
export interface BudgetApprovals {
  approvals: ReviewApprovals;
  /** Approval ids a person approved during this request; a budget's is spent by the one call it lets through. */
  grantedByPerson: Set<string>;
  /** Whether a person can approve: the Approval plugin is installed, or the client can answer an elicitation. */
  canApprove: boolean;
}

/** Spends an unspent grant for one call: false when another call spent it first. */
type GrantClaim = () => Promise<boolean>;

/** The budgets of one caller for one run: checked before each call, added to after each call that went out. */
export class BudgetMeter {
  /** The approval a `needs_approval` of this run refers to, with the call it covers. */
  pendingApproval?: PendingApproval;
  /** A count that could not be kept closes the rest of the run, since the stored counts are now short. */
  private countLost = false;

  constructor(
    private readonly store: CodeCallBudgetStore,
    private readonly caller: string,
    private readonly approval: BudgetApprovals,
    private readonly logger?: FrontMcpLogger,
  ) {}

  /** Allow, or the answer of a budget the caller reached unless a grant for this call over each one was spent on it. */
  async check(toolName: string, args: unknown): Promise<ReviewDecision> {
    if (isBlockedSelfReference(toolName)) return ALLOW;
    if (this.countLost) return unavailableDecision(toolName);
    try {
      return await this.decide(toolName, args);
    } catch (error: unknown) {
      this.warn('codecall: could not check the budgets', error);
      return unavailableDecision(toolName);
    }
  }

  startCall(): BudgetedCall {
    let recordsChanged = 0;
    let ended = false;
    return {
      onRecordsChanged: (count) => {
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new RangeError(`reportRecordsChanged needs a non-negative integer, not ${String(count)}`);
        }
        if (!ended) recordsChanged += count;
      },
      end: async (dispatchError) => {
        if (ended) return;
        ended = true;
        const toolCalls = dispatchError === undefined || reachedTool(dispatchError) ? 1 : 0;
        try {
          await this.store.add(this.caller, { toolCalls, recordsChanged });
        } catch (error: unknown) {
          this.countLost = true;
          this.warn('codecall: could not count a call against the budgets', error);
        }
      },
    };
  }

  private async decide(toolName: string, args: unknown): Promise<ReviewDecision> {
    const exceeded = await this.store.exceededOf(this.caller);
    if (exceeded.length === 0) return ALLOW;
    const denying = exceeded.find(({ budget }) => budget.onExceeded === 'denied');
    if (denying) return exceededDecision(denying, toolName);
    if (!this.approval.canApprove) return exceededDecision(exceeded[0], toolName, NO_APPROVAL_CHANNEL);
    const call = { toolName, args };
    const claims: Array<{ over: ExceededBudget; reference: CodeCallApprovalReference; claim: GrantClaim }> = [];
    for (const over of exceeded) {
      const reference = this.approval.approvals.budgetReferenceFor(call, over.budget.name);
      const claim = await this.unspentGrantOf(reference);
      if (claim === 'denied') return exceededDecision(over, toolName, REFUSED_BY_PERSON);
      if (!claim) return this.waitForApproval(over, reference, call);
      claims.push({ over, reference, claim });
    }
    for (const { over, reference, claim } of claims) {
      if (!(await claim())) return this.waitForApproval(over, reference, call);
    }
    return ALLOW;
  }

  private waitForApproval(
    over: ExceededBudget,
    reference: CodeCallApprovalReference,
    call: ApprovalCall,
  ): ReviewDecision {
    this.pendingApproval = { reference, call };
    return exceededDecision(over, call.toolName);
  }

  /** A claim on a grant of the reference no call spent yet, `denied` when a person refused it, else undefined. */
  private async unspentGrantOf(reference: CodeCallApprovalReference): Promise<GrantClaim | 'denied' | undefined> {
    const { approvals, grantedByPerson } = this.approval;
    if (grantedByPerson.has(reference.id)) return async () => grantedByPerson.delete(reference.id);
    const recorded = await approvals.recordedGrantsOf(reference);
    if (recorded === 'denied') return 'denied';
    for (const { grantKey, countsForSeconds } of recorded) {
      if (!(await this.store.isSpent(grantKey))) return () => this.store.claim(grantKey, countsForSeconds);
    }
    return undefined;
  }

  private warn(message: string, error: unknown): void {
    this.logger?.warn(message, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** The budgets of the caller a CodeCall tool serves, or undefined without `budgets`. */
export function budgetMeterOf(
  store: CodeCallBudgetStore | undefined,
  caller: ReviewCallerContext,
  approval: BudgetApprovals,
  logger?: FrontMcpLogger,
): BudgetMeter | undefined {
  return store && new BudgetMeter(store, budgetCallerOf(caller), approval, logger);
}

/** Enclave's review hooks with the budgets asked first at each call, whether or not `review` is on. */
export function withBudgets(
  hooks: ReviewOptions | undefined,
  budgets: BudgetMeter | undefined,
): ReviewOptions | undefined {
  if (!budgets) return hooks;
  const reviewPre = hooks?.pre;
  return {
    ...hooks,
    pre: async (input) => {
      if (input.phase === 'call') {
        const decision = await budgets.check(input.toolName, input.args);
        if (decision.decision !== 'allow') return decision;
      }
      return reviewPre ? reviewPre(input) : ALLOW;
    },
  };
}
