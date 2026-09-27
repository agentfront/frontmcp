/**
 * Service for programmatically managing tool approvals.
 *
 * @module @frontmcp/plugin-approval
 */

import { Provider, ProviderScope } from '@frontmcp/sdk';

import { checkGrantAgainstPolicy, isApprovalUsable } from '../approval/policy';
import type { ApprovalQuery, ApprovalStore } from '../stores/approval-store.interface';
import {
  ApprovalScope,
  ApprovalState,
  type ApprovalContext,
  type ApprovalGrantor,
  type ApprovalRecord,
  type ApprovalRevoker,
  type ApprovalSourceType,
  type RevocationSourceType,
  type ToolApprovalRequirement,
} from '../types';

/**
 * Looks up the approval policy (`approval` metadata, normalized) of the tool with this full name,
 * or `undefined` when no such tool is registered.
 */
export type ApprovalRequirementLookup = (toolId: string) => ToolApprovalRequirement | undefined;

/**
 * Options for granting approvals via the service.
 */
export interface GrantOptions {
  /** Who/what is granting the approval (defaults to 'policy') */
  grantedBy?: ApprovalGrantor | ApprovalSourceType;
  /** Optional reason for the approval */
  reason?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for revoking approvals via the service.
 */
export interface RevokeOptions {
  /** Who/what is revoking the approval (defaults to 'policy') */
  revokedBy?: ApprovalRevoker | RevocationSourceType;
  /** Optional reason for revocation */
  reason?: string;
}

/**
 * Service for programmatically managing tool approvals.
 */
@Provider({
  name: 'provider:approval:service',
  description: 'Service for managing tool approvals',
  scope: ProviderScope.CONTEXT,
})
export class ApprovalService {
  constructor(
    private readonly store: ApprovalStore,
    private readonly sessionId: string,
    private readonly userId?: string,
    private readonly requirementOf: ApprovalRequirementLookup = () => undefined,
  ) {}

  /** Checks a grant against the tool's `allowedScopes` and `maxTtlMs`; returns the ttl to store. */
  private checkGrant(toolId: string, scope: ApprovalScope, ttlMs?: number): number | undefined {
    return checkGrantAgainstPolicy(toolId, scope, ttlMs, this.requirementOf(toolId));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if a tool is approved for current session/user.
   */
  async isApproved(toolId: string, context?: ApprovalContext): Promise<boolean> {
    const requirement = this.requirementOf(toolId);
    if (!requirement || !this.store.getApprovals) {
      return this.store.isApproved(toolId, this.sessionId, this.userId, context);
    }
    // The same answer the approval gate gives: no denial, and an approval the tool's policy accepts.
    const records = await this.store.getApprovals(toolId, this.sessionId, this.userId, context);
    if (records.some((record) => record.state === ApprovalState.DENIED)) return false;
    const now = Date.now();
    return records.some((record) => isApprovalUsable(record, requirement, now));
  }

  /**
   * Get approval record for a tool.
   */
  async getApproval(toolId: string): Promise<ApprovalRecord | undefined> {
    return this.store.getApproval(toolId, this.sessionId, this.userId);
  }

  /**
   * Get all approvals for current session.
   */
  async getSessionApprovals(): Promise<ApprovalRecord[]> {
    return this.store.queryApprovals({
      sessionId: this.sessionId,
      states: [ApprovalState.APPROVED],
      includeExpired: false,
    });
  }

  /**
   * Get all approvals for current user (across sessions).
   */
  async getUserApprovals(): Promise<ApprovalRecord[]> {
    if (!this.userId) return [];
    return this.store.queryApprovals({
      userId: this.userId,
      scope: ApprovalScope.USER,
      states: [ApprovalState.APPROVED],
      includeExpired: false,
    });
  }

  /**
   * Query the current caller's approvals (those of its session and those of its user) with custom
   * filters. A `sessionId` or `userId` in the query narrows the result further; it never reaches
   * another caller's records. Read the store directly for administrative queries.
   */
  async queryApprovals(query: Partial<ApprovalQuery>): Promise<ApprovalRecord[]> {
    const records = await this.store.queryApprovals(query);
    return records.filter(
      (record) => record.sessionId === this.sessionId || (this.userId !== undefined && record.userId === this.userId),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Grant Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Grant session-scoped approval for a tool.
   */
  async grantSessionApproval(toolId: string, options: GrantOptions = {}): Promise<ApprovalRecord> {
    const ttlMs = this.checkGrant(toolId, ApprovalScope.SESSION);
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScope.SESSION,
      ttlMs,
      sessionId: this.sessionId,
      grantedBy: options.grantedBy ?? 'policy',
      reason: options.reason,
      metadata: options.metadata,
    });
  }

  /**
   * Grant user-scoped approval for a tool.
   */
  async grantUserApproval(toolId: string, options: GrantOptions = {}): Promise<ApprovalRecord> {
    if (!this.userId) {
      throw new Error('Cannot grant user approval without userId');
    }
    const ttlMs = this.checkGrant(toolId, ApprovalScope.USER);
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScope.USER,
      ttlMs,
      userId: this.userId,
      grantedBy: options.grantedBy ?? 'policy',
      reason: options.reason,
      metadata: options.metadata,
    });
  }

  /**
   * Grant time-limited approval for a tool.
   */
  async grantTimeLimitedApproval(toolId: string, ttlMs: number, options: GrantOptions = {}): Promise<ApprovalRecord> {
    this.checkGrant(toolId, ApprovalScope.TIME_LIMITED, ttlMs);
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScope.TIME_LIMITED,
      ttlMs,
      sessionId: this.sessionId,
      userId: this.userId,
      grantedBy: options.grantedBy ?? 'policy',
      reason: options.reason,
      metadata: options.metadata,
    });
  }

  /**
   * Grant context-specific approval for a tool.
   */
  async grantContextApproval(
    toolId: string,
    context: ApprovalContext,
    options: GrantOptions = {},
  ): Promise<ApprovalRecord> {
    const ttlMs = this.checkGrant(toolId, ApprovalScope.CONTEXT_SPECIFIC);
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScope.CONTEXT_SPECIFIC,
      ttlMs,
      context,
      sessionId: this.sessionId,
      userId: this.userId,
      grantedBy: options.grantedBy ?? 'policy',
      reason: options.reason,
      metadata: options.metadata,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Revoke Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Revoke the caller's approvals of a tool: its session, user, time-limited and context
   * approvals. Returns whether anything was revoked. Recorded denials are kept.
   */
  async revokeApproval(toolId: string, options: RevokeOptions = {}): Promise<boolean> {
    return this.store.revokeApproval({
      toolId,
      sessionId: this.sessionId,
      userId: this.userId,
      revokedBy: options.revokedBy ?? 'policy',
      reason: options.reason,
    });
  }

  /**
   * Clear all session approvals.
   */
  async clearSessionApprovals(): Promise<number> {
    return this.store.clearSessionApprovals(this.sessionId);
  }
}

/**
 * Factory function for creating ApprovalService instances.
 */
export function createApprovalService(
  store: ApprovalStore,
  sessionId: string,
  userId?: string,
  requirementOf?: ApprovalRequirementLookup,
): ApprovalService {
  return new ApprovalService(store, sessionId, userId, requirementOf);
}
