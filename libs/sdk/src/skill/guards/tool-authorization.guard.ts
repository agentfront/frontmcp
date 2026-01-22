// file: libs/sdk/src/skill/guards/tool-authorization.guard.ts

import type { FrontMcpLogger } from '../../common';
import type { SkillSessionManager } from '../session/skill-session.manager';
import type { ToolAuthorizationResult, SkillPolicyMode } from '../session/skill-session.types';
import { ToolNotAllowedError, ToolApprovalRequiredError } from '../errors/tool-not-allowed.error';

/**
 * Options for the ToolAuthorizationGuard.
 */
export interface ToolAuthorizationGuardOptions {
  /**
   * Whether to throw an error when a tool is not allowed.
   * If false, returns the authorization result without throwing.
   * @default true
   */
  throwOnDenied?: boolean;

  /**
   * Callback for handling approval requests.
   * Called when policyMode is 'approval' and tool is not in allowlist.
   */
  onApprovalRequired?: (toolName: string, skillId: string | undefined) => Promise<boolean>;

  /**
   * Callback for logging tool authorization attempts.
   */
  onAuthorizationCheck?: (result: ToolAuthorizationResult) => void;
}

/**
 * Guard that checks tool authorization against the active skill session.
 *
 * This guard is used to enforce tool allowlists defined by skills.
 * It integrates with the SkillSessionManager to check if a tool
 * is authorized for the current skill session.
 *
 * @example
 * ```typescript
 * const guard = new ToolAuthorizationGuard(sessionManager, logger);
 *
 * // Before executing a tool
 * await guard.check('github_get_pr');  // Throws if not allowed in strict mode
 *
 * // Or get the result without throwing
 * const result = await guard.check('github_get_pr', { throwOnDenied: false });
 * if (!result.allowed) {
 *   // Handle denial
 * }
 * ```
 */
export class ToolAuthorizationGuard {
  private readonly sessionManager: SkillSessionManager;
  private readonly logger?: FrontMcpLogger;
  private readonly defaultOptions: ToolAuthorizationGuardOptions;

  constructor(sessionManager: SkillSessionManager, logger?: FrontMcpLogger, options?: ToolAuthorizationGuardOptions) {
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.defaultOptions = {
      throwOnDenied: true,
      ...options,
    };
  }

  /**
   * Check if a tool is authorized for the current skill session.
   *
   * @param toolName - Name of the tool to check
   * @param options - Override options for this check
   * @returns Authorization result
   * @throws ToolNotAllowedError if tool is not allowed and throwOnDenied is true
   * @throws ToolApprovalRequiredError if approval is required and not granted
   */
  async check(toolName: string, options?: ToolAuthorizationGuardOptions): Promise<ToolAuthorizationResult> {
    const opts = { ...this.defaultOptions, ...options };
    const result = this.sessionManager.checkToolAuthorization(toolName);

    // Call authorization check callback if provided
    opts.onAuthorizationCheck?.(result);

    // Log the check
    this.logger?.debug(`Tool authorization check: ${toolName}`, {
      allowed: result.allowed,
      reason: result.reason,
      skillId: result.skillId,
    });

    if (result.allowed) {
      // Record the tool call for rate limiting
      this.sessionManager.recordToolCall(toolName);
      return result;
    }

    // Handle approval flow
    if (result.requiresApproval && opts.onApprovalRequired) {
      const approved = await opts.onApprovalRequired(toolName, result.skillId);
      if (approved) {
        this.sessionManager.approveToolForSession(toolName);
        this.sessionManager.recordToolCall(toolName);
        return {
          ...result,
          allowed: true,
          reason: 'dynamically_approved',
        };
      } else {
        this.sessionManager.denyToolForSession(toolName);
        if (opts.throwOnDenied) {
          throw new ToolApprovalRequiredError(toolName, result.skillId);
        }
        return result;
      }
    }

    // Tool not allowed
    if (opts.throwOnDenied) {
      const allowedTools = this.sessionManager.getToolAllowlist();
      throw new ToolNotAllowedError(result, allowedTools);
    }

    return result;
  }

  /**
   * Check authorization and return a simple boolean.
   * Does not throw errors.
   */
  async isAllowed(toolName: string): Promise<boolean> {
    const result = await this.check(toolName, { throwOnDenied: false });
    return result.allowed;
  }

  /**
   * Get the current policy mode.
   */
  getPolicyMode(): SkillPolicyMode {
    return this.sessionManager.getPolicyMode() as SkillPolicyMode;
  }

  /**
   * Check if there's an active skill session.
   */
  hasActiveSkill(): boolean {
    return this.sessionManager.hasActiveSkill();
  }

  /**
   * Get the tool allowlist for the current skill.
   */
  getAllowlist(): string[] {
    return this.sessionManager.getToolAllowlist();
  }

  /**
   * Approve a tool for the current session.
   * Used when handling manual approval flows.
   */
  approveTool(toolName: string): void {
    this.sessionManager.approveToolForSession(toolName);
    this.logger?.info(`Tool approved: ${toolName}`);
  }

  /**
   * Deny a tool for the current session.
   */
  denyTool(toolName: string): void {
    this.sessionManager.denyToolForSession(toolName);
    this.logger?.info(`Tool denied: ${toolName}`);
  }
}
