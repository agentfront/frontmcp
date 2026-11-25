import type { ReviewDecision, ReviewOptions } from '@enclave-vm/core/worker';

import { toMcpError, type FrontMcpLogger } from '@frontmcp/sdk';

import type { CodeCallBudget } from '../codecall.types';
import type { ReviewCallerContext } from '../review/create-run-review';
import type { ReviewApprovals } from '../review/review-approvals';
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
const UNAVAILABLE_REASON = 'The budget store failed, so the call did not run';
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
  refusedByPerson = false,
): ReviewDecision {
  const shownName = toolName.slice(0, MAX_TOOL_NAME_CHARS);
  const decision = refusedByPerson ? 'denied' : budget.onExceeded;
  const reason =
    `Budget "${budget.name}" is used up: this caller reached ${budget.limit} ${UNIT_BY_COUNT[budget.counts]} ` +
    `in its ${budget.windowSeconds}-second window, which resets in ${resetsInSeconds} seconds, ` +
    `so the call to ${shownName} did not run${refusedByPerson ? '; a person refused to approve it' : ''}`;
  return {
    decision,
    reason,
    findings: [
      {
        rule: BUDGET_EXCEEDED_RULE,
        message: reason,
        suggestion: SUGGESTION_BY_DECISION[decision],
        toolName: shownName,
      },
    ],
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
  /** The `onRecordsChanged` of the call's dispatch context; reports after the call ended are not counted. */
  onRecordsChanged(count: number): void;
  /** Counts the call once: as a tool call unless the flow refused it before its tool ran, and the records it reported. */
  end(dispatchError?: unknown): Promise<void>;
}

/** The budgets of one caller for one run: checked before each call, added to after each call that went out. */
export class BudgetMeter {
  /** The approval a `needs_approval` of this run refers to, with the call it covers. */
  pendingApproval?: PendingApproval;
  /** A count that could not be kept closes the rest of the run, since the stored counts are now short. */
  private countLost = false;
  /** An approval covers one call of a run: the approvals calls of this run already used. */
  private readonly usedApprovals = new Set<string>();

  constructor(
    private readonly store: CodeCallBudgetStore,
    private readonly caller: string,
    private readonly approvals: ReviewApprovals,
    private readonly logger?: FrontMcpLogger,
  ) {}

  /** Allow, or the answer of a budget the caller reached, unless a person approved this call over each one. */
  async check(toolName: string, args: unknown): Promise<ReviewDecision> {
    if (isBlockedSelfReference(toolName)) return ALLOW;
    if (this.countLost) return unavailableDecision(toolName);
    let exceeded: ExceededBudget[];
    try {
      exceeded = await this.store.exceededOf(this.caller);
    } catch (error: unknown) {
      this.warn('codecall: could not read the budget counts', error);
      return unavailableDecision(toolName);
    }
    const denying = exceeded.find(({ budget }) => budget.onExceeded === 'denied');
    if (denying) return exceededDecision(denying, toolName);
    const call = { toolName, args };
    const approvedIds: string[] = [];
    for (const over of exceeded) {
      const reference = this.approvals.budgetReferenceFor(call, over.budget.name);
      const state = this.usedApprovals.has(reference.id) ? 'missing' : await this.approvals.stateOf(reference, false);
      if (state === 'denied') return exceededDecision(over, toolName, true);
      if (state !== 'approved') {
        this.pendingApproval = { reference, call };
        return exceededDecision(over, toolName);
      }
      approvedIds.push(reference.id);
    }
    for (const id of approvedIds) this.usedApprovals.add(id);
    return ALLOW;
  }

  startCall(): BudgetedCall {
    let recordsChanged = 0;
    let ended = false;
    return {
      onRecordsChanged: (count) => {
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

  private warn(message: string, error: unknown): void {
    this.logger?.warn(message, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** The budgets of the caller a CodeCall tool serves, or undefined without `budgets`. */
export function budgetMeterOf(
  store: CodeCallBudgetStore | undefined,
  caller: ReviewCallerContext,
  approvals: ReviewApprovals,
  logger?: FrontMcpLogger,
): BudgetMeter | undefined {
  return store && new BudgetMeter(store, budgetCallerOf(caller), approvals, logger);
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
