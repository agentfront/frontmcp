/**
 * Approval type definitions for tool authorization flows.
 *
 * These types define the structure for approval records, grantors, and revokers
 * used in tool permission systems.
 *
 * @module @frontmcp/plugin-approval
 */
/**
 * Approval scope determines the lifetime and visibility of an approval.
 */
export declare enum ApprovalScope {
  /** Valid only for current session - cleared on session end */
  SESSION = 'session',
  /** Persists for user across sessions - stored with user identity */
  USER = 'user',
  /** Time-limited approval - expires after TTL regardless of session */
  TIME_LIMITED = 'time_limited',
  /** Tool-specific approval - tied to specific tool only */
  TOOL_SPECIFIC = 'tool_specific',
  /** Context-specific approval - tied to context (e.g., repo, project) */
  CONTEXT_SPECIFIC = 'context_specific',
}
/**
 * Approval state for a tool.
 */
export declare enum ApprovalState {
  /** No approval decision made yet */
  PENDING = 'pending',
  /** User approved the tool for execution */
  APPROVED = 'approved',
  /** User denied the tool for execution */
  DENIED = 'denied',
  /** Approval expired (TTL or session end) */
  EXPIRED = 'expired',
}
/**
 * Context for context-specific approvals.
 * Similar to Claude Code's repo-based permissions.
 */
export interface ApprovalContext {
  /** Context type (e.g., 'repository', 'project', 'workspace') */
  type: string;
  /** Context identifier (e.g., repo path, project ID) */
  identifier: string;
  /** Optional additional context data */
  metadata?: Record<string, unknown>;
}
/**
 * Built-in source types for approval grants.
 * The `(string & {})` union allows custom vendor-specific source types.
 *
 * @example
 * ```typescript
 * // Built-in sources
 * grantedBy: { source: 'user' }
 * grantedBy: { source: 'policy' }
 *
 * // Custom vendor sources
 * grantedBy: { source: 'frontcloud-rbac' }
 * grantedBy: { source: 'my-custom-auth' }
 * ```
 */
export type ApprovalSourceType =
  | 'user'
  | 'policy'
  | 'admin'
  | 'system'
  | 'agent'
  | 'api'
  | 'oauth'
  | 'test'
  | (string & {});
/**
 * How the approval was obtained.
 */
export type ApprovalMethod = 'interactive' | 'implicit' | 'delegation' | 'batch' | 'api';
/**
 * Context for delegated approvals (e.g., AI agent with delegated authority).
 * Per MCP spec, tracks the delegation chain for audit purposes.
 */
export interface DelegationContext {
  /** Who authorized the delegate (user ID, admin ID) */
  delegatorId: string;
  /** Who was authorized (agent ID, service account) */
  delegateId: string;
  /** Purpose of the delegation */
  purpose?: string;
  /** Constraints on the delegation (paths, actions, etc.) */
  constraints?: Record<string, unknown>;
}
/**
 * Full audit trail for who/what granted an approval.
 * Supports MCP spec requirements for explicit consent tracking and accountability.
 *
 * @example
 * ```typescript
 * // Simple usage - just source type
 * grantedBy: { source: 'user' }
 *
 * // Full audit trail
 * grantedBy: {
 *   source: 'user',
 *   identifier: 'user-123',
 *   displayName: 'John Doe',
 *   method: 'interactive',
 *   origin: 'ui',
 * }
 *
 * // Agent with delegation
 * grantedBy: {
 *   source: 'agent',
 *   identifier: 'claude-code',
 *   displayName: 'Claude Code Assistant',
 *   method: 'delegation',
 *   delegationContext: {
 *     delegatorId: 'user-123',
 *     delegateId: 'claude-code',
 *     purpose: 'code editing',
 *   },
 * }
 * ```
 */
export interface ApprovalGrantor {
  /** Source type - who/what granted this */
  source: ApprovalSourceType;
  /** Unique identifier (user ID, policy ID, API key prefix, etc.) */
  identifier?: string;
  /** Human-readable name for display */
  displayName?: string;
  /** How the approval was obtained */
  method?: ApprovalMethod;
  /** Where the approval originated (oauth, config, ui, cli, api) */
  origin?: string;
  /** For delegated approvals - who authorized the delegate */
  delegationContext?: DelegationContext;
}
/**
 * Revocation source types (includes approval sources + revocation-specific).
 */
export type RevocationSourceType = ApprovalSourceType | 'expiry' | 'session_end';
/**
 * Revocation method types.
 */
export type RevocationMethod = 'interactive' | 'implicit' | 'policy' | 'expiry';
/**
 * Tracking for who/what revoked an approval.
 */
export interface ApprovalRevoker {
  /** Source type - who/what revoked this */
  source: RevocationSourceType;
  /** Unique identifier (user ID, etc.) */
  identifier?: string;
  /** Human-readable name for display */
  displayName?: string;
  /** How the revocation was triggered */
  method?: RevocationMethod;
}
/**
 * Approval record stored in memory/storage.
 * Enhanced with full audit trail support per MCP spec requirements.
 */
export interface ApprovalRecord {
  /** Tool identifier (fullName or name) */
  toolId: string;
  /** Current approval state */
  state: ApprovalState;
  /** Scope of this approval */
  scope: ApprovalScope;
  /** When the approval was granted (timestamp) */
  grantedAt: number;
  /** When the approval expires (timestamp) */
  expiresAt?: number;
  /** Time-to-live in milliseconds (for time-limited approvals) */
  ttlMs?: number;
  /** Session ID (for session-scoped approvals) */
  sessionId?: string;
  /** User ID (for user-scoped approvals) */
  userId?: string;
  /** Context (for context-specific approvals) */
  context?: ApprovalContext;
  /** Who/what granted the approval (full audit trail) */
  grantedBy: ApprovalGrantor;
  /** Approval chain for multi-step approvals */
  approvalChain?: ApprovalGrantor[];
  /** Optional reason for the approval */
  reason?: string;
  /** Approval metadata (e.g., IP, user agent) */
  metadata?: Record<string, unknown>;
  /** When the approval was revoked (timestamp) */
  revokedAt?: number;
  /** Who/what revoked the approval */
  revokedBy?: ApprovalRevoker;
  /** Reason for revocation */
  revocationReason?: string;
}
/**
 * Approval category for grouping UX.
 */
export type ApprovalCategory = 'read' | 'write' | 'delete' | 'execute' | 'admin';
/**
 * Risk level hint for UI.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
/**
 * Approval requirement for a tool.
 * Declares what approval is needed before tool execution.
 */
export interface ToolApprovalRequirement {
  /**
   * Whether this tool requires approval before execution.
   * @default true if any approval options specified
   */
  required?: boolean;
  /**
   * Default scope for approvals (if user doesn't specify).
   * @default 'session'
   */
  defaultScope?: ApprovalScope;
  /**
   * Allowed scopes for this tool.
   * User cannot grant approval with a scope not in this list.
   * @default all scopes allowed
   */
  allowedScopes?: ApprovalScope[];
  /**
   * Maximum TTL in milliseconds for time-limited approvals.
   * Prevents users from setting very long TTLs for sensitive tools.
   */
  maxTtlMs?: number;
  /**
   * Whether to prompt on each call even if approved.
   * For highly sensitive operations.
   * @default false
   */
  alwaysPrompt?: boolean;
  /**
   * Whether to skip approval prompt entirely.
   * For safe, read-only operations.
   * @default false
   */
  skipApproval?: boolean;
  /**
   * Approval message shown to user when prompting.
   */
  approvalMessage?: string;
  /**
   * Categories for grouping approval UX.
   */
  category?: ApprovalCategory;
  /**
   * Risk level hint for UI.
   */
  riskLevel?: RiskLevel;
  /**
   * Contexts where this tool is pre-approved.
   * E.g., "allow without approval in repo Z"
   */
  preApprovedContexts?: ApprovalContext[];
}
