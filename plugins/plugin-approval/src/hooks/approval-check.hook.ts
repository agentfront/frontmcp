/**
 * Hook plugin that checks tool approval before execution.
 *
 * @module @frontmcp/plugin-approval
 */

import { DynamicPlugin, Plugin, ToolHook, FlowCtxOf } from '@frontmcp/sdk';
import { ApprovalRequiredError } from '../approval';
import type { ApprovalStore } from '../stores/approval-store.interface';
import type { ToolApprovalRequirement, ApprovalContext, ApprovalRecord } from '../types';
import { ApprovalScope, ApprovalState } from '../types';
import { ApprovalStoreToken } from '../approval.symbols';

/**
 * Hook plugin that checks tool approval before execution.
 *
 * Priority 100 ensures this runs early (before cache at 1000).
 */
@Plugin({
  name: 'approval:check',
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

    // Get approval config from tool metadata (if it exists)
    const metadata = tool.metadata as unknown as Record<string, unknown>;
    const approvalConfig = this.resolveApprovalConfig(
      metadata['approval'] as ToolApprovalRequirement | boolean | undefined,
    );

    if (!approvalConfig.required) {
      return;
    }

    if (approvalConfig.skipApproval) {
      return;
    }

    const ctx = toolContext.tryGetContext?.();
    const sessionId = ctx?.sessionId ?? 'unknown';
    const userId =
      this.getStringExtra(ctx?.authInfo?.extra, 'userId') ??
      this.getStringExtra(ctx?.authInfo?.extra, 'sub') ??
      ctx?.authInfo?.clientId;

    const currentContext = this.getCurrentContext(flowCtx);

    if (this.isPreApprovedContext(approvalConfig, currentContext)) {
      return;
    }

    const approvalStore = this.get(ApprovalStoreToken) as ApprovalStore;
    const approval = await approvalStore.getApproval(tool.fullName, sessionId, userId);

    if (approvalConfig.alwaysPrompt) {
      await this.handleApprovalRequired(flowCtx, approvalConfig, approval);
      return;
    }

    if (approval?.state === ApprovalState.APPROVED) {
      if (!this.isExpired(approval)) {
        return;
      }
    }

    if (approval?.state === ApprovalState.DENIED) {
      throw new ApprovalRequiredError({
        toolId: tool.fullName,
        state: 'denied',
        message: `Tool "${tool.fullName}" execution denied.`,
      });
    }

    await this.handleApprovalRequired(flowCtx, approvalConfig, approval);
  }

  private resolveApprovalConfig(config: ToolApprovalRequirement | boolean | undefined): ToolApprovalRequirement {
    if (config === true) {
      return { required: true, defaultScope: ApprovalScope.SESSION };
    }
    if (config === false || config === undefined) {
      return { required: false };
    }
    return {
      ...config,
      required: config.required ?? true,
      defaultScope: config.defaultScope ?? ApprovalScope.SESSION,
    };
  }

  private isExpired(approval: ApprovalRecord): boolean {
    if (!approval.expiresAt) return false;
    return Date.now() > approval.expiresAt;
  }

  private getCurrentContext(flowCtx: FlowCtxOf<'tools:call-tool'>): ApprovalContext | undefined {
    const { toolContext } = flowCtx.state;
    const ctx = toolContext?.tryGetContext?.();

    const inputContext = toolContext?.input?.['context'];
    const contextFromInput = this.isApprovalContext(inputContext) ? inputContext : undefined;

    const sessionContext = ctx?.authInfo?.extra?.['approvalContext'];
    const contextFromSession = this.isApprovalContext(sessionContext) ? sessionContext : undefined;

    return contextFromInput ?? contextFromSession;
  }

  private isApprovalContext(value: unknown): value is ApprovalContext {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      'identifier' in value &&
      typeof (value as ApprovalContext).type === 'string' &&
      typeof (value as ApprovalContext).identifier === 'string'
    );
  }

  private getStringExtra(extra: Record<string, unknown> | undefined, key: string): string | undefined {
    if (!extra) return undefined;
    const value = extra[key];
    return typeof value === 'string' ? value : undefined;
  }

  private isPreApprovedContext(config: ToolApprovalRequirement, currentContext: ApprovalContext | undefined): boolean {
    if (!currentContext || !config.preApprovedContexts?.length) {
      return false;
    }

    return config.preApprovedContexts.some(
      (preApproved) => preApproved.type === currentContext.type && preApproved.identifier === currentContext.identifier,
    );
  }

  private async handleApprovalRequired(
    flowCtx: FlowCtxOf<'tools:call-tool'>,
    config: ToolApprovalRequirement,
    existingApproval: ApprovalRecord | undefined,
  ): Promise<void> {
    const { tool } = flowCtx.state;
    const message = config.approvalMessage ?? `Tool "${tool?.fullName}" requires approval to execute. Allow?`;
    const isExpiredApproval = existingApproval ? this.isExpired(existingApproval) : false;

    throw new ApprovalRequiredError({
      toolId: tool?.fullName ?? 'unknown',
      state: isExpiredApproval ? 'expired' : 'pending',
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
