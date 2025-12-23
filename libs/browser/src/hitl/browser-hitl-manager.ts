// file: libs/browser/src/hitl/browser-hitl-manager.ts
/**
 * Browser-specific Human-in-the-Loop Manager
 *
 * Extends the SDK HitlManager with browser-specific features:
 * - localStorage/sessionStorage persistence for audit logs
 * - Browser-native dialog support
 * - Integration with React context
 */

import { HitlManager, type ConfirmationRequest, type ConfirmationResponse } from '@frontmcp/sdk/core';
import type { BrowserHitlManagerOptions, BrowserAuditLogOptions, ConfirmationDialogOptions } from './types';

const DEFAULT_STORAGE_KEY = 'frontmcp:hitl:audit';
const DEFAULT_DECISIONS_KEY = 'frontmcp:hitl:decisions';

/**
 * Browser Human-in-the-Loop Manager
 *
 * Provides browser-specific HiTL functionality with:
 * - localStorage/sessionStorage for persistent audit logs
 * - Native browser dialog support (confirm/alert)
 * - React integration hooks
 */
export class BrowserHitlManager extends HitlManager {
  private readonly auditOptions: BrowserAuditLogOptions;
  private readonly dialogOptions: ConfirmationDialogOptions;
  private dialogResolver: ((response: ConfirmationResponse) => void) | null = null;
  private currentRequest: ConfirmationRequest | null = null;
  private onRequestChange: ((request: ConfirmationRequest | null) => void) | null = null;

  constructor(options: BrowserHitlManagerOptions = {}) {
    super({
      ...options,
      // Don't set a confirmation handler yet - it will be set by React provider
    });

    this.auditOptions = options.auditOptions ?? {
      maxEntries: 1000,
      persist: false,
      storageType: 'session',
      storageKey: DEFAULT_STORAGE_KEY,
      debug: options.debug,
    };

    this.dialogOptions = options.dialogOptions ?? {};

    // Load persisted data if enabled
    if (this.auditOptions.persist) {
      this.loadFromStorage();
    }
  }

  /**
   * Get dialog options
   */
  getDialogOptions(): ConfirmationDialogOptions {
    return { ...this.dialogOptions };
  }

  /**
   * Get current pending request
   */
  getCurrentRequest(): ConfirmationRequest | null {
    return this.currentRequest;
  }

  /**
   * Set callback for request changes (used by React provider)
   */
  setOnRequestChange(callback: ((request: ConfirmationRequest | null) => void) | null): void {
    this.onRequestChange = callback;
  }

  /**
   * Request confirmation with browser-specific handling
   */
  override async requestConfirmation(
    actionName: string,
    options: {
      description: string;
      riskLevel?: import('@frontmcp/sdk/core').RiskLevel;
      arguments?: Record<string, unknown>;
      timeout?: number;
      allowRemember?: boolean;
      context?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ConfirmationResponse> {
    // Use parent's confirmation handler if set
    if (this['confirmationHandler']) {
      return super.requestConfirmation(actionName, options);
    }

    // Create the request for React to render
    const request: ConfirmationRequest = {
      id: crypto.randomUUID(),
      actionName,
      description: options.description,
      riskLevel: options.riskLevel ?? 'medium',
      arguments: options.arguments,
      timeout: options.timeout ?? this['config'].defaultTimeout,
      allowRemember: options.allowRemember ?? true,
      context: options.context,
      timestamp: Date.now(),
      sessionId: this.getSessionId(),
      metadata: options.metadata,
    };

    // Store request for React rendering
    this.currentRequest = request;
    this.onRequestChange?.(request);

    // Wait for response via resolveDialog
    return new Promise<ConfirmationResponse>((resolve) => {
      this.dialogResolver = resolve;

      // Handle timeout
      if (request.timeout && request.timeout > 0) {
        setTimeout(() => {
          if (this.dialogResolver === resolve) {
            this.resolveDialog('timeout', false);
          }
        }, request.timeout);
      }
    });
  }

  /**
   * Resolve the current confirmation dialog (called by React component)
   */
  resolveDialog(decision: import('@frontmcp/sdk/core').ConfirmationDecision, remember: boolean, reason?: string): void {
    if (!this.dialogResolver || !this.currentRequest) {
      return;
    }

    const response: ConfirmationResponse = {
      requestId: this.currentRequest.id,
      decision,
      remembered: remember,
      timestamp: Date.now(),
      decisionTimeMs: Date.now() - this.currentRequest.timestamp,
      reason,
    };

    // Remember decision if requested
    if (remember && (decision === 'approve' || decision === 'deny')) {
      this.rememberDecision(this.currentRequest.actionName, decision);
    }

    // Persist if enabled
    if (this.auditOptions.persist) {
      this.saveToStorage();
    }

    const resolver = this.dialogResolver;
    this.dialogResolver = null;
    this.currentRequest = null;
    this.onRequestChange?.(null);

    resolver(response);
  }

  /**
   * Use native browser confirm dialog (fallback)
   */
  useNativeDialogs(): void {
    this.setConfirmationHandler(async (request) => {
      const startTime = Date.now();
      const message = this.formatNativeMessage(request);

      // eslint-disable-next-line no-alert
      const approved = window.confirm(message);

      return {
        requestId: request.id,
        decision: approved ? 'approve' : 'deny',
        remembered: false,
        timestamp: Date.now(),
        decisionTimeMs: Date.now() - startTime,
      };
    });
  }

  /**
   * Format message for native confirm dialog
   */
  private formatNativeMessage(request: ConfirmationRequest): string {
    let message = `[${request.riskLevel.toUpperCase()}] ${request.description}`;

    if (request.context) {
      message += `\n\n${request.context}`;
    }

    if (request.arguments && Object.keys(request.arguments).length > 0) {
      message += '\n\nArguments:';
      for (const [key, value] of Object.entries(request.arguments)) {
        message += `\n  ${key}: ${JSON.stringify(value)}`;
      }
    }

    return message;
  }

  /**
   * Load audit log and remembered decisions from storage
   */
  private loadFromStorage(): void {
    try {
      const storage = this.auditOptions.storageType === 'local' ? localStorage : sessionStorage;
      const storageKey = this.auditOptions.storageKey ?? DEFAULT_STORAGE_KEY;

      // Load audit log
      const auditData = storage.getItem(storageKey);
      if (auditData) {
        const entries = JSON.parse(auditData);
        if (Array.isArray(entries)) {
          this.importAuditLog(entries);
        }
      }

      // Load remembered decisions
      const decisionsKey = storageKey.replace(':audit', ':decisions');
      const decisionsData = storage.getItem(decisionsKey);
      if (decisionsData) {
        const decisions = JSON.parse(decisionsData);
        if (Array.isArray(decisions)) {
          for (const decision of decisions) {
            if (decision.expiresAt === 0 || decision.expiresAt > Date.now()) {
              this.rememberDecision(decision.actionName, decision.decision, decision.expiresAt - Date.now());
            }
          }
        }
      }
    } catch (error) {
      if (this.auditOptions.debug) {
        console.warn('[BrowserHitlManager] Failed to load from storage:', error);
      }
    }
  }

  /**
   * Save audit log and remembered decisions to storage
   */
  private saveToStorage(): void {
    if (!this.auditOptions.persist) {
      return;
    }

    try {
      const storage = this.auditOptions.storageType === 'local' ? localStorage : sessionStorage;
      const storageKey = this.auditOptions.storageKey ?? DEFAULT_STORAGE_KEY;

      // Save audit log
      storage.setItem(storageKey, JSON.stringify(this.exportAuditLog()));

      // Save remembered decisions
      const decisionsKey = storageKey.replace(':audit', ':decisions');
      storage.setItem(decisionsKey, JSON.stringify(this.getRememberedDecisions()));
    } catch (error) {
      if (this.auditOptions.debug) {
        console.warn('[BrowserHitlManager] Failed to save to storage:', error);
      }
    }
  }

  /**
   * Clear persisted data
   */
  clearPersistedData(): void {
    try {
      const storage = this.auditOptions.storageType === 'local' ? localStorage : sessionStorage;
      const storageKey = this.auditOptions.storageKey ?? DEFAULT_STORAGE_KEY;
      const decisionsKey = storageKey.replace(':audit', ':decisions');

      storage.removeItem(storageKey);
      storage.removeItem(decisionsKey);
    } catch (error) {
      if (this.auditOptions.debug) {
        console.warn('[BrowserHitlManager] Failed to clear storage:', error);
      }
    }
  }
}

/**
 * Create a browser HiTL manager instance
 */
export function createBrowserHitlManager(options?: BrowserHitlManagerOptions): BrowserHitlManager {
  return new BrowserHitlManager(options);
}
