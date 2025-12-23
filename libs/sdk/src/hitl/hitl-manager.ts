// file: libs/sdk/src/hitl/hitl-manager.ts
/**
 * Human-in-the-Loop Manager
 *
 * Base implementation for HiTL confirmation system.
 * Platform-specific implementations (browser, CLI) should extend this.
 */

import { generateUUID } from '../utils/platform-crypto';
import type {
  ConfirmationRequest,
  ConfirmationResponse,
  ConfirmationHandler,
  RememberedDecision,
  AuditLogEntry,
  BypassRule,
  HitlConfig,
  RiskLevel,
  ConfirmationDecision,
} from './types';
import { DEFAULT_HITL_CONFIG, RISK_LEVEL_CONFIG, isRiskLevelAtOrAbove } from './types';

/**
 * HiTL Manager options
 */
export interface HitlManagerOptions extends Partial<HitlConfig> {
  /** Custom confirmation handler (required for non-browser) */
  confirmationHandler?: ConfirmationHandler;
  /** Session ID for audit logging */
  sessionId?: string;
}

/**
 * Human-in-the-Loop Manager
 *
 * Manages confirmation requests, remembered decisions, audit logging,
 * and bypass rules for tool execution.
 */
export class HitlManager {
  protected readonly config: HitlConfig;
  protected readonly sessionId: string;
  protected confirmationHandler?: ConfirmationHandler;
  protected rememberedDecisions = new Map<string, RememberedDecision>();
  protected auditLog: AuditLogEntry[] = [];
  protected pendingRequests = new Map<
    string,
    { request: ConfirmationRequest; resolve: (response: ConfirmationResponse) => void }
  >();

  constructor(options: HitlManagerOptions = {}) {
    this.config = {
      ...DEFAULT_HITL_CONFIG,
      ...options,
      bypassRules: [...DEFAULT_HITL_CONFIG.bypassRules, ...(options.bypassRules ?? [])],
    };
    this.sessionId = options.sessionId ?? generateUUID();
    this.confirmationHandler = options.confirmationHandler;
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Check if HiTL is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Set the confirmation handler
   */
  setConfirmationHandler(handler: ConfirmationHandler): void {
    this.confirmationHandler = handler;
  }

  /**
   * Request confirmation for an action
   */
  async requestConfirmation(
    actionName: string,
    options: {
      description: string;
      riskLevel?: RiskLevel;
      arguments?: Record<string, unknown>;
      timeout?: number;
      allowRemember?: boolean;
      context?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ConfirmationResponse> {
    const riskLevel = options.riskLevel ?? 'medium';

    // Create request
    const request: ConfirmationRequest = {
      id: generateUUID(),
      actionName,
      description: options.description,
      riskLevel,
      arguments: options.arguments,
      timeout: options.timeout ?? RISK_LEVEL_CONFIG[riskLevel].defaultTimeout ?? this.config.defaultTimeout,
      allowRemember: options.allowRemember ?? true,
      context: options.context,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      metadata: options.metadata,
    };

    // Check bypass rules
    const bypassResult = this.checkBypassRules(request);
    if (bypassResult) {
      const response = this.createBypassResponse(request, bypassResult);
      this.logAudit(request, response, true);
      return response;
    }

    // Check remembered decisions
    const remembered = this.getRememberedDecision(actionName);
    if (remembered) {
      remembered.usageCount++;
      const response: ConfirmationResponse = {
        requestId: request.id,
        decision: remembered.decision,
        remembered: true,
        timestamp: Date.now(),
        decisionTimeMs: 0,
      };
      this.logAudit(request, response, true);
      return response;
    }

    // Check auto-approve threshold
    if (this.config.autoApproveBelow && !isRiskLevelAtOrAbove(riskLevel, this.config.autoApproveBelow)) {
      const response: ConfirmationResponse = {
        requestId: request.id,
        decision: 'approve',
        remembered: false,
        timestamp: Date.now(),
        decisionTimeMs: 0,
      };
      this.logAudit(request, response, false);
      return response;
    }

    // Request user confirmation
    if (!this.confirmationHandler) {
      throw new Error('No confirmation handler configured. Set a handler via setConfirmationHandler().');
    }

    const startTime = Date.now();
    const response = await this.confirmationHandler(request);
    response.decisionTimeMs = Date.now() - startTime;

    // Remember decision if requested
    if (response.remembered && (response.decision === 'approve' || response.decision === 'deny')) {
      this.rememberDecision(actionName, response.decision);
    }

    this.logAudit(request, response, false);

    return response;
  }

  /**
   * Check if action requires confirmation
   */
  requiresConfirmation(actionName: string, riskLevel: RiskLevel = 'medium'): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Check auto-approve threshold
    if (this.config.autoApproveBelow && !isRiskLevelAtOrAbove(riskLevel, this.config.autoApproveBelow)) {
      return false;
    }

    // Check bypass rules
    const mockRequest: ConfirmationRequest = {
      id: 'check',
      actionName,
      description: '',
      riskLevel,
      timestamp: Date.now(),
    };

    if (this.checkBypassRules(mockRequest)) {
      return false;
    }

    // Check remembered decisions
    if (this.getRememberedDecision(actionName)) {
      return false;
    }

    return true;
  }

  /**
   * Add a bypass rule
   */
  addBypassRule(rule: BypassRule): void {
    this.config.bypassRules.push({ ...rule, enabled: rule.enabled ?? true });
  }

  /**
   * Remove a bypass rule
   */
  removeBypassRule(ruleName: string): boolean {
    const index = this.config.bypassRules.findIndex((r) => r.name === ruleName);
    if (index >= 0) {
      this.config.bypassRules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all bypass rules
   */
  getBypassRules(): BypassRule[] {
    return [...this.config.bypassRules];
  }

  /**
   * Remember a decision
   */
  rememberDecision(actionName: string, decision: 'approve' | 'deny', expiresIn?: number): void {
    const expiresAt = expiresIn
      ? Date.now() + expiresIn
      : this.config.rememberDuration > 0
      ? Date.now() + this.config.rememberDuration
      : 0;

    this.rememberedDecisions.set(actionName, {
      actionName,
      decision,
      decidedAt: Date.now(),
      expiresAt,
      usageCount: 0,
    });
  }

  /**
   * Get remembered decision for an action
   */
  getRememberedDecision(actionName: string): RememberedDecision | undefined {
    const decision = this.rememberedDecisions.get(actionName);
    if (!decision) {
      return undefined;
    }

    // Check expiration
    if (decision.expiresAt > 0 && Date.now() > decision.expiresAt) {
      this.rememberedDecisions.delete(actionName);
      return undefined;
    }

    return decision;
  }

  /**
   * Clear remembered decision
   */
  forgetDecision(actionName: string): boolean {
    return this.rememberedDecisions.delete(actionName);
  }

  /**
   * Clear all remembered decisions
   */
  forgetAllDecisions(): void {
    this.rememberedDecisions.clear();
  }

  /**
   * Get all remembered decisions
   */
  getRememberedDecisions(): RememberedDecision[] {
    // Clean up expired decisions first
    const now = Date.now();
    for (const [key, decision] of this.rememberedDecisions) {
      if (decision.expiresAt > 0 && now > decision.expiresAt) {
        this.rememberedDecisions.delete(key);
      }
    }
    return Array.from(this.rememberedDecisions.values());
  }

  /**
   * Get audit log
   */
  getAuditLog(options?: {
    limit?: number;
    offset?: number;
    actionName?: string;
    decision?: ConfirmationDecision;
  }): AuditLogEntry[] {
    let entries = [...this.auditLog];

    if (options?.actionName) {
      entries = entries.filter((e) => e.actionName === options.actionName);
    }

    if (options?.decision) {
      entries = entries.filter((e) => e.decision === options.decision);
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.timestamp - a.timestamp);

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? entries.length;

    return entries.slice(offset, offset + limit);
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  /**
   * Get audit log size
   */
  get auditLogSize(): number {
    return this.auditLog.length;
  }

  /**
   * Export audit log for external storage
   */
  exportAuditLog(): AuditLogEntry[] {
    return [...this.auditLog];
  }

  /**
   * Import audit log from external storage
   */
  importAuditLog(entries: AuditLogEntry[]): void {
    this.auditLog = [...entries];
    this.trimAuditLog();
  }

  /**
   * Check bypass rules
   */
  protected checkBypassRules(request: ConfirmationRequest): BypassRule | null {
    for (const rule of this.config.bypassRules) {
      if (rule.enabled === false) {
        continue;
      }

      // Check action pattern
      if (!this.matchesPattern(request.actionName, rule.actionPattern)) {
        continue;
      }

      // Check risk level
      if (rule.maxRiskLevel && isRiskLevelAtOrAbove(request.riskLevel, rule.maxRiskLevel)) {
        continue;
      }

      // Check custom condition
      if (rule.condition && !rule.condition(request)) {
        continue;
      }

      return rule;
    }

    return null;
  }

  /**
   * Match action name against pattern
   */
  protected matchesPattern(actionName: string, pattern: string): boolean {
    if (pattern === '*') {
      return true;
    }

    // Convert pattern to regex
    const regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(actionName);
  }

  /**
   * Create bypass response
   */
  protected createBypassResponse(request: ConfirmationRequest, rule: BypassRule): ConfirmationResponse {
    return {
      requestId: request.id,
      decision: 'approve',
      remembered: false,
      timestamp: Date.now(),
      decisionTimeMs: 0,
      reason: `Bypassed: ${rule.reason}`,
    };
  }

  /**
   * Log audit entry
   */
  protected logAudit(
    request: ConfirmationRequest,
    response: ConfirmationResponse,
    wasRemembered: boolean,
    outcome?: 'success' | 'error' | 'skipped',
    error?: string,
  ): void {
    if (!this.config.enableAudit) {
      return;
    }

    const entry: AuditLogEntry = {
      id: generateUUID(),
      timestamp: Date.now(),
      actionName: request.actionName,
      arguments: request.arguments,
      decision: response.decision,
      wasRemembered,
      riskLevel: request.riskLevel,
      decisionTimeMs: response.decisionTimeMs,
      outcome,
      error,
      sessionId: this.sessionId,
    };

    this.auditLog.push(entry);
    this.trimAuditLog();

    if (this.config.debug) {
      console.debug('[HiTL] Audit entry:', entry);
    }
  }

  /**
   * Trim audit log to max size
   */
  protected trimAuditLog(): void {
    if (this.auditLog.length > this.config.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-this.config.maxAuditEntries);
    }
  }

  /**
   * Update audit entry with outcome
   */
  updateAuditOutcome(requestId: string, outcome: 'success' | 'error' | 'skipped', error?: string): void {
    const entry = this.auditLog.find((e) => e.id === requestId);
    if (entry) {
      entry.outcome = outcome;
      entry.error = error;
    }
  }
}

/**
 * Create a HiTL manager instance
 */
export function createHitlManager(options?: HitlManagerOptions): HitlManager {
  return new HitlManager(options);
}
