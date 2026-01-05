import { Provider, ProviderScope } from '@frontmcp/sdk';
import type {
  ApprovalStore,
  ApprovalQuery,
  GrantApprovalOptions,
  RevokeApprovalOptions,
} from './approval-store.interface';
import type {
  ApprovalRecord,
  ApprovalContext,
  ApprovalGrantor,
  ApprovalRevoker,
  ApprovalSourceType,
  RevocationSourceType,
} from './approval.types';
import { ApprovalScope, ApprovalState } from './approval.types';

// ─────────────────────────────────────────────────────────────────────────────
// Normalization Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a grantedBy input to the structured ApprovalGrantor format.
 * Accepts either a simple string source type or a full ApprovalGrantor object.
 */
function normalizeGrantor(input: ApprovalGrantor | ApprovalSourceType | undefined): ApprovalGrantor {
  if (!input) {
    return { source: 'user' };
  }
  if (typeof input === 'string') {
    return { source: input };
  }
  return input;
}

/**
 * Normalize a revokedBy input to the structured ApprovalRevoker format.
 * Accepts either a simple string source type or a full ApprovalRevoker object.
 */
function normalizeRevoker(input: ApprovalRevoker | RevocationSourceType | undefined): ApprovalRevoker {
  if (!input) {
    return { source: 'user' };
  }
  if (typeof input === 'string') {
    return { source: input };
  }
  return input;
}

/**
 * In-memory implementation of the ApprovalStore.
 * Provides fast, local storage for tool approvals.
 */
@Provider({
  name: 'provider:remember:approval-store:memory',
  description: 'In-memory approval store for RememberPlugin',
  scope: ProviderScope.GLOBAL,
})
export class ApprovalMemoryStore implements ApprovalStore {
  /** Map of approval key -> ApprovalRecord */
  private readonly approvals = new Map<string, ApprovalRecord>();

  /** Cleanup interval for expired approvals */
  private cleanupInterval?: NodeJS.Timeout;

  constructor(cleanupIntervalSeconds = 60) {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.clearExpiredApprovals();
    }, cleanupIntervalSeconds * 1000);
    (this.cleanupInterval as { unref?: () => void }).unref?.();
  }

  /**
   * Build a unique key for an approval.
   */
  private buildKey(toolId: string, sessionId?: string, userId?: string, context?: ApprovalContext): string {
    const parts = ['approval', toolId];
    if (sessionId) parts.push(`session:${sessionId}`);
    if (userId) parts.push(`user:${userId}`);
    if (context) parts.push(`ctx:${context.type}:${context.identifier}`);
    return parts.join(':');
  }

  /**
   * Get approval for a specific tool.
   */
  async getApproval(toolId: string, sessionId: string, userId?: string): Promise<ApprovalRecord | undefined> {
    // Check session approval first
    const sessionKey = this.buildKey(toolId, sessionId);
    const sessionApproval = this.approvals.get(sessionKey);
    if (sessionApproval && !this.isExpired(sessionApproval)) {
      return sessionApproval;
    }

    // Check user approval
    if (userId) {
      const userKey = this.buildKey(toolId, undefined, userId);
      const userApproval = this.approvals.get(userKey);
      if (userApproval && !this.isExpired(userApproval)) {
        return userApproval;
      }
    }

    return undefined;
  }

  /**
   * Query approvals matching filters.
   */
  async queryApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]> {
    const results: ApprovalRecord[] = [];

    for (const approval of this.approvals.values()) {
      // Check expiration
      if (!query.includeExpired && this.isExpired(approval)) {
        continue;
      }

      // Apply filters
      if (query.toolId && approval.toolId !== query.toolId) continue;
      if (query.toolIds && !query.toolIds.includes(approval.toolId)) continue;
      if (query.scope && approval.scope !== query.scope) continue;
      if (query.scopes && !query.scopes.includes(approval.scope)) continue;
      if (query.state && approval.state !== query.state) continue;
      if (query.states && !query.states.includes(approval.state)) continue;
      if (query.sessionId && approval.sessionId !== query.sessionId) continue;
      if (query.userId && approval.userId !== query.userId) continue;
      if (query.context) {
        if (
          !approval.context ||
          approval.context.type !== query.context.type ||
          approval.context.identifier !== query.context.identifier
        ) {
          continue;
        }
      }

      results.push(approval);
    }

    return results;
  }

  /**
   * Grant approval for a tool.
   */
  async grantApproval(options: GrantApprovalOptions): Promise<ApprovalRecord> {
    const now = Date.now();
    const expiresAt = options.ttlMs ? now + options.ttlMs : undefined;

    // Normalize grantedBy to full ApprovalGrantor structure
    const grantedBy = normalizeGrantor(options.grantedBy);

    const record: ApprovalRecord = {
      toolId: options.toolId,
      state: ApprovalState.APPROVED,
      scope: options.scope,
      grantedAt: now,
      expiresAt,
      ttlMs: options.ttlMs,
      sessionId: options.sessionId,
      userId: options.userId,
      context: options.context,
      grantedBy,
      reason: options.reason,
      metadata: options.metadata,
    };

    const key = this.buildKey(options.toolId, options.sessionId, options.userId, options.context);
    this.approvals.set(key, record);

    return record;
  }

  /**
   * Revoke approval for a tool.
   * Updates the record with revocation details before deleting.
   */
  async revokeApproval(options: RevokeApprovalOptions): Promise<boolean> {
    const key = this.buildKey(options.toolId, options.sessionId, options.userId, options.context);

    const existing = this.approvals.get(key);
    if (existing) {
      // Update with revocation info (for potential audit logging before delete)
      const revokedBy = normalizeRevoker(options.revokedBy);
      existing.state = ApprovalState.EXPIRED;
      existing.revokedAt = Date.now();
      existing.revokedBy = revokedBy;
      existing.revocationReason = options.reason;

      // Delete the record (in future, could move to separate revocation log)
      this.approvals.delete(key);
      return true;
    }

    return false;
  }

  /**
   * Check if a tool is approved.
   */
  async isApproved(toolId: string, sessionId: string, userId?: string, context?: ApprovalContext): Promise<boolean> {
    // Check context-specific approval first
    if (context) {
      const contextKey = this.buildKey(toolId, sessionId, userId, context);
      const contextApproval = this.approvals.get(contextKey);
      if (contextApproval && contextApproval.state === ApprovalState.APPROVED && !this.isExpired(contextApproval)) {
        return true;
      }
    }

    // Check session approval
    const sessionKey = this.buildKey(toolId, sessionId);
    const sessionApproval = this.approvals.get(sessionKey);
    if (sessionApproval && sessionApproval.state === ApprovalState.APPROVED && !this.isExpired(sessionApproval)) {
      return true;
    }

    // Check user approval
    if (userId) {
      const userKey = this.buildKey(toolId, undefined, userId);
      const userApproval = this.approvals.get(userKey);
      if (userApproval && userApproval.state === ApprovalState.APPROVED && !this.isExpired(userApproval)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Clear all session approvals.
   */
  async clearSessionApprovals(sessionId: string): Promise<number> {
    let count = 0;
    for (const [key, approval] of this.approvals) {
      if (approval.sessionId === sessionId) {
        this.approvals.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear expired approvals.
   */
  async clearExpiredApprovals(): Promise<number> {
    let count = 0;
    const now = Date.now();

    for (const [key, approval] of this.approvals) {
      if (approval.expiresAt && approval.expiresAt <= now) {
        this.approvals.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get approval statistics.
   */
  async getStats(): Promise<{
    totalApprovals: number;
    byScope: Record<ApprovalScope, number>;
    byState: Record<ApprovalState, number>;
  }> {
    const byScope: Record<ApprovalScope, number> = {
      [ApprovalScope.SESSION]: 0,
      [ApprovalScope.USER]: 0,
      [ApprovalScope.TIME_LIMITED]: 0,
      [ApprovalScope.TOOL_SPECIFIC]: 0,
      [ApprovalScope.CONTEXT_SPECIFIC]: 0,
    };

    const byState: Record<ApprovalState, number> = {
      [ApprovalState.PENDING]: 0,
      [ApprovalState.APPROVED]: 0,
      [ApprovalState.DENIED]: 0,
      [ApprovalState.EXPIRED]: 0,
    };

    for (const approval of this.approvals.values()) {
      byScope[approval.scope]++;
      byState[approval.state]++;
    }

    return {
      totalApprovals: this.approvals.size,
      byScope,
      byState,
    };
  }

  /**
   * Check if an approval is expired.
   */
  private isExpired(approval: ApprovalRecord): boolean {
    return approval.expiresAt !== undefined && Date.now() > approval.expiresAt;
  }

  /**
   * Close the store and cleanup.
   */
  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.approvals.clear();
  }
}
