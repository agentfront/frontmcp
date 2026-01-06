/**
 * Service for programmatically managing tool approvals.
 *
 * @module @frontmcp/plugin-approval
 */

import { Provider, ProviderScope } from '@frontmcp/sdk';
import type { ApprovalStore, ApprovalQuery } from '../stores/approval-store.interface';
import type {
  ApprovalRecord,
  ApprovalContext,
  ApprovalGrantor,
  ApprovalRevoker,
  ApprovalSourceType,
  RevocationSourceType,
} from '../types';
import { ApprovalScope, ApprovalState } from '../types';

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
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if a tool is approved for current session/user.
   */
  async isApproved(toolId: string, context?: ApprovalContext): Promise<boolean> {
    return this.store.isApproved(toolId, this.sessionId, this.userId, context);
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
   * Query approvals with custom filters.
   */
  async queryApprovals(query: Partial<ApprovalQuery>): Promise<ApprovalRecord[]> {
    return this.store.queryApprovals({
      ...query,
      sessionId: query.sessionId ?? this.sessionId,
      userId: query.userId ?? this.userId,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Grant Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Grant session-scoped approval for a tool.
   */
  async grantSessionApproval(toolId: string, options: GrantOptions = {}): Promise<ApprovalRecord> {
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScope.SESSION,
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
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScope.USER,
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
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScope.CONTEXT_SPECIFIC,
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
   * Revoke approval for a tool.
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
export function createApprovalService(store: ApprovalStore, sessionId: string, userId?: string): ApprovalService {
  return new ApprovalService(store, sessionId, userId);
}
