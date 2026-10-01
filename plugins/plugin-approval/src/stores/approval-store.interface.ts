/**
 * Interface for managing tool approvals.
 *
 * @module @frontmcp/plugin-approval
 */

import type {
  ApprovalContext,
  ApprovalGrantor,
  ApprovalRecord,
  ApprovalRevoker,
  ApprovalScope,
  ApprovalSourceType,
  ApprovalState,
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
   * Get approval for a specific tool: the caller's record, a denial in any of its scopes first.
   * With `context`, context-specific records for that context count too.
   */
  getApproval(
    toolId: string,
    sessionId: string,
    userId?: string,
    context?: ApprovalContext,
  ): Promise<ApprovalRecord | undefined>;

  /**
   * Every unexpired record of a tool that applies to the caller (session, user, time-limited and,
   * with `context`, context-specific). The approval gate uses it to find an approval the tool's
   * policy accepts; stores without it are read through `getApproval()`.
   */
  getApprovals?(
    toolId: string,
    sessionId: string,
    userId?: string,
    context?: ApprovalContext,
  ): Promise<ApprovalRecord[]>;

  /**
   * Get all approvals matching a query.
   */
  queryApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]>;

  /**
   * Grant approval for a tool.
   */
  grantApproval(options: GrantApprovalOptions): Promise<ApprovalRecord>;

  /**
   * Revoke approval for a tool: every approval of the tool stored for the given session or user
   * (only the given context's, when `context` is set). Recorded denials are kept.
   */
  revokeApproval(options: RevokeApprovalOptions): Promise<boolean>;

  /**
   * Use up one approval: delete the stored record `record` (one `getApprovals()` returned for this
   * caller) and resolve `true` only for the call that deleted it, so two calls racing for one
   * approval cannot both get it. The approval gate uses it for `alwaysPrompt` tools, where each
   * approval admits a single call. Optional: for a store without it the gate revokes the caller's
   * approvals of the tool instead.
   */
  consumeApproval?(
    record: ApprovalRecord,
    sessionId: string,
    userId?: string,
    context?: ApprovalContext,
  ): Promise<boolean>;

  /**
   * The caller's recent revocations of a tool: each is the approval that was revoked, with `revokedBy`,
   * `revokedAt` and `revocationReason`. Optional: a store that keeps no revocations leaves it out.
   */
  getRevocations?(
    toolId: string,
    sessionId: string,
    userId?: string,
    context?: ApprovalContext,
  ): Promise<ApprovalRecord[]>;

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
