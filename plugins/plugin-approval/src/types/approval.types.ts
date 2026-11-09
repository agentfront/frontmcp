import type { ApprovalContext, ToolApprovalRequirement } from '../approval';

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
  type DelegationLink,
  type ApprovalRecord,
  type ToolApprovalRequirement,
  type ApprovalCategory,
  type RiskLevel,
} from '../approval';

declare global {
  interface ExtendFrontMcpToolMetadata {
    /** Require approval before the tool runs; `true` uses session-scoped approval. */
    approval?: ToolApprovalRequirement | boolean;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin-Specific Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approval workflow mode.
 */
export type ApprovalMode = 'recheck' | 'webhook';

/**
 * A pending approval request: what `mode: 'webhook'` stores under the request's PKCE code challenge until its callback
 * arrives, or `challengeTtl` passes.
 */
export interface ChallengeRecord {
  /** Tool ID being approved */
  toolId: string;

  /** Session ID (never sent to the webhook) */
  sessionId: string;

  /** User ID if available */
  userId?: string;

  /** The context the refused call ran in, which a `context_specific` approval is granted for */
  context?: ApprovalContext;

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
 * The body of the request `mode: 'webhook'` POSTs to `webhook.url` when a call needs an approval it doesn't have. It is
 * signed with `webhook.secret` (Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature` headers).
 */
export interface WebhookPayload {
  /** Always `'approval.requested'` */
  type: 'approval.requested';

  /** SHA-256 of `codeVerifier` (PKCE S256): the request's id, safe to show and log */
  codeChallenge: string;

  /** The secret the callback sends back to decide this request. Keep it out of logs */
  codeVerifier: string;

  /** Tool being approved: `<app id>:<tool name>` */
  toolId: string;

  /** Tool name */
  toolName: string;

  /** Tool category */
  category?: string;

  /** Risk level */
  riskLevel?: string;

  /** Custom approval message */
  approvalMessage?: string;

  /** The scope an approval gets when the callback names none: the tool's `defaultScope` */
  requestedScope: string;

  /** The scopes the tool accepts, when it limits them */
  allowedScopes?: string[];

  /** The longest approval the tool accepts, in milliseconds */
  maxTtlMs?: number;

  /** The signed-in caller, when there is one */
  userId?: string;

  /** The path the server takes the decision on */
  callbackPath: string;

  /** `FRONTMCP_PUBLIC_URL` followed by `callbackPath`, when `FRONTMCP_PUBLIC_URL` is set */
  callbackUrl?: string;

  /** When the request stops accepting a decision (ms since the epoch) */
  expiresAt: number;

  /** Request timestamp */
  timestamp: number;

  /** The caller's access token, only with `webhook.includeJwt: true` */
  jwt?: string;
}

/**
 * The body of a decision POSTed to `webhook.callbackPath`, signed with `webhook.secret` like the request.
 */
export interface CallbackPayload {
  /** The request's `codeVerifier` */
  codeVerifier: string;

  /** Whether approved or denied */
  approved: boolean;

  /** Approval scope if approved: the request's `requestedScope` when absent */
  scope?: string;

  /** How long the approval, or the denial, lasts in milliseconds */
  ttlMs?: number;

  /** Who decided; recorded with `origin: 'webhook'` */
  grantedBy?: {
    source: string;
    identifier?: string;
    displayName?: string;
  };

  /** Optional reason */
  reason?: string;
}

/**
 * The answer `mode: 'recheck'` reads from `recheck.url`.
 */
export interface RecheckResponse {
  /** Whether approved */
  approved: boolean;

  /** With `approved: false`, `true` when nobody has decided yet: the plugin asks again after `recheck.interval` */
  pending?: boolean;

  /** Approval scope if approved: the tool's `defaultScope` when absent */
  scope?: string;

  /** TTL in milliseconds if time-limited */
  ttlMs?: number;

  /** Who granted the approval; recorded with `origin: 'recheck'` */
  grantedBy?: {
    source: string;
    identifier?: string;
  };

  /** Reason for denial if denied */
  denialReason?: string;
}
