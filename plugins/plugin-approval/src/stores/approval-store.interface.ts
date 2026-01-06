/**
 * Interface for managing tool approvals.
 *
 * @module @frontmcp/plugin-approval
 */

import type {
  ApprovalScope,
  ApprovalState,
  ApprovalContext,
  ApprovalGrantor,
  ApprovalRevoker,
  ApprovalRecord,
  ApprovalSourceType,
  RevocationSourceType,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Query Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query options for finding approvals.
 */
export interface ApprovalQuery {
  /** Filter by tool ID */
  toolId?: string;

  /** Filter by multiple tool IDs */
  toolIds?: string[];

  /** Filter by scope */
  scope?: ApprovalScope;

  /** Filter by multiple scopes */
  scopes?: ApprovalScope[];

  /** Filter by state */
  state?: ApprovalState;

  /** Filter by multiple states */
  states?: ApprovalState[];

  /** Filter by session ID */
  sessionId?: string;

  /** Filter by user ID */
  userId?: string;

  /** Filter by context */
  context?: ApprovalContext;

  /** Include expired approvals (default: false) */
  includeExpired?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grant/Revoke Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for granting approval.
 */
export interface GrantApprovalOptions {
  /** Tool identifier */
  toolId: string;

  /** Approval scope */
  scope: ApprovalScope;

  /** Time-to-live in milliseconds (for time-limited approvals) */
  ttlMs?: number;

  /** Session ID (required for session-scoped) */
  sessionId?: string;

  /** User ID (required for user-scoped) */
  userId?: string;

  /** Context (required for context-specific) */
  context?: ApprovalContext;

  /** Who/what granted the approval */
  grantedBy?: ApprovalGrantor | ApprovalSourceType;

  /** Optional reason for the approval */
  reason?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for revoking approval.
 */
export interface RevokeApprovalOptions {
  /** Tool identifier */
  toolId: string;

  /** Session ID (for session-scoped approvals) */
  sessionId?: string;

  /** User ID (for user-scoped approvals) */
  userId?: string;

  /** Context (for context-specific approvals) */
  context?: ApprovalContext;

  /** Who/what revoked the approval */
  revokedBy?: ApprovalRevoker | RevocationSourceType;

  /** Optional reason for revocation */
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval Store Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface for managing tool approvals.
 */
export interface ApprovalStore {
  /**
   * Initialize the store.
   */
  initialize(): Promise<void>;

  /**
   * Get approval for a specific tool.
   */
  getApproval(toolId: string, sessionId: string, userId?: string): Promise<ApprovalRecord | undefined>;

  /**
   * Get all approvals matching a query.
   */
  queryApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]>;

  /**
   * Grant approval for a tool.
   */
  grantApproval(options: GrantApprovalOptions): Promise<ApprovalRecord>;

  /**
   * Revoke approval for a tool.
   */
  revokeApproval(options: RevokeApprovalOptions): Promise<boolean>;

  /**
   * Check if a tool is approved.
   */
  isApproved(toolId: string, sessionId: string, userId?: string, context?: ApprovalContext): Promise<boolean>;

  /**
   * Clear all session approvals.
   */
  clearSessionApprovals(sessionId: string): Promise<number>;

  /**
   * Clear expired approvals.
   */
  clearExpiredApprovals(): Promise<number>;

  /**
   * Get approval statistics.
   */
  getStats(): Promise<{
    totalApprovals: number;
    byScope: Record<ApprovalScope, number>;
    byState: Record<ApprovalState, number>;
  }>;

  /**
   * Close the store and cleanup.
   */
  close(): Promise<void>;
}
