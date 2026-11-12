// file: libs/sdk/src/skill/hooks/skill-tool.hook.ts

import { FlowHooksOf, type FrontMcpLogger } from '../../common';
import { ToolApprovalRequiredError, ToolNotAllowedError } from '../errors/tool-not-allowed.error';
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

  /** The MCP session the server verified for the request being served; its skill session is the one checked. */
  verifiedSessionId?: () => string | undefined;
}

/**
 * Hook context provided to the skill tool guard.
 * Matches the state available during checkToolAuthorization stage.
 */
export interface SkillToolHookContext {
  state: {
    tool?: { name?: string; metadata: { name: string; id?: string }; fullName?: string };
    input?: { name: string };
  };
}

/**
 * Base interface for the skill tool guard hook class.
 */
export interface SkillToolGuardHookClass {
  new (): { checkSkillToolAuthorization(ctx: SkillToolHookContext): Promise<void> };
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
  const { logger, onApprovalRequired, trackToolCalls = true, verifiedSessionId } = options;

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
     * A low priority runs it before other Will hooks on this stage (lower runs first).
     */
    @Will('checkToolAuthorization', { priority: -1000 })
    async checkSkillToolAuthorization(ctx: SkillToolHookContext): Promise<void> {
      // The name the resolved tool is registered and called under (its `id`, else its `name`), as
      // allowlists hold it; not fullName, whose owner prefix ("my-app:tool-name") no allowlist holds.
      const { tool } = ctx.state;
      const rawToolName =
        tool?.name || tool?.metadata?.id || tool?.metadata?.name || ctx.state.input?.name || tool?.fullName;

      if (!rawToolName) {
        logger?.verbose('SkillToolGuard: skipping (no tool name in context)');
        return;
      }

      // Extract base name if fullName was used (strip owner prefix)
      // Format is "owner:name" so we take everything after the last colon
      const toolName = rawToolName.includes(':')
        ? rawToolName.substring(rawToolName.lastIndexOf(':') + 1)
        : rawToolName;

      const sessionId = verifiedSessionId?.();
      if (sessionId && sessionManager.getActiveSession()?.sessionId !== sessionId) {
        await sessionManager.runWithSession(sessionId, () => authorizeInActiveSession(toolName));
        return;
      }
      await authorizeInActiveSession(toolName);
    }
  }

  async function authorizeInActiveSession(toolName: string): Promise<void> {
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

  return SkillToolGuardHookImpl;
}
