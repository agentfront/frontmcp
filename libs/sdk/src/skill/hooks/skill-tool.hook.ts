// file: libs/sdk/src/skill/hooks/skill-tool.hook.ts

import { FlowHooksOf, type FrontMcpLogger } from '../../common';
import { ToolNotAllowedError, ToolApprovalRequiredError } from '../errors/tool-not-allowed.error';
import type { SkillSessionManager } from '../session/skill-session.manager';
import type { ToolAuthorizationResult } from '../session/skill-session.types';

const { Will } = FlowHooksOf<'tools:call-tool'>('tools:call-tool');

/**
 * Options for configuring the SkillToolGuardHook.
 */
export interface SkillToolGuardHookOptions {
  /**
   * Logger instance for debugging and audit logging.
   */
  logger?: FrontMcpLogger;

  /**
   * Callback invoked when tool approval is required in 'approval' mode.
   * Should return true if approved, false if denied.
   * If not provided, ToolApprovalRequiredError will be thrown.
   */
  onApprovalRequired?: (toolName: string, skillId: string) => Promise<boolean>;

  /**
   * Whether to track tool calls for rate limiting.
   * @default true
   */
  trackToolCalls?: boolean;
}

/**
 * Hook context provided to the skill tool guard.
 * Matches the state available during checkToolAuthorization stage.
 */
interface SkillToolHookContext {
  state: {
    tool?: { metadata: { name: string }; fullName?: string };
    input?: { name: string };
  };
}

/**
 * Base interface for the skill tool guard hook class.
 */
export interface SkillToolGuardHookClass {
  new (): { checkSkillToolAuthorization(): Promise<void> };
}

/**
 * Handles the authorization result based on the policy mode.
 */
async function handleAuthorizationResult(
  authResult: ToolAuthorizationResult,
  sessionManager: SkillSessionManager,
  policyMode: string,
  skillId: string,
  onApprovalRequired?: (toolName: string, skillId: string) => Promise<boolean>,
  logger?: FrontMcpLogger,
): Promise<void> {
  if (authResult.allowed) {
    logger?.verbose(`SkillToolGuard: tool "${authResult.toolName}" allowed`, {
      reason: authResult.reason,
    });
    return;
  }

  // Tool not allowed - handle based on policy mode
  const allowlist = sessionManager.getToolAllowlist();

  switch (policyMode) {
    case 'strict':
      logger?.warn(`SkillToolGuard: blocking tool "${authResult.toolName}" (strict mode)`, {
        skillId,
        reason: authResult.reason,
        allowedTools: allowlist,
      });
      throw new ToolNotAllowedError(authResult, allowlist);

    case 'approval':
      logger?.info(`SkillToolGuard: tool "${authResult.toolName}" requires approval`, {
        skillId,
      });

      if (authResult.requiresApproval && onApprovalRequired) {
        const approved = await onApprovalRequired(authResult.toolName, skillId);
        if (approved) {
          sessionManager.approveToolForSession(authResult.toolName);
          logger?.info(`SkillToolGuard: tool "${authResult.toolName}" approved dynamically`);
          return;
        }
      }

      throw new ToolApprovalRequiredError(authResult.toolName, skillId);

    case 'permissive':
    default:
      // Log warning but allow execution
      logger?.warn(`SkillToolGuard: tool "${authResult.toolName}" not in allowlist (permissive mode)`, {
        skillId,
        reason: authResult.reason,
        allowedTools: allowlist,
      });
      // Track the call even for non-allowlisted tools in permissive mode
      sessionManager.recordToolCall(authResult.toolName);
      return;
  }
}

/**
 * Creates a skill-based tool authorization guard hook.
 *
 * This hook integrates with the call-tool flow to enforce tool allowlists
 * when a skill is active. It runs BEFORE the existing checkToolAuthorization
 * stage to provide skill-level security.
 *
 * @example
 * ```typescript
 * const sessionManager = new SkillSessionManager({ defaultPolicyMode: 'strict' });
 * const hook = createSkillToolGuardHook(sessionManager, { logger });
 *
 * // Register with hook registry
 * scope.hooks.register(hook);
 * ```
 *
 * @param sessionManager - The skill session manager instance
 * @param options - Configuration options
 * @returns Hook class that can be registered with the hook registry
 */
export function createSkillToolGuardHook(
  sessionManager: SkillSessionManager,
  options: SkillToolGuardHookOptions = {},
): SkillToolGuardHookClass {
  const { logger, onApprovalRequired, trackToolCalls = true } = options;

  /**
   * Skill tool authorization guard hook.
   *
   * Enforces skill-based tool allowlists during tool execution.
   * Supports three policy modes:
   * - 'strict': Block unapproved tools completely
   * - 'approval': Ask for human approval for unapproved tools
   * - 'permissive': Allow with warning (logging only)
   */
  class SkillToolGuardHookImpl {
    /**
     * Hook that runs BEFORE checkToolAuthorization stage.
     * Priority 100 ensures it runs before any other Will hooks on this stage.
     */
    @Will('checkToolAuthorization', { priority: 100 })
    async checkSkillToolAuthorization(): Promise<void> {
      // Access the hook context (injected by flow runtime)
      const ctx = this as unknown as SkillToolHookContext;

      // Get the tool name from state (set by findTool stage)
      // IMPORTANT: Use base name (metadata.name) not fullName, because allowlists
      // are built from unqualified tool names. fullName includes owner prefix
      // (e.g., "my-app:tool-name") which won't match the allowlist.
      const rawToolName = ctx.state.tool?.metadata?.name || ctx.state.input?.name || ctx.state.tool?.fullName;

      if (!rawToolName) {
        logger?.verbose('SkillToolGuard: skipping (no tool name in context)');
        return;
      }

      // Extract base name if fullName was used (strip owner prefix)
      // Format is "owner:name" so we take everything after the last colon
      const toolName = rawToolName.includes(':')
        ? rawToolName.substring(rawToolName.lastIndexOf(':') + 1)
        : rawToolName;

      // Get active skill session
      const session = sessionManager.getActiveSession();

      if (!session) {
        logger?.verbose('SkillToolGuard: skipping (no active session)');
        return;
      }

      if (!session.activeSkillId) {
        logger?.verbose('SkillToolGuard: skipping (no active skill)');
        return;
      }

      logger?.verbose(`SkillToolGuard: checking authorization for tool "${toolName}"`, {
        skillId: session.activeSkillId,
        policyMode: session.policyMode,
      });

      // Check tool authorization
      const authResult = sessionManager.checkToolAuthorization(toolName);

      // Track tool call if enabled
      if (trackToolCalls && authResult.allowed) {
        sessionManager.recordToolCall(toolName);
      }

      // Handle authorization result based on policy mode
      await handleAuthorizationResult(
        authResult,
        sessionManager,
        session.policyMode,
        session.activeSkillId,
        onApprovalRequired,
        logger,
      );
    }
  }

  return SkillToolGuardHookImpl;
}
