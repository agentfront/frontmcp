// file: libs/plugins/src/codecall/tools/invoke.tool.ts
import type { ReviewDecision } from '@enclave-vm/core/worker';

import type { CallToolResult } from '@frontmcp/protocol';
import { getCallSurface, Tool, ToolContext } from '@frontmcp/sdk';
import { sha256Hex } from '@frontmcp/utils';

import { budgetMeterOf, type BudgetMeter } from '../budgets/budget-meter';
import { CodeCallBudgetStoreToken } from '../budgets/budget-store';
import CodeCallConfig from '../providers/code-call.config';
import { approvalAnswerSchema, approvalQuestionOf, clientCanElicit } from '../review/approval-elicitation';
import { approvalsOf, createRunReview, reviewContextOf } from '../review/create-run-review';
import { ApprovalServiceViewToken } from '../review/review-approvals';
import { invocationScriptOf, reviewInvocation } from '../review/review-invocation';
import { reviewResultOf, type CodeCallReviewResult } from '../review/review-result';
import CodeCallReviewService from '../review/review.service';
import type { PendingApproval } from '../review/run-review';
import { asCodeCallDispatch, checkCodeCallToolAccess, isBlockedSelfReference } from '../security';
import { AuditLoggerService } from '../services/audit-logger.service';
import {
  invokeToolDescription,
  invokeToolInputSchema,
  type InvokeToolInput,
  type InvokeToolOutput,
} from './invoke.schema';

/**
 * Build an MCP error response in CallToolResult format.
 */
function buildErrorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/** What a review or the budgets decided for the call: a refusal, and the approval it waits for. */
interface InvocationDecision {
  refusal?: CodeCallReviewResult;
  pending?: PendingApproval;
}

/** The result for a budget's decision at the call, or undefined when it allows the call. */
function refusalOf(decision: ReviewDecision, pending?: PendingApproval): CodeCallReviewResult | undefined {
  if (decision.decision === 'allow') return undefined;
  const { decision: status, findings } = decision;
  const reason = 'reason' in decision ? decision.reason : undefined;
  return reviewResultOf({ status, reason, findings }, pending);
}

/** A refusal of the review, with its result as structured content too. */
function buildReviewResult(result: CodeCallReviewResult): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: true,
  };
}

/**
 * InvokeTool allows direct tool invocation without running JavaScript code.
 * Returns the same CallToolResult format as a standard MCP tool call.
 *
 * Security Considerations:
 * - Self-reference blocking: Cannot invoke codecall:* tools
 * - Shares the CodeCall access policy with `codecall:execute`, so a tool withheld from
 *   scripts is not reachable by naming it here instead (GHSA-6w3j-82v5-6qrr)
 * - All middleware (auth, PII, rate limiting) applies via normal tool execution
 */
@Tool({
  name: 'codecall:invoke',
  cache: {
    ttl: 0, // No caching - each invocation is unique
    slideWindow: false,
  },
  codecall: {
    enabledInCodeCall: false,
    visibleInListTools: true,
  },
  description: invokeToolDescription,
  inputSchema: invokeToolInputSchema,
})
export default class InvokeTool extends ToolContext {
  async execute(input: InvokeToolInput): Promise<InvokeToolOutput> {
    const { tool: toolName, input: toolInput } = input;

    const audit = this.tryGet(AuditLoggerService);
    const executionId = audit ? audit.generateExecutionId() : '';
    const startedAt = Date.now();

    // Security: Cannot invoke codecall:* tools to prevent recursion attacks
    if (isBlockedSelfReference(toolName)) {
      audit?.logSecuritySelfReference(executionId, toolName);
      return buildErrorResult(
        `Tool "${toolName}" cannot be invoked directly. CodeCall tools are internal and not accessible via codecall:invoke.`,
      );
    }

    // The same policy `codecall:execute` applies, plus the `directCalls` options. Without
    // it this tool is a plain proxy over the whole registry, and every CodeCall restriction
    // an operator configured is bypassed by invoking the tool directly.
    // One message for "denied" and for "no such tool": distinguishing them would turn this
    // tool into an existence oracle for the tools the policy hides from codecall:search.
    // CodeCall acts for the client that called this tool: that call's surface applies to the target.
    const surface = getCallSurface();
    const decision = checkCodeCallToolAccess(this.scope, this.get(CodeCallConfig), toolName, {
      directCall: true,
      surface,
    });
    if (!decision.allowed) {
      // The real reason is audited server-side even though the response deliberately does not
      // carry it -- the generic message above is what keeps this from being an existence oracle.
      audit?.logSecurityAccessDenied(executionId, toolName, decision.reason);
      return buildErrorResult(`Tool "${toolName}" is not available. Use codecall:search to discover available tools.`);
    }

    const reviewService = this.tryGet(CodeCallReviewService);
    const approvedOverBudget = new Set<string>();
    const approvals = approvalsOf(
      { authInfo: this.authInfo, approvalService: this.tryGet(ApprovalServiceViewToken), granted: approvedOverBudget },
      sha256Hex(invocationScriptOf(toolName, toolInput)),
      reviewService,
    );
    const budgets = budgetMeterOf(this.tryGet(CodeCallBudgetStoreToken), this, approvals, this.logger);
    const budgetRefusal = budgets && (await this.budgetRefusal(budgets, toolName, toolInput, approvedOverBudget));
    if (budgetRefusal) {
      audit?.logSecurityAccessDenied(executionId, toolName, `budget: ${budgetRefusal.status}`);
      return buildReviewResult(budgetRefusal);
    }

    const refusal = reviewService ? await this.review(reviewService, toolName, toolInput, surface) : undefined;
    if (refusal) {
      audit?.logSecurityAccessDenied(executionId, toolName, `review: ${refusal.status}`);
      return buildReviewResult(refusal);
    }

    // Execute through the flow system - returns standard CallToolResult
    // Flow handles: findTool, validation, quota, middleware, execution, error formatting
    const request = {
      method: 'tools/call' as const,
      params: {
        name: toolName,
        arguments: toolInput,
      },
    };

    const budgetedCall = budgets?.startCall();
    // The caller's surface goes along, so the flow judges the target for that caller as well. Marked as
    // CodeCall's own call, which may reach a tool CodeCall hides from a client's direct tools/call.
    const ctx = asCodeCallDispatch({
      authInfo: this.authInfo,
      surface,
      onRecordsChanged: budgetedCall?.onRecordsChanged,
    });

    // runFlow returns CallToolResult directly - no transformation needed
    const result = await this.scope.runFlow('tools:call-tool', { request, ctx }).catch(async (error: unknown) => {
      await budgetedCall?.end(error);
      throw error;
    });
    await budgetedCall?.end();

    // Flow returns null if tool not found or other pre-execution errors
    if (!result) {
      audit?.logInvoke(executionId, toolName, false, Date.now() - startedAt);
      return buildErrorResult(`Tool "${toolName}" not found. Use codecall:search to discover available tools.`);
    }

    // `success` is about the invocation reaching the tool, not about what the tool decided:
    // a tool returning `isError` was still invoked successfully.
    audit?.logInvoke(executionId, toolName, true, Date.now() - startedAt);
    return result;
  }

  /**
   * The server's review of the call, as of the one-call script it stands for: the same rules, reviewers and
   * approvals as `codecall:execute`. A client that can answer is asked once to approve a destructive call.
   */
  private async review(
    reviewService: CodeCallReviewService,
    toolName: string,
    toolInput: Record<string, unknown>,
    surface: string | undefined,
  ): Promise<CodeCallReviewResult | undefined> {
    const code = invocationScriptOf(toolName, toolInput);
    const canElicit = clientCanElicit(this.scope, this.tryGetContext());
    const approvedByPerson = new Set<string>();
    return this.askingApproval(approvedByPerson, async () => {
      const runReview = await createRunReview(
        reviewService,
        {
          scope: this.scope,
          config: this.get(CodeCallConfig),
          authInfo: this.authInfo,
          surface,
          directCall: true,
          approvalService: this.tryGet(ApprovalServiceViewToken),
          canElicit,
          granted: approvedByPerson,
        },
        sha256Hex(code),
      );
      const refusal = await reviewInvocation(runReview, code, reviewContextOf(this, surface));
      return { refusal, pending: runReview.pendingApproval };
    });
  }

  /** The budgets' answer for the call; a client that can answer is asked once to approve a call over a budget. */
  private budgetRefusal(
    budgets: BudgetMeter,
    toolName: string,
    toolInput: Record<string, unknown>,
    approvedByPerson: Set<string>,
  ): Promise<CodeCallReviewResult | undefined> {
    return this.askingApproval(approvedByPerson, async () => {
      const decision = await budgets.check(toolName, toolInput);
      return { refusal: refusalOf(decision, budgets.pendingApproval), pending: budgets.pendingApproval };
    });
  }

  /** What `decide` answers; when it waits for an approval the client can ask for, asked once and decided again. */
  private async askingApproval(
    approvedByPerson: Set<string>,
    decide: () => Promise<InvocationDecision>,
  ): Promise<CodeCallReviewResult | undefined> {
    const first = await decide();
    const canElicit = clientCanElicit(this.scope, this.tryGetContext());
    if (first.refusal?.status !== 'needs_approval' || !first.pending || !canElicit) return first.refusal;
    const answer = await this.elicit(approvalQuestionOf(first.refusal.reason, first.pending), approvalAnswerSchema);
    if (answer.status !== 'accept' || answer.content?.approve !== true) {
      return { status: 'denied', reason: `${first.refusal.reason}; the person did not approve it` };
    }
    approvedByPerson.add(first.pending.reference.id);
    return (await decide()).refusal;
  }
}
