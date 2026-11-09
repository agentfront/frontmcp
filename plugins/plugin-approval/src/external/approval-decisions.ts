/**
 * What an external approval system's decision does: an approval recorded under the tool's policy, or a denial.
 *
 * @module @frontmcp/plugin-approval
 */

import type { FrontMcpLogger } from '@frontmcp/sdk';
import { sha256Hex } from '@frontmcp/utils';

import { ApprovalError } from '../approval';
import { checkGrantAgainstPolicy } from '../approval/policy';
import type { ApprovalRequirementLookup } from '../services/approval.service';
import type { ApprovalStore, GrantApprovalOptions } from '../stores/approval-store.interface';
import { ApprovalScope, type ApprovalContext, type ApprovalGrantor, type ToolApprovalRequirement } from '../types';

/** A call the gate refused for want of an approval, which an external system is asked about. */
export interface PendingApprovalCall {
  toolId: string;
  toolName: string;
  sessionId: string;
  userId?: string;
  context?: ApprovalContext;
  requirement: ToolApprovalRequirement;
  /** The caller's access token, sent only where an option asks for it. */
  accessToken?: string;
  signal?: AbortSignal;
}

/** What an external system decided for a call: run it, refuse it as denied, or refuse it as still pending. */
export type ExternalApprovalOutcome = 'approved' | 'denied' | 'pending';

/** Asks an external approval system about a call the gate would refuse. */
export interface ExternalApprover {
  /** How it asks, as the audit trail names it. */
  readonly via: 'webhook' | 'recheck';
  requestApproval(call: PendingApprovalCall): Promise<ExternalApprovalOutcome>;
}

/** Who an approval or denial is for. */
export interface DecisionSubject {
  toolId: string;
  sessionId: string;
  userId?: string;
  context?: ApprovalContext;
}

export interface ExternalDecision {
  scope?: ApprovalScope;
  ttlMs?: number;
  decidedBy?: ApprovalGrantor;
  reason?: string;
}

/** A request's id: the same for every call of one caller to one tool, and naming neither. */
export function pendingRequestKey(subject: Pick<DecisionSubject, 'toolId' | 'sessionId' | 'userId'>): string {
  return sha256Hex(JSON.stringify([subject.toolId, subject.sessionId, subject.userId ?? null]));
}

/** The session, user and context a grant of `scope` is stored for, as `this.approval` stores it. */
function grantTarget(scope: ApprovalScope, subject: DecisionSubject): Partial<GrantApprovalOptions> | undefined {
  const { sessionId, userId, context } = subject;
  switch (scope) {
    case ApprovalScope.SESSION:
      return { sessionId };
    case ApprovalScope.USER:
      return userId ? { userId } : undefined;
    case ApprovalScope.TIME_LIMITED:
      return { sessionId, userId };
    case ApprovalScope.CONTEXT_SPECIFIC:
      return context ? { context, sessionId, userId } : undefined;
    default:
      return undefined;
  }
}

/** Records external decisions in the plugin's store. */
export class ApprovalDecisionRecorder {
  constructor(
    private readonly store: ApprovalStore,
    private readonly requirementOf: ApprovalRequirementLookup,
    private readonly logger: FrontMcpLogger,
  ) {}

  /**
   * Records an approval, held to the tool's `allowedScopes` and `maxTtlMs` like one granted through `this.approval`.
   * Returns `false`, and records nothing, for one the policy refuses or that can't be stored for this caller (a
   * `user` approval for a caller with no user).
   */
  async approve(subject: DecisionSubject, decision: ExternalDecision, origin: string): Promise<boolean> {
    const requirement = this.requirementOf(subject.toolId);
    const scope = decision.scope ?? requirement?.defaultScope ?? ApprovalScope.SESSION;
    const target = grantTarget(scope, subject);
    if (!target) {
      this.logger.warn(
        `ApprovalPlugin: the ${origin} approval of ${subject.toolId} was not recorded: no ${scope} to grant it to`,
      );
      return false;
    }
    try {
      const ttlMs = checkGrantAgainstPolicy(subject.toolId, scope, decision.ttlMs, requirement);
      await this.store.grantApproval({
        toolId: subject.toolId,
        scope,
        ttlMs,
        ...target,
        grantedBy: { ...(decision.decidedBy ?? { source: 'api', method: 'api' }), origin },
        reason: decision.reason,
      });
      return true;
    } catch (error) {
      if (!(error instanceof ApprovalError)) throw error;
      this.logger.warn(
        `ApprovalPlugin: the ${origin} approval of ${subject.toolId} was not recorded: ${error.message}`,
      );
      return false;
    }
  }

  /** Records a denial of the tool for the caller's session, lasting `ttlMs`. */
  async deny(subject: DecisionSubject, decision: ExternalDecision, ttlMs: number, origin: string): Promise<void> {
    if (!this.store.denyApproval) {
      this.logger.warn(
        `ApprovalPlugin: the ${origin} denial of ${subject.toolId} was not recorded: the store keeps no denials`,
      );
      return;
    }
    await this.store.denyApproval({
      toolId: subject.toolId,
      scope: ApprovalScope.SESSION,
      ttlMs,
      sessionId: subject.sessionId,
      userId: subject.userId,
      grantedBy: { ...(decision.decidedBy ?? { source: 'api', method: 'api' }), origin },
      reason: decision.reason,
    });
  }
}
