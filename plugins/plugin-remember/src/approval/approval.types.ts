import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Approval Scope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approval scope determines the lifetime and visibility of an approval.
 */
export enum ApprovalScope {
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

export const approvalScopeSchema = z.nativeEnum(ApprovalScope);

// ─────────────────────────────────────────────────────────────────────────────
// Approval State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approval state for a tool.
 */
export enum ApprovalState {
  /** No approval decision made yet */
  PENDING = 'pending',

  /** User approved the tool for execution */
  APPROVED = 'approved',

  /** User denied the tool for execution */
  DENIED = 'denied',

  /** Approval expired (TTL or session end) */
  EXPIRED = 'expired',
}

export const approvalStateSchema = z.nativeEnum(ApprovalState);

// ─────────────────────────────────────────────────────────────────────────────
// Approval Context
// ─────────────────────────────────────────────────────────────────────────────

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

export const approvalContextSchema = z.object({
  type: z.string().min(1),
  identifier: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval Source Types
// ─────────────────────────────────────────────────────────────────────────────

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
  | 'user' // Human explicitly approved via UI
  | 'policy' // Auto-approved by policy/safe-list
  | 'admin' // Administrator override
  | 'system' // System-level approval (e.g., startup)
  | 'agent' // AI agent with delegated authority
  | 'api' // External API integration
  | 'oauth' // OAuth token grant
  | 'test' // Test environment
  | (string & {}); // Allow custom strings (vendor extensibility)

export const approvalSourceTypeSchema = z.string().min(1);

/**
 * How the approval was obtained.
 */
export type ApprovalMethod = 'interactive' | 'implicit' | 'delegation' | 'batch' | 'api';

export const approvalMethodSchema = z.enum(['interactive', 'implicit', 'delegation', 'batch', 'api']);

// ─────────────────────────────────────────────────────────────────────────────
// Delegation Context
// ─────────────────────────────────────────────────────────────────────────────

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

export const delegationContextSchema = z.object({
  delegatorId: z.string().min(1),
  delegateId: z.string().min(1),
  purpose: z.string().optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval Grantor (Full Audit Trail)
// ─────────────────────────────────────────────────────────────────────────────

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

export const approvalGrantorSchema = z.object({
  source: approvalSourceTypeSchema,
  identifier: z.string().optional(),
  displayName: z.string().optional(),
  method: approvalMethodSchema.optional(),
  origin: z.string().optional(),
  delegationContext: delegationContextSchema.optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval Revoker (Revocation Tracking)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Revocation source types (includes approval sources + revocation-specific).
 */
export type RevocationSourceType = ApprovalSourceType | 'expiry' | 'session_end';

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
  method?: 'interactive' | 'implicit' | 'policy' | 'expiry';
}

export const approvalRevokerSchema = z.object({
  source: z.string().min(1),
  identifier: z.string().optional(),
  displayName: z.string().optional(),
  method: z.enum(['interactive', 'implicit', 'policy', 'expiry']).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval Record
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approval record stored in memory.
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

export const approvalRecordSchema = z.object({
  toolId: z.string().min(1),
  state: approvalStateSchema,
  scope: approvalScopeSchema,
  grantedAt: z.number(),
  expiresAt: z.number().optional(),
  ttlMs: z.number().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  context: approvalContextSchema.optional(),
  grantedBy: approvalGrantorSchema,
  approvalChain: z.array(approvalGrantorSchema).optional(),
  reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  revokedAt: z.number().optional(),
  revokedBy: approvalRevokerSchema.optional(),
  revocationReason: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Approval Requirements
// ─────────────────────────────────────────────────────────────────────────────

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
  category?: 'read' | 'write' | 'delete' | 'execute' | 'admin';

  /**
   * Risk level hint for UI.
   */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Contexts where this tool is pre-approved.
   * E.g., "allow without approval in repo Z"
   */
  preApprovedContexts?: ApprovalContext[];
}

export const toolApprovalRequirementSchema = z.object({
  required: z.boolean().optional(),
  defaultScope: approvalScopeSchema.optional(),
  allowedScopes: z.array(approvalScopeSchema).optional(),
  maxTtlMs: z.number().positive().optional(),
  alwaysPrompt: z.boolean().optional(),
  skipApproval: z.boolean().optional(),
  approvalMessage: z.string().optional(),
  category: z.enum(['read', 'write', 'delete', 'execute', 'admin']).optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  preApprovedContexts: z.array(approvalContextSchema).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Global Declaration Merging
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  /**
   * Extend tool metadata with approval requirements.
   * This merges with ExtendFrontMcpToolMetadata in @frontmcp/sdk.
   */
  interface ExtendFrontMcpToolMetadata {
    /**
     * Approval requirements for this tool.
     * Enables Claude Code-like permission prompts.
     *
     * @example
     * ```typescript
     * @Tool({
     *   name: 'file_write',
     *   approval: {
     *     required: true,
     *     defaultScope: 'session',
     *     category: 'write',
     *     riskLevel: 'medium',
     *   },
     * })
     * ```
     */
    approval?: ToolApprovalRequirement | boolean;
  }
}

// Ensure the module is treated as a module
export {};
