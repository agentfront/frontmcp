import type {
  ApprovalRecord,
  ApprovalScope,
  ApprovalState,
  ApprovalContext,
  ApprovalGrantor,
  ApprovalRevoker,
  ApprovalSourceType,
  RevocationSourceType,
} from './approval.types';

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

  /**
   * Who/what granted the approval.
   *
   * Accepts either:
   * - Simple string source type: `'user'`, `'policy'`, `'test'`, or custom string
   * - Full audit trail object: `{ source: 'user', identifier: 'user-123', ... }`
   *
   * @example
   * ```typescript
   * // Simple usage
   * grantedBy: 'user'
   *
   * // Full audit trail
   * grantedBy: {
   *   source: 'user',
   *   identifier: 'user-123',
   *   displayName: 'John Doe',
   *   method: 'interactive',
   * }
   * ```
   */
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

  /**
   * Who/what revoked the approval.
   *
   * Accepts either:
   * - Simple string source type: `'user'`, `'policy'`, `'expiry'`, `'session_end'`, or custom
   * - Full audit trail object: `{ source: 'user', identifier: 'user-123', ... }`
   *
   * @example
   * ```typescript
   * // Simple usage
   * revokedBy: 'user'
   *
   * // Automatic expiry
   * revokedBy: 'expiry'
   *
   * // Full audit trail
   * revokedBy: {
   *   source: 'admin',
   *   identifier: 'admin-456',
   *   displayName: 'Admin Override',
   *   method: 'interactive',
   * }
   * ```
   */
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
   * Get approval for a specific tool.
   *
   * @param toolId - Tool identifier
   * @param sessionId - Current session ID
   * @param userId - User ID (optional)
   * @returns The approval record or undefined
   */
  getApproval(toolId: string, sessionId: string, userId?: string): Promise<ApprovalRecord | undefined>;

  /**
   * Get all approvals matching a query.
   *
   * @param query - Query filters
   * @returns Array of matching approval records
   */
  queryApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]>;

  /**
   * Grant approval for a tool.
   *
   * @param options - Grant options
   * @returns The created approval record
   */
  grantApproval(options: GrantApprovalOptions): Promise<ApprovalRecord>;

  /**
   * Revoke approval for a tool.
   *
   * @param options - Revoke options
   * @returns true if approval was revoked
   */
  revokeApproval(options: RevokeApprovalOptions): Promise<boolean>;

  /**
   * Check if a tool is approved.
   * Convenience method that checks both session and user approvals.
   *
   * @param toolId - Tool identifier
   * @param sessionId - Current session ID
   * @param userId - User ID (optional)
   * @param context - Approval context (optional)
   * @returns true if tool is approved
   */
  isApproved(toolId: string, sessionId: string, userId?: string, context?: ApprovalContext): Promise<boolean>;

  /**
   * Clear all session approvals.
   * Called when a session ends.
   *
   * @param sessionId - Session ID to clear
   * @returns Number of approvals cleared
   */
  clearSessionApprovals(sessionId: string): Promise<number>;

  /**
   * Clear expired approvals.
   * Called periodically for garbage collection.
   *
   * @returns Number of approvals cleared
   */
  clearExpiredApprovals(): Promise<number>;

  /**
   * Get approval statistics.
   *
   * @returns Statistics about stored approvals
   */
  getStats(): Promise<{
    totalApprovals: number;
    byScope: Record<ApprovalScope, number>;
    byState: Record<ApprovalState, number>;
  }>;
}
