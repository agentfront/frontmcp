// file: libs/plugins/src/codecall/tools/execute.tool.ts

import { getCallSurface, toMcpError, Tool, ToolContext, type McpError, type ToolEntry } from '@frontmcp/sdk';
import { escapeControlCharacters, randomUUID, sha256Hex } from '@frontmcp/utils';

import { budgetMeterOf, withBudgets, type BudgetMeter } from '../budgets/budget-meter';
import { CodeCallBudgetStoreToken } from '../budgets/budget-store';
import type { CodeCallToolDescription, CodeCallVmEnvironment } from '../codecall.symbol';
import {
  createPublicToolCallError,
  createToolCallError,
  TOOL_CALL_ERROR_CODES,
  type CallToolOptions,
  type ToolCallError,
  type ToolCallErrorCode,
  type ToolCallResult,
} from '../errors';
import type { KeptValueCalls } from '../kept-values/kept-value-calls';
import { keptNamesOf } from '../kept-values/kept-value-script';
import { KeptValueStoreToken } from '../kept-values/kept-value.types';
import CodeCallConfig, { extractionThresholdOf } from '../providers/code-call.config';
import {
  approvalAnswerSchema,
  approvalQuestionOf,
  clientCanElicit,
  MAX_APPROVALS_ASKED,
} from '../review/approval-elicitation';
import {
  approvalsOf,
  createRunReview,
  effectsSoFarOf,
  reviewContextOf,
  type RunReviewCaller,
} from '../review/create-run-review';
import { ApprovalServiceViewToken } from '../review/review-approvals';
import { reviewDecisionOf, reviewResultOf } from '../review/review-result';
import CodeCallReviewService from '../review/review.service';
import { reviewOutcomeOf, type PendingApproval, type RunReview } from '../review/run-review';
import { withCallIdempotencyKey, type ScriptToolCall } from '../runs/call-idempotency-key';
import { markInputRefusal, trackCallStage } from '../runs/call-stage';
import { journalMetadataOf, jsonBytes, RunJournal } from '../runs/run-journal';
import { pausedAnswerOf, pausedRunOf, pendingCallOf, resumeSourceOf, type PausedRun } from '../runs/run-pause';
import type { CodeCallRunInput, CodeCallRunStore } from '../runs/run-record.store';
import { CodeCallRunStoreToken } from '../runs/run-record.types';
import { RUN_DIVERGED, RunReplay, type RunReplaySource } from '../runs/run-replay';
import { RunSpans, RunTelemetryToken } from '../runs/run-spans';
import { traceOf } from '../runs/run-trace';
import {
  asCodeCallDispatch,
  assertNotSelfReference,
  checkCodeCallToolAccess,
  checkCodeCallToolPolicy,
  isBlockedSelfReference,
  readCodeCallPolicyConfig,
  toCodeCallPolicyTool,
  type CodeCallToolAccess,
} from '../security';
import { toolsWithheldByAuthorities } from '../security/codecall-discovery-authorities';
import { AuditLoggerService } from '../services/audit-logger.service';
import EnclaveService from '../services/enclave.service';
import { buildToolNamespaces, extractResultFromCallToolResult, toPlainJson } from '../utils';
import { toClientErrorMessage } from '../utils/client-error-message';
import {
  executeToolDescription,
  executeToolInputSchema,
  executeToolOutputSchema,
  type CodeCallExecuteResult,
  type ExecuteToolInput,
} from './execute.schema';

/** A paused run that `codecall:resume` runs again: its first start, and what it replays. */
export interface ResumedRun {
  startedAt: string;
  source: RunReplaySource;
}

/** One run of the script, with its journal and, when they are on, its review and its budgets. */
interface ReviewedAttempt {
  result: CodeCallExecuteResult;
  journal: RunJournal;
  review?: RunReview;
  budgets?: BudgetMeter;
}

/** The approval a stopped run waits for: the one its result names, from its budgets or its review. */
function pendingApprovalOf({ result, review, budgets }: ReviewedAttempt): PendingApproval | undefined {
  const approvalId = result.status === 'needs_approval' ? result.approval?.id : undefined;
  if (!approvalId) return undefined;
  const pendings = [...(budgets?.pendingApprovals ?? []), review?.pendingApproval];
  return pendings.find((pending) => pending?.reference.id === approvalId);
}

/**
 * The code of a failed tool call, from the error's type and code. Its message is never read: a tool's own
 * `User u9 not found` is not a missing tool, and "timeout" or "validation" in a message are not those failures.
 */
function getErrorCode(error: unknown, clientError: McpError): ToolCallErrorCode {
  if (error instanceof Error && error.name === 'ZodError') {
    return TOOL_CALL_ERROR_CODES.VALIDATION;
  }
  switch (clientError.code) {
    case 'INVALID_INPUT':
      return TOOL_CALL_ERROR_CODES.VALIDATION;
    case 'TOOL_NOT_FOUND':
      return TOOL_CALL_ERROR_CODES.NOT_FOUND;
    case 'EXECUTION_TIMEOUT':
      return TOOL_CALL_ERROR_CODES.TIMEOUT;
    // A remote FrontMCP tool's limit refusal is a result with its code, without the 429 status
    case 'RATE_LIMIT_EXCEEDED':
    case 'QUOTA_EXCEEDED':
    case 'CONCURRENCY_LIMIT':
    case 'QUEUE_TIMEOUT':
      return TOOL_CALL_ERROR_CODES.RATE_LIMITED;
  }
  return clientError.statusCode === 429 ? TOOL_CALL_ERROR_CODES.RATE_LIMITED : TOOL_CALL_ERROR_CODES.EXECUTION;
}

/** The failed call as the script sees it: the message an MCP client would be told, or the code's generic one for an internal error. */
function toolCallErrorOf(error: unknown, toolName: string): ToolCallError {
  const clientError = toMcpError(error);
  const code = getErrorCode(error, clientError);
  return clientError.isPublic
    ? createPublicToolCallError(code, toolName, clientError.getPublicMessage())
    : createToolCallError(code, toolName);
}

/** The run of a script, shared by `codecall:execute` and `codecall:resume`: its review, journal, record and answer. */
export abstract class CodeCallScriptTool extends ToolContext {
  /** The id of this call's run: its record's, and what each call's idempotency key is derived from. */
  protected scriptRunId: string = randomUUID();

  /**
   * Resolve the server-side CodeCall policy for a tool name (GHSA-6w3j-82v5-6qrr).
   *
   * Shares its decision with discovery and with `codecall:invoke`, so the three cannot
   * diverge. A name matching no registered tool is denied rather than passed through —
   * otherwise it would skip every metadata-driven check and reach `tools:call-tool`
   * unexamined.
   */
  private checkToolPolicy(name: string, surface: string | undefined): CodeCallToolAccess<ToolEntry> {
    return checkCodeCallToolAccess<ToolEntry>(this.scope, this.get(CodeCallConfig), name, { surface });
  }

  /** Runs the script, or replays a paused run of it, keeps the run's record, paused when it stopped before a call. */
  protected async runAndKeep(input: ExecuteToolInput, resumed?: ResumedRun): Promise<CodeCallExecuteResult> {
    const { resolvedVm, trace } = this.get(CodeCallConfig).getAll();
    const scriptHash = sha256Hex(input.script);
    const runs = this.tryGet(CodeCallRunStoreToken);
    const spans = this.startRunSpans(scriptHash, resolvedVm.runtime);
    const keepResults = runs?.keepsResultsOf(this) === true;
    const newJournal = (source: RunReplaySource | undefined) =>
      new RunJournal({
        keepResults,
        keepValues: trace.values,
        observer: spans,
        replay: keepResults ? new RunReplay(source) : undefined,
      });
    const startedAt = resumed ? new Date(resumed.startedAt) : new Date();
    let attempt: ReviewedAttempt | undefined;
    let run: CodeCallRunInput | undefined;
    let runId: string | undefined;
    try {
      attempt = await this.runApproved(input, scriptHash, newJournal, resumed?.source);
      const { result, journal, review, budgets } = attempt;
      run = {
        scriptHash,
        status: result.status,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        runId: this.scriptRunId,
        reviewDecision: review || budgets ? reviewDecisionOf(result) : null,
        ...(result.status === 'ok' && { resultBytes: jsonBytes(result.result) }),
        journal: journalMetadataOf(journal.close()),
      };
      const paused = runs && this.pausedRunOf(runs, run, result.status, journal, input);
      run = paused?.run ?? run;
      runId = runs ? await this.keepRun(runs, run, paused?.ttlSeconds) : undefined;
      const traceLines = traceOf(result.status, journal, trace);
      if ((review || budgets) && 'findings' in result && result.findings) spans?.recordFindings(result.findings);
      const kept = keptNamesOf(run.journal);
      const pausedAnswer = runId && run.pause && { paused: pausedAnswerOf(run.pause) };
      return {
        ...result,
        ...(runId && { runId }),
        ...pausedAnswer,
        ...(kept.length > 0 && { kept }),
        ...(traceLines && { trace: traceLines }),
      };
    } finally {
      attempt?.journal.close();
      spans?.end(run, runId);
    }
  }

  /**
   * Runs the script, and each time a person approves, through elicitation, the call it stopped at, resumes it from that
   * call, replaying the attempt that stopped (or runs it again from `source` when it could not pause there). Without
   * `review` or `budgets`, or without a client that can ask, it runs once.
   */
  private async runApproved(
    input: ExecuteToolInput,
    scriptHash: string,
    newJournal: (source: RunReplaySource | undefined) => RunJournal,
    source: RunReplaySource | undefined,
  ): Promise<ReviewedAttempt> {
    const reviewService = this.tryGet(CodeCallReviewService);
    const approvedByPerson = new Set<string>();
    const approvesCalls = reviewService !== undefined || this.tryGet(CodeCallBudgetStoreToken) !== undefined;
    const canElicit = approvesCalls && clientCanElicit(this.scope, this.tryGetContext());
    let replayed = source;
    let attempt = await this.attemptRun(
      input,
      scriptHash,
      newJournal(replayed),
      reviewService,
      approvedByPerson,
      canElicit,
    );
    for (let asked = 0; canElicit && asked < MAX_APPROVALS_ASKED; asked++) {
      const pending = pendingApprovalOf(attempt);
      if (attempt.result.status !== 'needs_approval' || !pending) break;
      const answer = await this.elicit(approvalQuestionOf(attempt.result.reason, pending), approvalAnswerSchema);
      if (answer.status !== 'accept' || answer.content?.approve !== true) {
        return {
          ...attempt,
          result: { status: 'denied', reason: `${attempt.result.reason}; the person did not approve it` },
        };
      }
      approvedByPerson.add(pending.reference.id);
      const pendingCall = pendingCallOf(attempt.result.status, attempt.journal);
      if (pendingCall) replayed = resumeSourceOf(attempt.journal, pendingCall, replayed);
      attempt.journal.close();
      attempt = await this.attemptRun(
        input,
        scriptHash,
        newJournal(replayed),
        reviewService,
        approvedByPerson,
        canElicit,
      );
    }
    return attempt;
  }

  private async attemptRun(
    input: ExecuteToolInput,
    scriptHash: string,
    journal: RunJournal,
    reviewService: CodeCallReviewService | undefined,
    approvedByPerson: Set<string>,
    canElicit: boolean,
  ): Promise<ReviewedAttempt> {
    const caller: RunReviewCaller = {
      scope: this.scope,
      config: this.get(CodeCallConfig),
      authInfo: this.authInfo,
      surface: getCallSurface(),
      allowedTools: input.allowedTools ? new Set(input.allowedTools) : undefined,
      approvalService: this.tryGet(ApprovalServiceViewToken),
      canElicit,
      granted: approvedByPerson,
      journal,
    };
    const review = reviewService ? await createRunReview(reviewService, caller, scriptHash) : undefined;
    const approval = {
      approvals: approvalsOf(caller, scriptHash, reviewService),
      grantedByPerson: approvedByPerson,
      canApprove: caller.approvalService !== undefined || canElicit,
      effectsSoFar: effectsSoFarOf(caller),
    };
    const budgets = budgetMeterOf(this.tryGet(CodeCallBudgetStoreToken), this, approval, this.logger);
    const result = await this.runScript(input, journal, review, budgets);
    return { result, journal, review, budgets };
  }

  /** The run's spans while observability traces requests, else none. */
  private startRunSpans(scriptHash: string, runtime: string): RunSpans | undefined {
    const telemetry = this.tryGet(RunTelemetryToken);
    if (!telemetry) return undefined;
    const runSpan = telemetry.startSpan('codecall run', {
      'codecall.script.hash': scriptHash,
      'codecall.vm.runtime': runtime,
    });
    return new RunSpans(runSpan);
  }

  /** `keep` and `recall` for this caller, while `keep.enabled` is true. */
  private keptValueCalls(): KeptValueCalls | undefined {
    const { sidecar } = this.get(CodeCallConfig).getAll();
    return this.tryGet(KeptValueStoreToken)?.callsFor(this, {
      referenceThreshold: sidecar.enabled ? extractionThresholdOf(sidecar) : undefined,
      logger: this.logger,
    });
  }

  /** The run saved `paused`, when it stopped before a call it can resume at and its record fits whole. */
  private pausedRunOf(
    runs: CodeCallRunStore,
    run: CodeCallRunInput,
    answer: CodeCallExecuteResult['status'],
    journal: RunJournal,
    input: ExecuteToolInput,
  ): PausedRun | undefined {
    if (!journal.replay) return undefined;
    const paused = pausedRunOf(run, answer, journal, input, this.get(CodeCallConfig).getAll().runs.pause);
    return paused && runs.fitsWhole(this, paused.run) ? paused : undefined;
  }

  /** Keeps the run's record for its owner; a store that fails is logged, and the result goes out without a run id. */
  private async keepRun(
    runs: CodeCallRunStore,
    run: CodeCallRunInput,
    ttlSeconds?: number,
  ): Promise<string | undefined> {
    try {
      return await runs.keep(this, run, ttlSeconds);
    } catch (error: unknown) {
      this.logger?.warn('codecall: could not keep the run record', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async runScript(
    input: ExecuteToolInput,
    journal: RunJournal,
    review?: RunReview,
    budgets?: BudgetMeter,
  ): Promise<CodeCallExecuteResult> {
    const { script, allowedTools } = input;

    // The script acts for the client that called this tool, so every tool it reaches is judged,
    // and run, for that call's surface. Read now: the script's callbacks run later.
    const callerSurface = getCallSurface();

    // `tryGet`, not `get`: audit must never be load-bearing. An unregistered service leaves the
    // execution path untouched rather than failing the call.
    const audit = this.tryGet(AuditLoggerService);
    const executionId = audit ? audit.generateExecutionId() : '';

    // Every tool call a script makes happens at depth 1. A script cannot re-enter CodeCall:
    // `assertNotSelfReference` and the policy's `codecall:` denial both refuse it, and the
    // namespaced bindings delegate to this same closure rather than nesting.
    const callDepth = 1;
    let toolCallCount = 0;

    // Set up the VM environment with tool integration
    const allowedToolSet = allowedTools ? new Set(allowedTools) : null;
    // `getTool` answers synchronously, so the tools the caller's authorities withhold are judged now.
    const withheld = await toolsWithheldByAuthorities(this.scope, this.authInfo);

    const environment: CodeCallVmEnvironment = {
      callTool: async <TInput, TResult>(
        name: string,
        toolInput: TInput,
        options?: CallToolOptions,
        call?: ScriptToolCall,
      ): Promise<TResult | ToolCallResult<TResult>> => {
        const throwOnError = options?.throwOnError !== false; // Default: true

        // ============================================================
        // SECURITY LAYER 1: Self-reference blocking (FIRST CHECK)
        // This MUST be the first check - no exceptions, no try/catch
        // ============================================================
        // Audited before the assert, not around it: the guard below is deliberately outside any
        // try/catch and must stay that way.
        if (isBlockedSelfReference(name)) {
          audit?.logSecuritySelfReference(executionId, name);
        }
        assertNotSelfReference(name);

        // ============================================================
        // SECURITY LAYER 2: Server-side access policy (GHSA-6w3j-82v5-6qrr)
        //
        // This is the authorization boundary. It must run here and not only in
        // discovery: a script names a tool as a bare string, so a tool merely
        // hidden from search results is still reachable by name.
        // ============================================================
        const decision = this.checkToolPolicy(name, callerSurface);
        if (!decision.allowed) {
          audit?.logSecurityAccessDenied(executionId, name, decision.reason);
          const error = createToolCallError(TOOL_CALL_ERROR_CODES.ACCESS_DENIED, name, decision.reason);
          if (throwOnError) {
            throw error;
          }
          return { success: false, error };
        }

        // ============================================================
        // SECURITY LAYER 3: Caller-supplied allow-list — NARROWING ONLY
        //
        // `allowedTools` comes from the same request as the script, so it can
        // only ever tighten what the server already permits. It is applied
        // after the policy above, never instead of it.
        // ============================================================
        if (allowedToolSet && !allowedToolSet.has(name)) {
          audit?.logSecurityAccessDenied(executionId, name, 'not in the caller-supplied allowedTools list');
          const error = createToolCallError(TOOL_CALL_ERROR_CODES.ACCESS_DENIED, name);
          if (throwOnError) {
            throw error;
          }
          return { success: false, error };
        }

        // ============================================================
        // Tool execution through the proper flow system
        // This ensures hooks, validation, quota, and all middleware run
        // ============================================================
        toolCallCount += 1;
        audit?.logToolCallStart(executionId, name, callDepth);
        const toolCallStartedAt = Date.now();
        const budgetedCall = budgets?.startCall({ toolName: name, args: toolInput, callIndex: call?.callIndex });
        let failedInputValidation = (): boolean => false;

        try {
          // Build MCP-compatible CallToolRequest
          const request = {
            method: 'tools/call' as const,
            params: {
              name,
              arguments: toolInput as Record<string, unknown>,
            },
          };

          // Build context with auth info and the caller's surface, marked as CodeCall's own call,
          // which may reach a tool CodeCall hides from a client's direct tools/call, and with its idempotency key
          const ctx = withCallIdempotencyKey(
            asCodeCallDispatch({ authInfo: this.authInfo, surface: callerSurface, ...budgetedCall?.dispatch }),
            this.scriptRunId,
            call,
          );
          failedInputValidation = trackCallStage(ctx);

          // Execute through the flow system - this runs all stages:
          // PRE: parseInput → findTool → createToolCallContext → acquireQuota → acquireSemaphore
          // EXECUTE: validateInput → execute → validateOutput
          // FINALIZE: releaseSemaphore → releaseQuota → finalize
          const mcpResult = await this.scope.runFlow('tools:call-tool', { request, ctx });
          await budgetedCall?.end();

          if (!mcpResult) {
            audit?.logToolCallFailure(
              executionId,
              name,
              callDepth,
              Date.now() - toolCallStartedAt,
              TOOL_CALL_ERROR_CODES.EXECUTION,
            );
            const error = createToolCallError(TOOL_CALL_ERROR_CODES.EXECUTION, name, 'Flow returned no result');
            if (throwOnError) {
              throw error;
            }
            return { success: false, error };
          }

          // Extract the actual result from MCP CallToolResult format
          const result = extractResultFromCallToolResult(mcpResult);

          audit?.logToolCallSuccess(executionId, name, callDepth, Date.now() - toolCallStartedAt);

          // Success path
          if (throwOnError) {
            return result as TResult;
          }
          return { success: true, data: result as TResult };
        } catch (error: unknown) {
          await budgetedCall?.end();
          // ============================================================
          // Error sanitization - NEVER expose internal details
          // ============================================================

          const sanitizedError = toolCallErrorOf(error, name);
          if (failedInputValidation()) markInputRefusal(sanitizedError);

          audit?.logToolCallFailure(executionId, name, callDepth, Date.now() - toolCallStartedAt, sanitizedError.code);

          if (throwOnError) {
            // Throw sanitized error (no stack trace, no internal details)
            throw sanitizedError;
          }
          return { success: false, error: sanitizedError };
        }
      },

      getTool: (name: string) => {
        try {
          // Introspection follows the same visibility rules as callTool: CodeCall's own tools
          // are never described, and a script that declared a whitelist only sees those tools.
          if (isBlockedSelfReference(name)) {
            audit?.logSecuritySelfReference(executionId, name);
            return undefined;
          }
          // A tool the policy withholds must not leak its description or schemas either
          // (GHSA-6w3j-82v5-6qrr) — describe is a discovery surface like search.
          // Denials are audited here too: a script sweeping getTool across many names is
          // reconnaissance, and it is the one place that pattern is visible.
          const introspectionAccess = this.checkToolPolicy(name, callerSurface);
          if (!introspectionAccess.allowed) {
            audit?.logSecurityAccessDenied(executionId, name, introspectionAccess.reason);
            return undefined;
          }
          if (allowedToolSet && !allowedToolSet.has(name)) return undefined;

          // Describe the entry the policy judged, resolved as `callTool` would resolve it.
          const tool = introspectionAccess.entry;
          if (withheld.has(tool.fullName)) {
            audit?.logSecurityAccessDenied(executionId, name, "withheld by the tool's authorities");
            return undefined;
          }

          return toPlainJson<CodeCallToolDescription>({
            name: tool.name,
            description: tool.metadata?.description,
            inputSchema: tool.getInputJsonSchema?.() ?? null,
            outputSchema: tool.getOutputJsonSchema?.() ?? null,
          });
        } catch {
          return undefined;
        }
      },

      mcpLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>) => {
        // A script's message stays on one line of the server's log.
        this.logger?.[level](escapeControlCharacters(String(message)), metadata);
      },

      mcpNotify: (event: string, payload: Record<string, unknown>) => {
        // Send notifications through FrontMCP notification system if available
        this.logger?.debug('Notification sent', { event, payload });
      },

      keptValues: this.keptValueCalls(),
    };

    // Build namespaced bindings for AgentScript ergonomics. Tools named
    // `${ns}.${method}` become `await ns.method(args)` instead of
    // `await callTool('ns.method', args)`. The sandbox builds them (`toolNamespaces`): a method
    // call is exactly a `callTool()` inside the sandbox, so it passes the enclave's call cap,
    // rate limit and sequence checks, then this same `callTool` closure above, and returns the
    // same `{ throwOnError: false }` results. Only tools the policy allows get a binding, so the
    // bindings do not enumerate withheld tool names.
    try {
      const policyConfig = readCodeCallPolicyConfig(this.get(CodeCallConfig));
      const callableTools = this.scope.tools
        .getTools(true)
        .filter(
          (tool) => checkCodeCallToolPolicy(toCodeCallPolicyTool(tool, undefined, this.scope), policyConfig).allowed,
        );
      const { namespaces, skipped } = buildToolNamespaces(callableTools);
      environment.toolNamespaces = namespaces;
      if (skipped.length > 0) {
        this.logger?.debug?.('codecall: tools skipped during namespace generation', {
          count: skipped.length,
          // Cap the debug payload so a huge skip list doesn't bloat logs.
          sample: skipped.slice(0, 25),
        });
      }
    } catch (error: unknown) {
      // Namespace building is best-effort — failures must not break execution.
      // Backward compat is preserved because callTool() always works.
      this.logger?.warn?.('codecall: failed to build tool namespaces', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Get the enclave service and config
    const enclaveService = this.get(EnclaveService);
    const config = this.get(CodeCallConfig);

    // Our own clock. `mapEnclaveResult` drops `stats` on two of its four branches, and the
    // tool-error branch is reachable WITH `timedOut: true` -- so the enclave's own duration is
    // undefined on precisely the timeout case this needs to report.
    const startedAt = Date.now();
    const elapsed = (reported?: number): number => reported ?? Date.now() - startedAt;

    audit?.logExecutionStart(executionId, script);

    const hooks = withBudgets(review?.hooks, budgets);

    try {
      const executionResult = await enclaveService.execute(
        script,
        environment,
        journal,
        hooks && { hooks, context: reviewContextOf(this, callerSurface) },
      );
      const durationMs = elapsed(executionResult.stats?.duration);

      const reviewOutcome =
        executionResult.review && executionResult.error?.code !== RUN_DIVERGED
          ? reviewOutcomeOf(executionResult.review.decisions, executionResult.error)
          : undefined;
      if (reviewOutcome) {
        audit?.logExecutionFailure(executionId, script, durationMs, `review: ${reviewOutcome.status}`);
        const pending = budgets?.pendingApprovalAt(reviewOutcome.callIndex) ?? review?.pendingApproval;
        return reviewResultOf(reviewOutcome, pending);
      }

      // Map execution result to CodeCall result
      if (executionResult.timedOut) {
        audit?.logExecutionTimeout(executionId, script, durationMs);
        // A tool that was still running when the script ended may yet complete: say so, since
        // nothing rolls its effects back.
        const pending = executionResult.stats?.pendingToolCalls ?? 0;
        return {
          status: 'timeout',
          error: {
            message:
              `Script execution timed out after ${config.getAll().resolvedVm.timeoutMs}ms` +
              (pending > 0
                ? ` (${pending} tool call${pending === 1 ? ' was' : 's were'} still running; ` +
                  'the script did not receive the result, and the effects are not rolled back)'
                : ''),
          },
        };
      }

      if (!executionResult.success) {
        const error = executionResult.error!;

        // A script that doesn't parse
        if (error.code === 'SYNTAX_ERROR') {
          audit?.logExecutionFailure(executionId, script, durationMs, error.message);
          return {
            status: 'syntax_error',
            error: {
              message: toClientErrorMessage(error.message) || 'Syntax error in script',
              ...(error.location ? { location: error.location } : {}),
            },
          };
        }

        // Check if it's a validation error (from AST validation)
        if (error.code === 'VALIDATION_ERROR' || error.name === 'ValidationError') {
          audit?.logSecurityAstBlocked(executionId, error.blockedPatterns?.join(', ') ?? 'UNKNOWN', error.message);
          audit?.logExecutionFailure(executionId, script, durationMs, error.message);
          return {
            status: 'illegal_access',
            error: {
              kind: 'IllegalBuiltinAccess',
              message: error.message,
            },
          };
        }

        // A failing tool ended the script (its error uncaught or rethrown)
        if (error.toolName) {
          audit?.logExecutionFailure(executionId, script, durationMs, error.message);
          return {
            status: 'tool_error',
            error: {
              source: 'tool',
              toolName: error.toolName,
              message: toClientErrorMessage(error.message),
              code: error.code,
              // No `details`: the enclave's error data is not sanitized for clients. No `toolInput`:
              // the arguments the tool saw may hold sidecar-resolved data the script never had.
            },
          };
        }

        // Otherwise it's a runtime error. No stack trace: it names server files and
        // dependencies, in every environment.
        audit?.logExecutionFailure(executionId, script, durationMs, error.message);
        return {
          status: 'runtime_error',
          error: {
            source: 'script',
            message: toClientErrorMessage(error.message),
            name: error.name,
          },
        };
      }

      // Success!
      audit?.logExecutionSuccess(executionId, script, durationMs, toolCallCount);
      return {
        status: 'ok',
        result: executionResult.result,
        logs: executionResult.logs.length > 0 ? executionResult.logs : undefined,
      };
    } catch (error: unknown) {
      // Type-safe error handling
      const errorName = error instanceof Error ? error.name : 'Error';
      const errorMessage = error instanceof Error ? error.message : String(error);

      // The enclave threw rather than returning a result, so there is no `stats` to prefer.
      audit?.logExecutionFailure(executionId, script, elapsed(), errorMessage);
      const errorLoc = (error as { loc?: { line: number; column: number } }).loc;

      // Check for syntax errors
      if (errorName === 'SyntaxError' || errorMessage?.includes('syntax')) {
        return {
          status: 'syntax_error',
          error: {
            message: toClientErrorMessage(errorMessage) || 'Syntax error in script',
            location: errorLoc ? { line: errorLoc.line, column: errorLoc.column } : undefined,
          },
        };
      }

      // Unexpected error during execution. No stack trace, as above.
      return {
        status: 'runtime_error',
        error: {
          source: 'script',
          message: toClientErrorMessage(errorMessage) || 'An unexpected error occurred during script execution',
          name: errorName,
        },
      };
    }
  }
}

@Tool({
  name: 'codecall:execute',
  cache: {
    ttl: 0, // No caching - each execution is unique
    slideWindow: false,
  },
  codecall: {
    enabledInCodeCall: false,
    visibleInListTools: true,
  },
  description: executeToolDescription,
  inputSchema: executeToolInputSchema,
  outputSchema: executeToolOutputSchema,
})
export default class ExecuteTool extends CodeCallScriptTool {
  async execute(input: ExecuteToolInput): Promise<CodeCallExecuteResult> {
    return this.runAndKeep(input);
  }
}
