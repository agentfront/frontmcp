// file: libs/browser/src/hitl/types.ts
/**
 * Human-in-the-Loop Types for Browser
 *
 * Re-exports core HiTL types from SDK and adds browser-specific types
 * for confirmation dialogs and React integration.
 */

// =============================================================================
// Re-export SDK types (single source of truth)
// =============================================================================

export type {
  ConfirmationDecision,
  RiskLevel,
  ConfirmationRequest,
  ConfirmationResponse,
  RememberedDecision,
  AuditLogEntry,
  BypassRule,
  ConfirmationHandler,
  HitlConfig,
} from '@frontmcp/sdk/core';

export { DEFAULT_HITL_CONFIG, RISK_LEVEL_CONFIG, compareRiskLevels, isRiskLevelAtOrAbove } from '@frontmcp/sdk/core';

// =============================================================================
// Browser-specific types
// =============================================================================

/**
 * Confirmation dialog options (browser-specific)
 */
export interface ConfirmationDialogOptions {
  /** Dialog title */
  title?: string;
  /** Show action arguments in dialog */
  showArguments?: boolean;
  /** Show risk level indicator */
  showRiskLevel?: boolean;
  /** Custom CSS class */
  className?: string;
  /** Modal or inline display */
  displayMode?: 'modal' | 'inline';
  /** Target element for inline display */
  targetElement?: string | HTMLElement;
  /** Z-index for modal */
  zIndex?: number;
  /** Theme variant */
  theme?: 'light' | 'dark' | 'system';
  /** Enable animations */
  animate?: boolean;
  /** Custom button labels */
  buttons?: {
    approve?: string;
    deny?: string;
    remember?: string;
  };
}

/**
 * Browser audit log options
 */
export interface BrowserAuditLogOptions {
  /** Maximum entries to keep in memory */
  maxEntries?: number;
  /** Persist to storage (localStorage/sessionStorage) */
  persist?: boolean;
  /** Storage type */
  storageType?: 'local' | 'session';
  /** Storage key for persistence */
  storageKey?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Browser HiTL manager options
 */
export interface BrowserHitlManagerOptions {
  /** Enable HiTL system */
  enabled?: boolean;
  /** Default timeout for confirmations (ms) */
  defaultTimeout?: number;
  /** Enable audit logging */
  enableAudit?: boolean;
  /** Audit log options */
  auditOptions?: BrowserAuditLogOptions;
  /** Bypass rules for trusted operations */
  bypassRules?: import('@frontmcp/sdk/core').BypassRule[];
  /** Remember decisions duration (ms, 0 = session only) */
  rememberDuration?: number;
  /** Auto-approve below risk level */
  autoApproveBelow?: import('@frontmcp/sdk/core').RiskLevel;
  /** Enable debug logging */
  debug?: boolean;
  /** Dialog options */
  dialogOptions?: ConfirmationDialogOptions;
}

/**
 * React context value for HiTL
 */
export interface HitlContextValue {
  /** Request confirmation for an action */
  requestConfirmation: (
    actionName: string,
    options: {
      description: string;
      riskLevel?: import('@frontmcp/sdk/core').RiskLevel;
      arguments?: Record<string, unknown>;
      timeout?: number;
      allowRemember?: boolean;
      context?: string;
    },
  ) => Promise<import('@frontmcp/sdk/core').ConfirmationResponse>;
  /** Check if action requires confirmation */
  requiresConfirmation: (actionName: string, riskLevel?: import('@frontmcp/sdk/core').RiskLevel) => boolean;
  /** Get audit log entries */
  getAuditLog: () => import('@frontmcp/sdk/core').AuditLogEntry[];
  /** Clear audit log */
  clearAuditLog: () => void;
  /** Get remembered decisions */
  getRememberedDecisions: () => import('@frontmcp/sdk/core').RememberedDecision[];
  /** Forget a remembered decision */
  forgetDecision: (actionName: string) => void;
  /** Forget all remembered decisions */
  forgetAllDecisions: () => void;
  /** Is HiTL enabled */
  isEnabled: boolean;
  /** Pending confirmation request (for dialog rendering) */
  pendingRequest: import('@frontmcp/sdk/core').ConfirmationRequest | null;
}

/**
 * Props for ConfirmationDialog component
 */
export interface ConfirmationDialogProps {
  /** Confirmation request to display */
  request: import('@frontmcp/sdk/core').ConfirmationRequest;
  /** Callback when user makes a decision */
  onDecision: (decision: import('@frontmcp/sdk/core').ConfirmationDecision, remember: boolean, reason?: string) => void;
  /** Dialog options */
  options?: ConfirmationDialogOptions;
  /** Whether dialog is open */
  isOpen?: boolean;
}

/**
 * Props for HitlProvider component
 */
export interface HitlProviderProps {
  /** Children to wrap */
  children: React.ReactNode;
  /** Manager options */
  options?: BrowserHitlManagerOptions;
  /** Custom dialog component */
  DialogComponent?: React.ComponentType<ConfirmationDialogProps>;
}
