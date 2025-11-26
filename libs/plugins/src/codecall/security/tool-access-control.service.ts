// file: libs/plugins/src/codecall/security/tool-access-control.service.ts

import { Provider, ProviderScope } from '@frontmcp/sdk';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/**
 * Tool access control modes:
 * - whitelist: Only explicitly allowed tools can be called (most secure)
 * - blacklist: All tools allowed except explicitly blocked (default, more flexible)
 * - dynamic: Evaluate access per-call based on custom function
 */
export type ToolAccessMode = 'whitelist' | 'blacklist' | 'dynamic';

/**
 * Tool access policy configuration.
 */
export interface ToolAccessPolicy {
  /**
   * Access control mode.
   * @default 'blacklist'
   */
  mode: ToolAccessMode;

  /**
   * Tools explicitly allowed (for whitelist mode).
   * Supports exact names and glob patterns (e.g., 'users:*').
   */
  whitelist?: string[];

  /**
   * Tools explicitly blocked (for blacklist mode).
   * Supports exact names and glob patterns (e.g., 'admin:*').
   */
  blacklist?: string[];

  /**
   * Pattern-based rules that apply in addition to whitelist/blacklist.
   */
  patterns?: {
    allow?: string[];
    deny?: string[];
  };

  /**
   * Custom evaluator function for dynamic mode.
   * Called for each tool access request.
   */
  evaluator?: (context: ToolAccessContext) => Promise<ToolAccessDecision>;
}

/**
 * Context provided to the access evaluator.
 */
export interface ToolAccessContext {
  toolName: string;
  authInfo?: AuthInfo;
  executionId?: string;
  callDepth: number;
  timestamp: number;
}

/**
 * Decision from the access control check.
 */
export interface ToolAccessDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Default blacklist - tools that are always blocked regardless of configuration.
 * These are security-sensitive and should never be accessible via CodeCall.
 */
const DEFAULT_BLACKLIST: ReadonlySet<string> = Object.freeze(
  new Set([
    // Internal system tools
    'system:*',
    'internal:*',
    '__*', // Any tool starting with __
  ]),
);

/**
 * Tool Access Control Service
 *
 * Provides centralized access control for tool calls within CodeCall.
 * Implements a layered security model:
 *
 * 1. Self-reference blocking (handled separately in self-reference-guard.ts)
 * 2. Default blacklist (always enforced)
 * 3. User-configured whitelist/blacklist
 * 4. Pattern matching (glob patterns)
 * 5. Dynamic evaluation (if configured)
 */
@Provider({
  name: 'codecall:tool-access-control',
  scope: ProviderScope.GLOBAL,
})
export class ToolAccessControlService {
  private readonly policy: ToolAccessPolicy;
  private readonly whitelistSet: Set<string>;
  private readonly blacklistSet: Set<string>;
  private readonly allowPatterns: RegExp[];
  private readonly denyPatterns: RegExp[];

  constructor(policy?: ToolAccessPolicy) {
    this.policy = policy || { mode: 'blacklist' };

    // Pre-compile sets and patterns for fast lookup
    this.whitelistSet = new Set(this.policy.whitelist || []);
    this.blacklistSet = new Set([...(this.policy.blacklist || []), ...Array.from(DEFAULT_BLACKLIST)]);

    this.allowPatterns = (this.policy.patterns?.allow || []).map(this.globToRegex);
    this.denyPatterns = (this.policy.patterns?.deny || []).map(this.globToRegex);
  }

  /**
   * Check if a tool can be accessed.
   *
   * @param toolName - The tool being accessed
   * @param context - Optional access context for dynamic evaluation
   * @returns Decision indicating if access is allowed
   */
  async checkAccess(toolName: string, context?: Partial<ToolAccessContext>): Promise<ToolAccessDecision> {
    const fullContext: ToolAccessContext = {
      toolName,
      authInfo: context?.authInfo,
      executionId: context?.executionId,
      callDepth: context?.callDepth ?? 0,
      timestamp: Date.now(),
    };

    // Step 1: Check deny patterns first (highest priority)
    for (const pattern of this.denyPatterns) {
      if (pattern.test(toolName)) {
        return { allowed: false, reason: `Tool matches deny pattern` };
      }
    }

    // Step 2: Check explicit blacklist
    if (this.isInSet(toolName, this.blacklistSet)) {
      return { allowed: false, reason: `Tool is explicitly blocked` };
    }

    // Step 3: Mode-specific checks
    switch (this.policy.mode) {
      case 'whitelist':
        return this.checkWhitelistMode(toolName, fullContext);

      case 'blacklist':
        return this.checkBlacklistMode(toolName, fullContext);

      case 'dynamic':
        return this.checkDynamicMode(toolName, fullContext);

      default:
        // Default to deny for unknown modes (fail-secure)
        return { allowed: false, reason: 'Unknown access control mode' };
    }
  }

  private async checkWhitelistMode(toolName: string, context: ToolAccessContext): Promise<ToolAccessDecision> {
    // In whitelist mode, tool must be explicitly allowed
    if (this.isInSet(toolName, this.whitelistSet)) {
      return { allowed: true };
    }

    // Check allow patterns
    for (const pattern of this.allowPatterns) {
      if (pattern.test(toolName)) {
        return { allowed: true };
      }
    }

    // Check dynamic evaluator as fallback
    if (this.policy.evaluator) {
      return this.policy.evaluator(context);
    }

    return { allowed: false, reason: 'Tool not in whitelist' };
  }

  private async checkBlacklistMode(toolName: string, context: ToolAccessContext): Promise<ToolAccessDecision> {
    // In blacklist mode, tool is allowed unless blocked
    // (blacklist already checked above)

    // Check dynamic evaluator for additional restrictions
    if (this.policy.evaluator) {
      const dynamicDecision = await this.policy.evaluator(context);
      if (!dynamicDecision.allowed) {
        return dynamicDecision;
      }
    }

    return { allowed: true };
  }

  private async checkDynamicMode(toolName: string, context: ToolAccessContext): Promise<ToolAccessDecision> {
    if (!this.policy.evaluator) {
      // No evaluator configured - fail-secure
      return { allowed: false, reason: 'No dynamic evaluator configured' };
    }

    return this.policy.evaluator(context);
  }

  /**
   * Check if a tool name matches any entry in a set (supports glob patterns).
   */
  private isInSet(toolName: string, set: Set<string>): boolean {
    // Direct match
    if (set.has(toolName)) {
      return true;
    }

    // Check glob patterns in the set
    for (const pattern of set) {
      if (pattern.includes('*')) {
        const regex = this.globToRegex(pattern);
        if (regex.test(toolName)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Convert a glob pattern to a RegExp.
   * Supports: * (any characters), ? (single character)
   */
  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\*/g, '.*') // * -> .*
      .replace(/\?/g, '.'); // ? -> .

    return new RegExp(`^${escaped}$`, 'i');
  }

  /**
   * Get the current policy configuration (for debugging/testing).
   */
  getPolicy(): Readonly<ToolAccessPolicy> {
    return Object.freeze({ ...this.policy });
  }
}

export default ToolAccessControlService;
