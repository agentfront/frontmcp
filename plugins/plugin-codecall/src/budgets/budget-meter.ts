import type { ReviewDecision, ReviewOptions } from '@enclave-vm/core/worker';

import { PublicMcpError, type FrontMcpLogger } from '@frontmcp/sdk';

import type { CodeCallBudget } from '../codecall.types';
import type { ReviewCallerContext } from '../review/create-run-review';
import type { CodeCallApprovalReference, ReviewApprovals } from '../review/review-approvals';
import { NO_APPROVAL_CHANNEL } from '../review/review-rules';
import type { PendingApproval } from '../review/run-review';
import { isBlockedSelfReference } from '../security/self-reference-guard';
import type { CodeCallBudgetStore, ExceededBudget } from './budget-store';

export const BUDGET_EXCEEDED_RULE = 'budget-exceeded';
export const BUDGET_UNAVAILABLE_RULE = 'budget-unavailable';

/** The code of a call stopped as it entered its tool, which a script sees as `RATE_LIMITED`. */
const STOPPED_AT_DISPATCH_CODE = 'RATE_LIMIT_EXCEEDED';

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
const UNAVAILABLE_REASON =
  'The budgets could not be checked, so the call did not run; a window reset does not fix this';
const REFUSED_BY_PERSON = 'a person refused to approve it';

/** What budgets answer: they never ask for changes. */
export type BudgetDecision = Extract<ReviewDecision, { decision: 'allow' | 'needs_approval' | 'denied' }>;

const ALLOW: BudgetDecision = { decision: 'allow' };

/** A call as the budgets see it: its tool, its arguments and its place in the run. */
export interface BudgetCall {
  toolName: string;
  args: unknown;
  callIndex?: number;
}

/** The budgets' answer for a call, with the approval a `needs_approval` waits for. */
export interface BudgetVerdict {
  decision: BudgetDecision;
  pending?: PendingApproval;
}

/** Who budgets count for: the signed-in user or API key, else the verified session, else one shared anonymous bucket. */
export function budgetCallerOf(context: ReviewCallerContext): string {
  const { auth } = context;
  if (!auth.isAnonymous && auth.user.sub) return `subject:${auth.user.sub}`;
  const session = context.tryGetContext()?.verifiedSessionId;
  return session ? `session:${session}` : 'anonymous';
}

function exceededDecision(
  { budget, resetsInSeconds }: ExceededBudget,
  toolName: string,
  deniedBecause?: string,
): BudgetDecision {
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

function unavailableDecision(toolName: string): BudgetDecision {
  return {
    decision: 'denied',
    reason: UNAVAILABLE_REASON,
    findings: [
      {
        rule: BUDGET_UNAVAILABLE_RULE,
        message: UNAVAILABLE_REASON,
        suggestion: 'Send the script again once the budget store answers',
        toolName: toolName.slice(0, MAX_TOOL_NAME_CHARS),
      },
    ],
  };
}

/** How a person approves a call over a budget, for one run. */
export interface BudgetApprovals {
  approvals: ReviewApprovals;
  /** Approval ids a person approved during this request; a budget's is spent by the one call it lets through. */
  grantedByPerson: Set<string>;
  /** Whether a person can approve: the Approval plugin is installed, or the client can answer an elicitation. */
  canApprove: boolean;
}

/** Gives a spent grant back. */
type Release = () => Promise<void>;
/** Spends an unspent grant for one call: its release, or undefined when another call spent it first. */
type GrantClaim = () => Promise<Release | undefined>;

/** One call's use of the budgets: admitted as it enters its tool, and its records counted when it ends. */
export interface BudgetedCall {
  /** The members of the call's dispatch context the tool flow calls. */
  readonly dispatch: {
    /** Throws on a count that is not a non-negative integer, which fails the tool's call. */
    onRecordsChanged(count: number): void;
    /** As execute() starts: checks again, spends the grants the call needs and counts it, or throws to stop it. */
    beforeExecute(): Promise<void>;
  };
  /** The budgets' answer when they stopped the call as it entered its tool. */
  refusal?: BudgetVerdict;
  /** Counts the records the call reported, once. */
  end(): Promise<void>;
}

/** The budgets of one caller for one run: looked at before each call, spent and counted as it enters its tool. */
export class BudgetMeter {
  /** A count that could not be kept closes the rest of the run, since the stored counts are now short. */
  private countLost = false;
  private readonly pendingByCallIndex = new Map<number | undefined, PendingApproval>();

  constructor(
    private readonly store: CodeCallBudgetStore,
    private readonly caller: string,
    private readonly approval: BudgetApprovals,
    private readonly logger?: FrontMcpLogger,
  ) {}

  /** The approvals this run's calls wait for. */
  get pendingApprovals(): Iterable<PendingApproval> {
    return this.pendingByCallIndex.values();
  }

  /** The approval the call at `callIndex` waits for, when the budgets stopped it. */
  pendingApprovalAt(callIndex: number | undefined): PendingApproval | undefined {
    return this.pendingByCallIndex.get(callIndex);
  }

  /** Early, to stop fast: allow, or a budget's answer when the call has no unspent grant over it. Spends nothing. */
  async check(call: BudgetCall): Promise<BudgetVerdict> {
    if (isBlockedSelfReference(call.toolName)) return { decision: ALLOW };
    if (this.countLost) return { decision: unavailableDecision(call.toolName) };
    try {
      return await this.decide(call, false);
    } catch (error: unknown) {
      this.warn('codecall: could not check the budgets', error);
      return { decision: unavailableDecision(call.toolName) };
    }
  }

  startCall(call: BudgetCall): BudgetedCall {
    let recordsChanged = 0;
    let ended = false;
    const budgetedCall: BudgetedCall = {
      dispatch: {
        onRecordsChanged: (count) => {
          if (!Number.isSafeInteger(count) || count < 0) {
            throw new RangeError(`reportRecordsChanged needs a non-negative integer, not ${String(count)}`);
          }
          if (!ended) recordsChanged += count;
        },
        beforeExecute: async () => {
          const verdict = await this.admit(call);
          const { decision } = verdict;
          if (decision.decision === 'allow') return;
          budgetedCall.refusal = verdict;
          throw new PublicMcpError(decision.reason, STOPPED_AT_DISPATCH_CODE);
        },
      },
      end: async () => {
        if (ended) return;
        ended = true;
        if (recordsChanged > 0) await this.count({ toolCalls: 0, recordsChanged });
      },
    };
    return budgetedCall;
  }

  /** As the call enters its tool: the budgets' answer now, with its grants spent and the call counted when allowed. */
  private async admit(call: BudgetCall): Promise<BudgetVerdict> {
    if (this.countLost) return { decision: unavailableDecision(call.toolName) };
    try {
      const verdict = await this.decide(call, true);
      if (verdict.decision.decision === 'allow') await this.store.add(this.caller, { toolCalls: 1, recordsChanged: 0 });
      return verdict;
    } catch (error: unknown) {
      this.countLost = true;
      this.warn('codecall: could not admit a call against the budgets', error);
      return { decision: unavailableDecision(call.toolName) };
    }
  }

  private async decide(call: BudgetCall, spend: boolean): Promise<BudgetVerdict> {
    this.pendingByCallIndex.delete(call.callIndex);
    const exceeded = await this.store.exceededOf(this.caller);
    if (exceeded.length === 0) return { decision: ALLOW };
    const denying = exceeded.find(({ budget }) => budget.onExceeded === 'denied');
    if (denying) return { decision: exceededDecision(denying, call.toolName) };
    if (!this.approval.canApprove) {
      return { decision: exceededDecision(exceeded[0], call.toolName, NO_APPROVAL_CHANNEL) };
    }
    const grants: Array<{ over: ExceededBudget; reference: CodeCallApprovalReference; claim: GrantClaim }> = [];
    for (const over of exceeded) {
      const reference = this.approval.approvals.budgetReferenceFor(call, over.budget.name);
      const claim = await this.unspentGrantOf(reference);
      if (claim === 'denied') return { decision: exceededDecision(over, call.toolName, REFUSED_BY_PERSON) };
      if (!claim) return this.waitForApproval(over, reference, call);
      grants.push({ over, reference, claim });
    }
    if (spend) {
      const releases: Release[] = [];
      for (const { over, reference, claim } of grants) {
        const release = await claim();
        if (!release) {
          await Promise.all(releases.map((giveBack) => giveBack()));
          return this.waitForApproval(over, reference, call);
        }
        releases.push(release);
      }
    }
    return { decision: ALLOW };
  }

  private waitForApproval(over: ExceededBudget, reference: CodeCallApprovalReference, call: BudgetCall): BudgetVerdict {
    const pending = { reference, call: { toolName: call.toolName, args: call.args } };
    this.pendingByCallIndex.set(call.callIndex, pending);
    return { decision: exceededDecision(over, call.toolName), pending };
  }

  /** A claim on a grant of the reference no call spent yet, `denied` when a person refused it, else undefined. */
  private async unspentGrantOf(reference: CodeCallApprovalReference): Promise<GrantClaim | 'denied' | undefined> {
    const { approvals, grantedByPerson } = this.approval;
    if (grantedByPerson.has(reference.id)) {
      return async () => {
        if (!grantedByPerson.delete(reference.id)) return undefined;
        return async () => void grantedByPerson.add(reference.id);
      };
    }
    const recorded = await approvals.recordedGrantsOf(reference);
    if (recorded === 'denied') return 'denied';
    for (const { grantKey, countsUntil } of recorded) {
      if (await this.store.isSpent(grantKey)) continue;
      return async () => {
        const claimant = await this.store.claim(grantKey, countsUntil);
        return claimant === undefined ? undefined : () => this.store.release(grantKey, claimant);
      };
    }
    return undefined;
  }

  private async count(usage: { toolCalls: number; recordsChanged: number }): Promise<void> {
    try {
      await this.store.add(this.caller, usage);
    } catch (error: unknown) {
      this.countLost = true;
      this.warn('codecall: could not count a call against the budgets', error);
    }
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

/** Enclave's review hooks with the budgets looked at first at each call, whether or not `review` is on. */
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
        const { toolName, args, callIndex } = input;
        const { decision } = await budgets.check({ toolName, args, callIndex });
        if (decision.decision !== 'allow') return decision;
      }
      return reviewPre ? reviewPre(input) : ALLOW;
    },
  };
}
