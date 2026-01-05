import { Provider, ProviderScope } from '@frontmcp/sdk';
import type { ApprovalStore, ApprovalQuery } from './approval-store.interface';
import type {
  ApprovalRecord,
  ApprovalScope,
  ApprovalContext,
  ApprovalGrantor,
  ApprovalRevoker,
  ApprovalSourceType,
  RevocationSourceType,
} from './approval.types';
import { ApprovalScope as ApprovalScopeEnum, ApprovalState } from './approval.types';

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
 *
 * Injected into tools/flows for querying and managing approval state.
 *
 * @example
 * ```typescript
 * class MyTool extends ToolContext {
 *   async execute(input) {
 *     const approvalService = this.get(ApprovalServiceToken);
 *
 *     // Check if another tool is approved
 *     const isApproved = await approvalService.isApproved('dangerous-tool');
 *
 *     // Grant session approval for related tool
 *     await approvalService.grantSessionApproval('helper-tool');
 *   }
 * }
 * ```
 */
@Provider({
  name: 'provider:remember:approval-service',
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
   *
   * @param toolId - Tool identifier
   * @param context - Optional approval context
   * @returns true if tool is approved
   */
  async isApproved(toolId: string, context?: ApprovalContext): Promise<boolean> {
    return this.store.isApproved(toolId, this.sessionId, this.userId, context);
  }

  /**
   * Get approval record for a tool.
   *
   * @param toolId - Tool identifier
   * @returns The approval record or undefined
   */
  async getApproval(toolId: string): Promise<ApprovalRecord | undefined> {
    return this.store.getApproval(toolId, this.sessionId, this.userId);
  }

  /**
   * Get all approvals for current session.
   *
   * @returns Array of session approval records
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
   *
   * @returns Array of user approval records
   */
  async getUserApprovals(): Promise<ApprovalRecord[]> {
    if (!this.userId) return [];
    return this.store.queryApprovals({
      userId: this.userId,
      scope: ApprovalScopeEnum.USER,
      states: [ApprovalState.APPROVED],
      includeExpired: false,
    });
  }

  /**
   * Query approvals with custom filters.
   *
   * @param query - Query filters
   * @returns Array of matching approval records
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
   * Approval is valid only for current session.
   *
   * @param toolId - Tool identifier
   * @param options - Grant options (grantedBy, reason, metadata)
   * @returns The created approval record
   *
   * @example
   * ```typescript
   * // Simple usage
   * await service.grantSessionApproval('my-tool');
   *
   * // With grantor info
   * await service.grantSessionApproval('my-tool', {
   *   grantedBy: { source: 'user', identifier: 'user-123' },
   *   reason: 'User approved in UI',
   * });
   * ```
   */
  async grantSessionApproval(toolId: string, options: GrantOptions = {}): Promise<ApprovalRecord> {
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScopeEnum.SESSION,
      sessionId: this.sessionId,
      grantedBy: options.grantedBy ?? 'policy',
      reason: options.reason,
      metadata: options.metadata,
    });
  }

  /**
   * Grant user-scoped approval for a tool.
   * Approval persists across sessions.
   *
   * @param toolId - Tool identifier
   * @param options - Grant options (grantedBy, reason, metadata)
   * @returns The created approval record
   * @throws Error if no userId is available
   */
  async grantUserApproval(toolId: string, options: GrantOptions = {}): Promise<ApprovalRecord> {
    if (!this.userId) {
      throw new Error('Cannot grant user approval without userId');
    }
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScopeEnum.USER,
      userId: this.userId,
      grantedBy: options.grantedBy ?? 'policy',
      reason: options.reason,
      metadata: options.metadata,
    });
  }

  /**
   * Grant time-limited approval for a tool.
   *
   * @param toolId - Tool identifier
   * @param ttlMs - Time-to-live in milliseconds
   * @param options - Grant options (grantedBy, reason, metadata)
   * @returns The created approval record
   */
  async grantTimeLimitedApproval(toolId: string, ttlMs: number, options: GrantOptions = {}): Promise<ApprovalRecord> {
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScopeEnum.TIME_LIMITED,
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
   *
   * @param toolId - Tool identifier
   * @param context - Approval context
   * @param options - Grant options (grantedBy, reason, metadata)
   * @returns The created approval record
   */
  async grantContextApproval(
    toolId: string,
    context: ApprovalContext,
    options: GrantOptions = {},
  ): Promise<ApprovalRecord> {
    return this.store.grantApproval({
      toolId,
      scope: ApprovalScopeEnum.CONTEXT_SPECIFIC,
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
   *
   * @param toolId - Tool identifier
   * @param options - Revoke options (revokedBy, reason)
   * @returns true if approval was revoked
   *
   * @example
   * ```typescript
   * // Simple usage
   * await service.revokeApproval('my-tool');
   *
   * // With revoker info
   * await service.revokeApproval('my-tool', {
   *   revokedBy: { source: 'admin', identifier: 'admin-456' },
   *   reason: 'Security policy update',
   * });
   * ```
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
   *
   * @returns Number of approvals cleared
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
