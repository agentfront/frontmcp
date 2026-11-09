/**
 * `mode: 'recheck'` with `recheck.url`: a call that needs an approval polls the approval system until it decides, or
 * `recheck.maxAttempts` polls go unanswered.
 *
 * @module @frontmcp/plugin-approval
 */

import { z } from '@frontmcp/lazy-zod';
import type { FrontMcpLogger } from '@frontmcp/sdk';

import { approvalGrantorSchema, approvalScopeSchema } from '../approval';
import type { ResolvedRecheck } from '../approval.options';
import {
  pendingRequestKey,
  type ApprovalDecisionRecorder,
  type ExternalApprovalOutcome,
  type ExternalApprover,
  type PendingApprovalCall,
} from './approval-decisions';
import { originOf, OutboundRequestError, postJson } from './outbound-request';
import { signatureHeaders } from './webhook-signature';

/** The body of each poll of `recheck.url`. */
export interface RecheckRequest {
  type: 'approval.status';
  /** The same for every poll and call of one caller to one tool. */
  requestId: string;
  attempt: number;
  toolId: string;
  toolName: string;
  category?: string;
  riskLevel?: string;
  approvalMessage?: string;
  requestedScope: string;
  allowedScopes?: string[];
  maxTtlMs?: number;
  userId?: string;
  timestamp: number;
}

const recheckAnswerSchema = z.object({
  approved: z.boolean(),
  pending: z.boolean().optional(),
  scope: approvalScopeSchema.optional(),
  ttlMs: z.number().positive().finite().optional(),
  grantedBy: approvalGrantorSchema.optional(),
  denialReason: z.string().max(1000).optional(),
});

type RecheckAnswer = z.infer<typeof recheckAnswerSchema>;

/** Waits `ms`, or less when the call is cancelled; reports whether it waited the whole time. */
function wait(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (completed: boolean) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      resolve(completed);
    };
    const cancelled = () => done(false);
    const timer = setTimeout(() => done(true), ms);
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

/** What the recheck writes to: the store decisions go to. */
export interface RecheckDependencies {
  readonly decisions: ApprovalDecisionRecorder;
}

export class RecheckApprover implements ExternalApprover {
  readonly via = 'recheck';

  constructor(
    private readonly recheck: ResolvedRecheck,
    private readonly dependencies: RecheckDependencies,
    private readonly logger: FrontMcpLogger,
  ) {}

  /**
   * Polls `recheck.url` every `recheck.interval`, at most `recheck.maxAttempts` times, while it answers
   * `{ approved: false, pending: true }`. An approval is recorded (and an `alwaysPrompt` tool's lets this call alone
   * through), `{ approved: false }` refuses the call as denied, and a failed poll stops and leaves it pending.
   */
  async requestApproval(call: PendingApprovalCall): Promise<ExternalApprovalOutcome> {
    for (let attempt = 1; attempt <= this.recheck.maxAttempts; attempt++) {
      if (attempt > 1 && !(await wait(this.recheck.intervalMs, call.signal))) return 'pending';

      let answer: RecheckAnswer | undefined;
      try {
        answer = await this.poll(call, attempt);
      } catch (error) {
        if (!(error instanceof OutboundRequestError)) throw error;
        this.logger.warn(
          `ApprovalPlugin: polling ${originOf(this.recheck.url)} for ${call.toolId} failed: ${error.message}`,
        );
        return 'pending';
      }
      if (!answer) return 'pending';
      if (answer.approved) return (await this.approve(call, answer)) ? 'approved' : 'pending';
      if (!answer.pending) return 'denied';
    }
    return 'pending';
  }

  private async approve(call: PendingApprovalCall, answer: RecheckAnswer): Promise<boolean> {
    // Each approval of an alwaysPrompt tool admits one call: this one.
    if (call.requirement.alwaysPrompt) return true;
    return this.dependencies.decisions.approve(
      call,
      { scope: answer.scope, ttlMs: answer.ttlMs, decidedBy: answer.grantedBy },
      'recheck',
    );
  }

  /** One poll; `undefined` when the call has no token to forward with `auth: 'jwt'`. */
  private async poll(call: PendingApprovalCall, attempt: number): Promise<RecheckAnswer | undefined> {
    const { requirement } = call;
    const request: RecheckRequest = {
      type: 'approval.status',
      requestId: pendingRequestKey(call),
      attempt,
      toolId: call.toolId,
      toolName: call.toolName,
      category: requirement.category,
      riskLevel: requirement.riskLevel,
      approvalMessage: requirement.approvalMessage,
      requestedScope: requirement.defaultScope ?? 'session',
      allowedScopes: requirement.allowedScopes,
      maxTtlMs: requirement.maxTtlMs,
      userId: call.userId,
      timestamp: Date.now(),
    };
    const authorization = await this.authorization(call, request);
    if (!authorization) return undefined;

    const body = JSON.stringify(request);
    const signing = this.recheck.signingKey ? signatureHeaders(this.recheck.signingKey, body) : {};
    const answer = await postJson({
      url: this.recheck.url,
      body,
      headers: { ...authorization, ...signing },
      signal: call.signal,
    });
    if (answer.status < 200 || answer.status >= 300) throw new OutboundRequestError(`answered ${answer.status}`);
    try {
      return recheckAnswerSchema.parse(JSON.parse(answer.body));
    } catch {
      throw new OutboundRequestError('answered with something other than { approved, pending?, scope?, ttlMs?, ... }');
    }
  }

  /** The headers `recheck.auth` adds, or `undefined` when the call has no token for `auth: 'jwt'`. */
  private async authorization(
    call: PendingApprovalCall,
    request: RecheckRequest,
  ): Promise<Record<string, string> | undefined> {
    switch (this.recheck.auth) {
      case 'jwt':
        if (!call.accessToken) {
          this.logger.verbose(`ApprovalPlugin: not polling for ${call.toolId}: the call has no token to forward`);
          return undefined;
        }
        return { authorization: `Bearer ${call.accessToken}` };
      case 'bearer':
        return { authorization: `Bearer ${this.recheck.token}` };
      case 'custom':
        return { ...(await this.recheck.headers?.(request)) };
      default:
        return {};
    }
  }
}
