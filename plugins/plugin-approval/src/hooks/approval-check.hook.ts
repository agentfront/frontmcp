/**
 * Hook plugin that checks tool approval before execution.
 *
 * @module @frontmcp/plugin-approval
 */

import { DynamicPlugin, isEntryGatedBy, Plugin, ScopeEntry, ToolHook, type FlowCtxOf } from '@frontmcp/sdk';

import { ApprovalRequiredError } from '../approval';
import { resolveApprovalIdentity } from '../approval.identity';
import { ApprovalStoreToken } from '../approval.symbols';
import { isApprovalExpired, isApprovalUsable, resolveApprovalRequirement } from '../approval/policy';
import type { ApprovalStore } from '../stores/approval-store.interface';
import { ApprovalState, type ApprovalContext, type ApprovalRecord, type ToolApprovalRequirement } from '../types';

type CallToolState = FlowCtxOf<'tools:call-tool'>['state'];
type GatedTool = NonNullable<CallToolState['tool']>;

/**
 * The calls already decided. Every approval gate that covers a tool reaches the same decision, over
 * the same stores, so the first one to run decides the call and the others let it be.
 */
const decidedCalls = new WeakSet<object>();

/** An approval or denial, with the store that holds it. */
interface StoredApproval {
  readonly store: ApprovalStore;
  readonly record: ApprovalRecord;
}

/**
 * Hook plugin that checks tool approval before execution.
 *
 * `ApprovalPlugin` registers it, so it never needs to be listed on its own.
 * Priority 100 ensures this runs early (before cache at 1000).
 */
@Plugin({
  name: 'approval:check',
  description: 'Checks tool approval state before execution',
  // A server where a tool or agent declares `approval` and this gate does not reach it refuses to start.
  enforcesMetadata: ['approval'],
})
export default class ApprovalCheckPlugin extends DynamicPlugin<Record<string, never>> {
  /**
   * Check tool approval before execution.
   *
   * Runs for the tools of the app the plugin is installed on and, `appliesTo: 'uncovered-apps'`,
   * for the tools of any app with no approval gate of its own, so an `approval` tool is never left
   * ungated because the plugin sits on a different app.
   *
   * A tool more than one gate covers (an `ApprovalPlugin` on the server and one on the tool's app)
   * is decided once, over all their stores: an approval in any of them lets it run, a denial in any
   * of them refuses it. It used to need an approval in each store (#678), so a grant through
   * `this.approval`, which writes to one of them, never let it run.
   */
  @ToolHook.Will('execute', { priority: 100, appliesTo: 'uncovered-apps' })
  async checkApproval(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool, toolContext } = flowCtx.state;
    if (!tool || !toolContext) return;

    // Get approval config from tool metadata (if it exists)
    const metadata = tool.metadata as unknown as Record<string, unknown>;
    const approvalConfig = resolveApprovalRequirement(
      metadata['approval'] as ToolApprovalRequirement | boolean | undefined,
    );

    if (!approvalConfig.required) {
      return;
    }

    if (approvalConfig.skipApproval) {
      return;
    }

    if (decidedCalls.has(toolContext)) return;

    await this.enforceApproval(flowCtx, tool, toolContext, approvalConfig, this.coveringStores(tool));
    decidedCalls.add(toolContext);
  }

  private async enforceApproval(
    flowCtx: FlowCtxOf<'tools:call-tool'>,
    tool: GatedTool,
    toolContext: NonNullable<CallToolState['toolContext']>,
    approvalConfig: ToolApprovalRequirement,
    stores: readonly ApprovalStore[],
  ): Promise<void> {
    const { sessionId, userId } = resolveApprovalIdentity(toolContext.tryGetContext?.());
    const currentContext = this.getCurrentContext(flowCtx);
    const stored: StoredApproval[] = [];
    for (const store of stores) {
      const records = await this.readApprovals(store, tool.fullName, sessionId, userId, currentContext);
      stored.push(...records.map((record) => ({ store, record })));
    }
    const records = stored.map(({ record }) => record);

    // A recorded denial outranks every way of skipping the prompt, pre-approved contexts included.
    if (records.some((record) => record.state === ApprovalState.DENIED)) {
      throw new ApprovalRequiredError({
        toolId: tool.fullName,
        state: 'denied',
        message: `Tool "${tool.fullName}" execution denied.`,
      });
    }

    if (this.isPreApprovedContext(approvalConfig, currentContext)) {
      return;
    }

    const approved = records.filter((record) => record.state === ApprovalState.APPROVED);

    // Only an approval the tool's policy accepts opens the gate: a scope in `allowedScopes`, and
    // not older than `maxTtlMs`, however it was recorded.
    const now = Date.now();
    const usable = stored.filter(({ record }) => isApprovalUsable(record, approvalConfig, now));

    if (approvalConfig.alwaysPrompt) {
      // Every call needs an approval of its own: one lets exactly this call through and is used up
      // by it, so the next call prompts again. This refused every call, approved or not (#678).
      for (const { store, record } of usable) {
        if (await this.consumeApproval(store, record, sessionId, userId, currentContext)) return;
      }
    } else if (usable.length > 0) {
      return;
    }

    await this.handleApprovalRequired(
      flowCtx,
      approvalConfig,
      approved.find((record) => isApprovalExpired(record, approvalConfig, now)) ?? approved[0],
    );
  }

  /**
   * The stores of every approval gate that runs for the tool: this plugin's, and that of each other
   * `ApprovalCheckPlugin` whose hook the scope runs for it (an `ApprovalPlugin` on the server and
   * one on the tool's app, say). One store shared by two gates counts once.
   */
  private coveringStores(tool: GatedTool): ApprovalStore[] {
    const stores = new Set<ApprovalStore>([this.get(ApprovalStoreToken) as ApprovalStore]);

    let scope: ScopeEntry | undefined;
    try {
      scope = this.get(ScopeEntry) as ScopeEntry | undefined;
    } catch {
      scope = undefined;
    }
    if (!scope?.hooks) return [...stores];

    for (const hook of scope.hooks.getFlowHooks('tools:call-tool')) {
      const gate = hook.metadata.target;
      if (gate instanceof ApprovalCheckPlugin && isEntryGatedBy(scope, { tool }, gate)) {
        stores.add(gate.get(ApprovalStoreToken) as ApprovalStore);
      }
    }
    return [...stores];
  }

  /**
   * Use up an approval of an `alwaysPrompt` tool, reporting whether this call got it.
   *
   * `consumeApproval()` deletes exactly that record, and only one of two calls racing for it wins.
   * A store without it has the caller's approvals of the tool revoked instead, which leaves none
   * standing but cannot tell two concurrent calls apart.
   */
  private async consumeApproval(
    store: ApprovalStore,
    record: ApprovalRecord,
    sessionId: string,
    userId: string | undefined,
    context: ApprovalContext | undefined,
  ): Promise<boolean> {
    if (store.consumeApproval) {
      return store.consumeApproval(record, sessionId, userId, context);
    }
    return store.revokeApproval({
      toolId: record.toolId,
      sessionId,
      userId,
      revokedBy: 'system',
      reason: 'Used by a call of an alwaysPrompt tool',
    });
  }

  /**
   * The caller's approvals and denials of the tool, from the context it runs in too. Stores
   * without `getApprovals()` give the one record `getApproval()` picks.
   */
  private async readApprovals(
    store: ApprovalStore,
    toolId: string,
    sessionId: string,
    userId: string | undefined,
    context: ApprovalContext | undefined,
  ): Promise<ApprovalRecord[]> {
    if (store.getApprovals) {
      return store.getApprovals(toolId, sessionId, userId, context);
    }
    const record = await store.getApproval(toolId, sessionId, userId, context);
    return record ? [record] : [];
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
    const isExpiredApproval = existingApproval ? isApprovalExpired(existingApproval, config, Date.now()) : false;

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
