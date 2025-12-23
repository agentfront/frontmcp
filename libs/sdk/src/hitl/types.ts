// file: libs/sdk/src/hitl/types.ts
/**
 * Human-in-the-Loop Types
 *
 * Platform-agnostic type definitions for the HiTL system.
 * These types are shared between SDK and browser implementations.
 */

/**
 * Confirmation decision made by user
 */
export type ConfirmationDecision = 'approve' | 'deny' | 'timeout' | 'dismiss';

/**
 * Risk level for operations
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Confirmation request
 */
export interface ConfirmationRequest {
  /** Unique request ID */
  id: string;
  /** Tool or action name */
  actionName: string;
  /** Human-readable action description */
  description: string;
  /** Risk level */
  riskLevel: RiskLevel;
  /** Action arguments/parameters */
  arguments?: Record<string, unknown>;
  /** Timeout in milliseconds (0 = no timeout) */
  timeout?: number;
  /** Allow "remember my choice" option */
  allowRemember?: boolean;
  /** Custom approve button text */
  approveText?: string;
  /** Custom deny button text */
  denyText?: string;
  /** Additional context for the user */
  context?: string;
  /** Request timestamp */
  timestamp: number;
  /** Session ID */
  sessionId?: string;
  /** Tool metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Confirmation response
 */
export interface ConfirmationResponse {
  /** Original request ID */
  requestId: string;
  /** User's decision */
  decision: ConfirmationDecision;
  /** Whether user chose to remember this decision */
  remembered: boolean;
  /** Response timestamp */
  timestamp: number;
  /** Time taken to decide (ms) */
  decisionTimeMs: number;
  /** User-provided reason (optional) */
  reason?: string;
}

/**
 * Remembered decision entry
 */
export interface RememberedDecision {
  /** Action name */
  actionName: string;
  /** Stored decision */
  decision: 'approve' | 'deny';
  /** When decision was made */
  decidedAt: number;
  /** Expiration timestamp (0 = never) */
  expiresAt: number;
  /** Number of times this decision was used */
  usageCount: number;
  /** Arguments hash (for argument-specific decisions) */
  argumentsHash?: string;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  /** Entry ID */
  id: string;
  /** Timestamp */
  timestamp: number;
  /** Action name */
  actionName: string;
  /** Action arguments */
  arguments?: Record<string, unknown>;
  /** User's decision */
  decision: ConfirmationDecision;
  /** Was decision from remembered preference */
  wasRemembered: boolean;
  /** Risk level */
  riskLevel: RiskLevel;
  /** Decision time in ms */
  decisionTimeMs: number;
  /** Action outcome (if executed) */
  outcome?: 'success' | 'error' | 'skipped';
  /** Error message (if failed) */
  error?: string;
  /** Session ID */
  sessionId?: string;
  /** User ID (if known) */
  userId?: string;
  /** IP address (if available) */
  ipAddress?: string;
  /** User agent (if available) */
  userAgent?: string;
}

/**
 * Bypass rule for skipping confirmation
 */
export interface BypassRule {
  /** Rule name */
  name: string;
  /** Action pattern (supports wildcards) */
  actionPattern: string;
  /** Condition function */
  condition?: (request: ConfirmationRequest) => boolean;
  /** Maximum risk level to bypass */
  maxRiskLevel?: RiskLevel;
  /** Reason for bypass */
  reason: string;
  /** Whether this rule is enabled */
  enabled?: boolean;
}

/**
 * Confirmation handler function type
 */
export type ConfirmationHandler = (request: ConfirmationRequest) => Promise<ConfirmationResponse>;

/**
 * HiTL configuration options
 */
export interface HitlConfig {
  /** Enable HiTL for all tools */
  enabled: boolean;
  /** Default timeout for confirmations (ms) */
  defaultTimeout: number;
  /** Enable audit logging */
  enableAudit: boolean;
  /** Maximum audit entries to keep */
  maxAuditEntries: number;
  /** Bypass rules for trusted operations */
  bypassRules: BypassRule[];
  /** Remember decisions duration (ms, 0 = session only) */
  rememberDuration: number;
  /** Risk level thresholds for automatic confirmation */
  autoApproveBelow?: RiskLevel;
  /** Debug mode */
  debug: boolean;
}

/**
 * Default HiTL configuration
 */
export const DEFAULT_HITL_CONFIG: HitlConfig = {
  enabled: true,
  defaultTimeout: 60000,
  enableAudit: true,
  maxAuditEntries: 1000,
  bypassRules: [],
  rememberDuration: 0, // Session only
  debug: false,
};

/**
 * Risk level configuration
 */
export const RISK_LEVEL_CONFIG: Record<
  RiskLevel,
  {
    /** Display color */
    color: string;
    /** Display icon */
    icon: string;
    /** Default timeout for this risk level */
    defaultTimeout: number;
    /** Priority (higher = more severe) */
    priority: number;
  }
> = {
  low: { color: '#22c55e', icon: '✓', defaultTimeout: 0, priority: 1 },
  medium: { color: '#eab308', icon: '⚠', defaultTimeout: 30000, priority: 2 },
  high: { color: '#f97316', icon: '⚠', defaultTimeout: 60000, priority: 3 },
  critical: { color: '#ef4444', icon: '🛑', defaultTimeout: 120000, priority: 4 },
};

/**
 * Compare risk levels
 */
export function compareRiskLevels(a: RiskLevel, b: RiskLevel): number {
  return RISK_LEVEL_CONFIG[a].priority - RISK_LEVEL_CONFIG[b].priority;
}

/**
 * Check if risk level is at or above threshold
 */
export function isRiskLevelAtOrAbove(level: RiskLevel, threshold: RiskLevel): boolean {
  return compareRiskLevels(level, threshold) >= 0;
}
