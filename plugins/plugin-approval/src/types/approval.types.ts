/**
 * Approval types for the plugin.
 * Re-exports core types from the local approval module and defines plugin-specific types.
 *
 * @module @frontmcp/plugin-approval
 */

// Re-export all types from local approval module
export {
  ApprovalScope,
  ApprovalState,
  type ApprovalSourceType,
  type RevocationSourceType,
  type ApprovalMethod,
  type ApprovalContext,
  type ApprovalGrantor,
  type ApprovalRevoker,
  type DelegationContext,
  type ApprovalRecord,
  type ToolApprovalRequirement,
  type ApprovalCategory,
  type RiskLevel,
} from '../approval';

// ─────────────────────────────────────────────────────────────────────────────
// Plugin-Specific Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approval workflow mode.
 */
export type ApprovalMode = 'recheck' | 'webhook';

/**
 * Challenge record stored in Redis for PKCE webhook flow.
 */
export interface ChallengeRecord {
  /** Tool ID being approved */
  toolId: string;

  /** Session ID (never exposed to webhook) */
  sessionId: string;

  /** User ID if available */
  userId?: string;

  /** Requested approval scope */
  requestedScope: string;

  /** Request information sent to webhook */
  requestInfo: {
    toolName: string;
    category?: string;
    riskLevel?: string;
    customMessage?: string;
  };

  /** When the challenge was created */
  createdAt: number;

  /** When the challenge expires */
  expiresAt: number;

  /** Whether webhook has been sent */
  webhookSent: boolean;
}

/**
 * Webhook payload sent to external approval system.
 */
export interface WebhookPayload {
  /** PKCE code challenge (SHA256 of code_verifier) */
  codeChallenge: string;

  /** Tool being approved */
  toolId: string;

  /** Tool name */
  toolName: string;

  /** Tool category */
  category?: string;

  /** Risk level */
  riskLevel?: string;

  /** Custom approval message */
  approvalMessage?: string;

  /** URL for callback */
  callbackUrl: string;

  /** Request timestamp */
  timestamp: number;
}

/**
 * Callback payload received from external approval system.
 */
export interface CallbackPayload {
  /** PKCE code verifier (proves knowledge of challenge) */
  codeVerifier: string;

  /** Whether approved or denied */
  approved: boolean;

  /** Approval scope if approved */
  scope?: string;

  /** TTL in milliseconds if time-limited */
  ttlMs?: number;

  /** Who granted the approval */
  grantedBy?: {
    source: string;
    identifier?: string;
    displayName?: string;
  };

  /** Optional reason */
  reason?: string;
}

/**
 * Recheck response from external approval API.
 */
export interface RecheckResponse {
  /** Whether approved */
  approved: boolean;

  /** Approval scope if approved */
  scope?: string;

  /** TTL in milliseconds if time-limited */
  ttlMs?: number;

  /** Who granted the approval */
  grantedBy?: {
    source: string;
    identifier?: string;
  };

  /** Reason for denial if denied */
  denialReason?: string;
}
