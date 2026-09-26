/**
 * Hook plugin that checks tool approval before execution.
 *
 * @module @frontmcp/plugin-approval
 */

import { DynamicPlugin, Plugin, ToolHook, type FlowCtxOf } from '@frontmcp/sdk';

import { ApprovalRequiredError } from '../approval';
import { resolveApprovalIdentity } from '../approval.identity';
import { ApprovalStoreToken } from '../approval.symbols';
import type { ApprovalStore } from '../stores/approval-store.interface';
import {
  ApprovalScope,
  ApprovalState,
  type ApprovalContext,
  type ApprovalRecord,
  type ToolApprovalRequirement,
} from '../types';

type CallToolState = FlowCtxOf<'tools:call-tool'>['state'];

/** The stores each call already passed, so a store is checked once even when this plugin is also listed explicitly. */
const passedApprovalStores = new WeakMap<object, WeakSet<ApprovalStore>>();

/**
 * Hook plugin that checks tool approval before execution.
 *
 * `ApprovalPlugin` registers it, so it never needs to be listed on its own.
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

    const approvalStore = this.get(ApprovalStoreToken) as ApprovalStore;
    const passedStores = passedApprovalStores.get(toolContext) ?? new WeakSet<ApprovalStore>();
    if (passedStores.has(approvalStore)) return;

    await this.enforceApproval(flowCtx, tool, toolContext, approvalConfig, approvalStore);
    passedStores.add(approvalStore);
    passedApprovalStores.set(toolContext, passedStores);
  }

  private async enforceApproval(
    flowCtx: FlowCtxOf<'tools:call-tool'>,
    tool: NonNullable<CallToolState['tool']>,
    toolContext: NonNullable<CallToolState['toolContext']>,
    approvalConfig: ToolApprovalRequirement,
    approvalStore: ApprovalStore,
  ): Promise<void> {
    const { sessionId, userId } = resolveApprovalIdentity(toolContext.tryGetContext?.());
    const approval = await approvalStore.getApproval(tool.fullName, sessionId, userId);

    // A recorded denial outranks every way of skipping the prompt, pre-approved contexts included.
    if (approval?.state === ApprovalState.DENIED) {
      throw new ApprovalRequiredError({
        toolId: tool.fullName,
        state: 'denied',
        message: `Tool "${tool.fullName}" execution denied.`,
      });
    }

    if (this.isPreApprovedContext(approvalConfig, this.getCurrentContext(flowCtx))) {
      return;
    }

    if (approvalConfig.alwaysPrompt) {
      await this.handleApprovalRequired(flowCtx, approvalConfig, approval);
      return;
    }

    if (approval?.state === ApprovalState.APPROVED) {
      if (!this.isExpired(approval)) {
        return;
      }
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

  /**
   * The context this call is running in, as established by the SESSION (GHSA-r848-p7wf-96rc).
   *
   * Deliberately ignores `toolContext.input.context`. The only consumer of this value is
   * `isPreApprovedContext`, which skips the approval prompt outright, so reading it from the
   * arguments of the call being gated let a caller name its own pre-approved context and walk
   * straight past the gate. Only `authInfo.extra.approvalContext`, which the server sets
   * while authenticating, can say what context a call belongs to.
   */
  private getCurrentContext(flowCtx: FlowCtxOf<'tools:call-tool'>): ApprovalContext | undefined {
    const ctx = flowCtx.state.toolContext?.tryGetContext?.();
    const sessionContext = ctx?.authInfo?.extra?.['approvalContext'];

    return this.isApprovalContext(sessionContext) ? sessionContext : undefined;
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
