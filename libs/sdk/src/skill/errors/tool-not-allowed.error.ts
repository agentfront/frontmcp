// file: libs/sdk/src/skill/errors/tool-not-allowed.error.ts

import { PublicMcpError, MCP_ERROR_CODES } from '../../errors';
import type { ToolAuthorizationResult } from '../session/skill-session.types';

/**
 * Error thrown when a tool call is not authorized by the active skill(s).
 *
 * This error is thrown in 'strict' policy mode when a tool not in the
 * skill's allowlist is called. Supports both single and multiple active skills.
 *
 * @example
 * ```typescript
 * const authResult = sessionManager.checkToolAuthorization('some_tool');
 * if (!authResult.allowed) {
 *   throw new ToolNotAllowedError(authResult);
 * }
 * ```
 */
export class ToolNotAllowedError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.INVALID_REQUEST;
  readonly toolName: string;
  readonly skillId: string | undefined;
  readonly skillName: string | undefined;
  readonly activeSkillIds: string[];
  readonly activeSkillNames: string[];
  readonly reason: ToolAuthorizationResult['reason'];
  readonly allowedTools: string[];

  constructor(authResult: ToolAuthorizationResult, allowedTools: string[] = []) {
    const message = ToolNotAllowedError.formatMessage(authResult, allowedTools);
    super(message);
    this.name = 'ToolNotAllowedError';
    this.toolName = authResult.toolName;
    this.skillId = authResult.skillId;
    this.skillName = authResult.skillName;
    this.activeSkillIds = authResult.activeSkillIds ?? [];
    this.activeSkillNames = authResult.activeSkillNames ?? [];
    this.reason = authResult.reason;
    this.allowedTools = allowedTools;
  }

  private static formatMessage(authResult: ToolAuthorizationResult, allowedTools: string[]): string {
    const { toolName, skillId, skillName, activeSkillNames, reason } = authResult;

    // Build display for active skills
    const skillDisplay = ToolNotAllowedError.formatSkillDisplay(skillName, skillId, activeSkillNames);

    switch (reason) {
      case 'not_in_allowlist':
        if (skillId || skillName || (activeSkillNames && activeSkillNames.length > 0)) {
          const toolList = allowedTools.length > 0 ? allowedTools.join(', ') : 'none';
          const skillsLabel =
            activeSkillNames && activeSkillNames.length > 1
              ? 'The active skills only allow'
              : 'The current skill only allows';
          return (
            `Tool '${toolName}' is not permitted during the '${skillDisplay}' skill session.\n\n` +
            `${skillsLabel} the following tools: ${toolList}.\n\n` +
            `Please use one of the allowed tools listed above, or deactivate the skill session to use other tools.`
          );
        }
        return `Tool '${toolName}' is not in the skill's allowlist.`;

      case 'denied':
        return (
          `Tool '${toolName}' has been explicitly denied for this session.\n\n` +
          `This tool was blocked during the '${skillDisplay}' skill session. ` +
          `Please use the allowed tools instead.`
        );

      case 'rate_limited':
        return (
          `Tool call rate limit exceeded. Cannot call '${toolName}'.\n\n` +
          `The '${skillDisplay}' skill session has reached its maximum tool call limit.`
        );

      case 'no_active_skill':
        return (
          `Cannot call tool '${toolName}': no skill is active and explicit activation is required.\n\n` +
          `Please load a skill first using the loadSkill tool with activateSession: true.`
        );

      default:
        return `Tool '${toolName}' is not authorized for use in this skill session.`;
    }
  }

  /**
   * Format the skill display string, handling multiple active skills.
   */
  private static formatSkillDisplay(
    skillName: string | undefined,
    skillId: string | undefined,
    activeSkillNames: string[] | undefined,
  ): string {
    // If multiple skills are active, show all of them
    if (activeSkillNames && activeSkillNames.length > 1) {
      return activeSkillNames.join(' + ');
    }
    // Single skill case
    return skillName || skillId || 'the active skill';
  }

  override getPublicMessage(): string {
    return this.message;
  }

  toJsonRpcError() {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
      data: {
        toolName: this.toolName,
        skillId: this.skillId,
        skillName: this.skillName,
        activeSkillIds: this.activeSkillIds,
        activeSkillNames: this.activeSkillNames,
        reason: this.reason,
        allowedTools: this.allowedTools,
      },
    };
  }
}

/**
 * Error thrown when tool approval is required but not granted.
 */
export class ToolApprovalRequiredError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.INVALID_REQUEST;
  readonly toolName: string;
  readonly skillId: string | undefined;

  constructor(toolName: string, skillId?: string) {
    const message = skillId
      ? `Tool '${toolName}' requires approval to be used with skill '${skillId}'.`
      : `Tool '${toolName}' requires approval.`;
    super(message);
    this.name = 'ToolApprovalRequiredError';
    this.toolName = toolName;
    this.skillId = skillId;
  }

  override getPublicMessage(): string {
    return this.message;
  }

  toJsonRpcError() {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
      data: {
        toolName: this.toolName,
        skillId: this.skillId,
        requiresApproval: true,
      },
    };
  }
}
