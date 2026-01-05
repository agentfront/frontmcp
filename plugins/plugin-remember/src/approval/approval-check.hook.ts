import { DynamicPlugin, Plugin, ToolHook, FlowCtxOf } from '@frontmcp/sdk';
import type { ApprovalStore } from './approval-store.interface';
import type { ToolApprovalRequirement, ApprovalContext, ApprovalRecord } from './approval.types';
import { ApprovalScope, ApprovalState } from './approval.types';
import { ApprovalRequiredError, ApprovalScopeNotAllowedError } from './approval.errors';
import { ApprovalStoreToken } from '../remember.symbols';

/**
 * Hook plugin that checks tool approval before execution.
 *
 * Integrates with the tool execution flow at `willExecute` stage
 * to verify approval state before allowing tool execution.
 *
 * Priority 100 ensures this runs early (before cache at 1000).
 */
@Plugin({
  name: 'remember:approval-check',
  description: 'Checks tool approval state before execution',
})
export default class ApprovalCheckPlugin extends DynamicPlugin<Record<string, never>> {
  /**
   * Check tool approval before execution.
   */
  @ToolHook.Will('execute', { priority: 100 })
  async checkApproval(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool, toolContext } = flowCtx.state;
    if (!tool || !toolContext) return;

    // Get approval requirements from tool metadata
    const approvalConfig = this.resolveApprovalConfig(tool.metadata.approval);

    // If no approval required, skip check
    if (!approvalConfig.required) {
      return;
    }

    // If skipApproval is true, skip check
    if (approvalConfig.skipApproval) {
      return;
    }

    // Get session and user info from context
    const ctx = toolContext.tryGetContext?.();
    const sessionId = ctx?.sessionId ?? 'unknown';
    const userId =
      (ctx?.authInfo?.extra?.['userId'] as string | undefined) ??
      (ctx?.authInfo?.extra?.['sub'] as string | undefined) ??
      ctx?.authInfo?.clientId;

    // Get current context (e.g., repo, project)
    const currentContext = this.getCurrentContext(flowCtx);

    // Check for pre-approved contexts
    if (this.isPreApprovedContext(approvalConfig, currentContext)) {
      return;
    }

    // Get the approval store
    const approvalStore = this.get(ApprovalStoreToken);

    // Check if tool is already approved
    const approval = await approvalStore.getApproval(tool.fullName, sessionId, userId);

    // If alwaysPrompt, ignore existing approval
    if (approvalConfig.alwaysPrompt) {
      await this.handleApprovalRequired(flowCtx, approvalConfig, approval);
      return;
    }

    // Check approval state
    if (approval?.state === ApprovalState.APPROVED) {
      // Check if approval is still valid (not expired)
      if (!this.isExpired(approval)) {
        // Approval valid, allow execution
        return;
      }
      // Approval expired, need to re-prompt
    }

    // If denied, throw immediately
    if (approval?.state === ApprovalState.DENIED) {
      throw new ApprovalRequiredError({
        toolId: tool.fullName,
        state: 'denied',
        message: `Tool "${tool.fullName}" execution denied.`,
      });
    }

    // Need approval - handle based on configuration
    await this.handleApprovalRequired(flowCtx, approvalConfig, approval);
  }

  /**
   * Resolve approval configuration from metadata.
   */
  private resolveApprovalConfig(config: ToolApprovalRequirement | boolean | undefined): ToolApprovalRequirement {
    if (config === true) {
      return { required: true, defaultScope: ApprovalScope.SESSION };
    }
    if (config === false || config === undefined) {
      return { required: false };
    }
    // Spread config first, then apply defaults to avoid undefined values overwriting defaults
    return {
      ...config,
      required: config.required ?? true,
      defaultScope: config.defaultScope ?? ApprovalScope.SESSION,
    };
  }

  /**
   * Check if approval is expired.
   */
  private isExpired(approval: ApprovalRecord): boolean {
    if (!approval.expiresAt) return false;
    return Date.now() > approval.expiresAt;
  }

  /**
   * Get current context from flow context.
   */
  private getCurrentContext(flowCtx: FlowCtxOf<'tools:call-tool'>): ApprovalContext | undefined {
    const { toolContext } = flowCtx.state;
    const ctx = toolContext?.tryGetContext?.();

    // Try to extract context from various sources
    // 1. Tool input (if tool expects context parameter)
    const contextFromInput = toolContext?.input?.['context'] as ApprovalContext | undefined;

    // 2. Session metadata
    const contextFromSession = ctx?.authInfo?.extra?.['approvalContext'] as ApprovalContext | undefined;

    return contextFromInput ?? contextFromSession;
  }

  /**
   * Check if current context is pre-approved.
   */
  private isPreApprovedContext(config: ToolApprovalRequirement, currentContext: ApprovalContext | undefined): boolean {
    if (!currentContext || !config.preApprovedContexts?.length) {
      return false;
    }

    return config.preApprovedContexts.some(
      (preApproved) => preApproved.type === currentContext.type && preApproved.identifier === currentContext.identifier,
    );
  }

  /**
   * Handle the case where approval is required.
   * Throws ApprovalRequiredError to signal client.
   */
  private async handleApprovalRequired(
    flowCtx: FlowCtxOf<'tools:call-tool'>,
    config: ToolApprovalRequirement,
    existingApproval: ApprovalRecord | undefined,
  ): Promise<void> {
    const { tool } = flowCtx.state;

    // Build approval prompt message
    const message = config.approvalMessage ?? `Tool "${tool?.fullName}" requires approval to execute. Allow?`;

    // For now, throw error for client to handle
    // Future: could use transport elicit if available
    throw new ApprovalRequiredError({
      toolId: tool?.fullName ?? 'unknown',
      state: existingApproval?.state === ApprovalState.EXPIRED ? 'expired' : 'pending',
      message,
      approvalOptions: {
        allowedScopes: config.allowedScopes,
        defaultScope: config.defaultScope,
        maxTtlMs: config.maxTtlMs,
        category: config.category,
        riskLevel: config.riskLevel,
      },
    });
  }
}
