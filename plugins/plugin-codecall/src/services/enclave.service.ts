// file: libs/plugins/src/codecall/services/enclave.service.ts

import type { ConsoleHandler, ReferenceSidecarOptions } from '@enclave-vm/core';
import type { ReviewContext, ReviewOptions, ReviewReport, ToolHandler } from '@enclave-vm/core/worker';

import { Provider, ProviderScope, type FrontMcpLogger } from '@frontmcp/sdk';

import type { CodeCallVmEnvironment, ResolvedCodeCallVmOptions } from '../codecall.symbol';
import type { CodeCallSidecarOptions } from '../codecall.types';
import { createPublicToolCallError, TOOL_CALL_ERROR_CODES } from '../errors';
import { isKeptValueCall } from '../kept-values/kept-value-script';
import type CodeCallConfig from '../providers/code-call.config';
import { extractionThresholdOf, MAX_ITERATIONS_PER_LOOP } from '../providers/code-call.config';
import { refusalsEndedWith } from '../review/run-review';
import { isRefusedBeforeTool } from '../runs/call-stage';
import { RunJournal } from '../runs/run-journal';
import { callOrReplay, journaledReviewHooks, replayedEnvironment, type RunReplay } from '../runs/run-replay';
import { findScriptPolicyIssues } from '../security/script-policy';
import { toSandboxToolNamespaces } from '../utils/build-tool-namespaces';
import { parallelFailuresOf } from '../utils/parallel-failure';
import { withScriptLines } from '../utils/script-lines';
import { countResultValues } from '../utils/value-count';
import {
  CodeCallRuntimeError,
  createDefaultRuntimes,
  runtimeSettingsOf,
  type CodeCallHostFunction,
  type CodeCallRunResult,
  type CodeCallRuntimeSettings,
  type CodeCallScriptRunner,
  type CodeCallScriptRunSpec,
  type CodeCallScriptRuntimes,
} from './runtime';
import { ExecutionGate } from './runtime/execution-gate';
import { ScriptConsoleLog } from './script-console';

/**
 * Result from enclave execution - maps to existing VmExecutionResult interface
 */
export interface EnclaveExecutionResult {
  success: boolean;
  result?: unknown;
  error?: {
    message: string;
    name: string;
    stack?: string;
    code?: string;
    toolName?: string;
    details?: unknown;
    /** For a script that doesn't parse (`code: 'SYNTAX_ERROR'`): where, in the script's own lines. */
    location?: { line: number; column: number };
    /**
     * Distinct AST-validation issue codes, for the `codecall:security:ast-blocked` audit event.
     *
     * The enclave reports structured `issues` alongside the human-readable message; this branch
     * used to discard them, which left the audit event with prose where a pattern belongs.
     */
    blockedPatterns?: string[];
    [key: string]: unknown;
  };
  logs: string[];
  timedOut: boolean;
  stats?: {
    duration: number;
    toolCallCount: number;
    iterationCount: number;
    /**
     * Tool calls that had started and not settled when the execution ended (set only when there
     * were any). The script no longer receives their results, but their effects are not rolled back.
     */
    pendingToolCalls?: number;
  };
  /** Every decision of the review hooks, when the run was reviewed. */
  review?: ReviewReport;
}

/** The review of one run: Enclave's hooks, and the caller they receive as `context`. */
export interface EnclaveRunReview {
  hooks: ReviewOptions;
  context: ReviewContext;
}

/**
 * A tool call the tool handler failed, kept to tell a script a failing tool ended from one that
 * failed itself. Not its arguments: the sandbox resolves sidecar references in them before the
 * handler sees them, so they may hold data the script itself never had.
 */
interface ToolFailure {
  toolName: string;
  name: string;
  message: string;
  code?: string;
  /** The call's position in the run, from 0. */
  callIndex?: number;
}

/**
 * The calls whose failure the script ended with, uncaught: the failure it threw (each call that failed with that name
 * and message), or the failures a failed `parallel()` it threw listed.
 */
function callsEndedWith(result: CodeCallRunResult, toolFailures: readonly ToolFailure[]): number[] {
  const reported = result.error;
  if (result.success || !reported) return [];
  const thrown = toolFailures.filter(
    (failure) => failure.message === reported.message && failure.name === reported.name,
  );
  const listed = thrown.length > 0 ? undefined : parallelFailuresOf(reported.message);
  const ended = listed ? toolFailures.filter((failure) => listed(failure.message)) : thrown;
  return ended.flatMap((failure) => (failure.callIndex === undefined ? [] : [failure.callIndex]));
}

/** A review record's call position, as a list: none for a record of the script. */
function callIndexOf(record: { callIndex?: number }): number[] {
  return record.callIndex === undefined ? [] : [record.callIndex];
}

/** The message the sandbox gives a script for an error the tool handler threw (as its tool bridge reads it). */
function toolFailureMessage(error: unknown, toolName: string): string {
  if (typeof error === 'string' && error) return error;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : `Tool call failed: ${toolName}`;
}

/**
 * The name the sandbox gives a script for an error the tool handler threw: the error's own `name`,
 * else `ToolError` (as its tool bridge reads it). A script's own throw is named apart from it: a
 * string or a nameless object is `DoubleVMExecutionError`, and AgentScript has no `Error`.
 */
function toolFailureName(error: unknown): string {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  return typeof name === 'string' && name ? name.slice(0, 128) : 'ToolError';
}

/** How the sandbox's messages for a loop that ran too often start; a `for` loop's names no count. */
const ITERATION_LIMIT_PREFIX = 'Maximum iteration limit exceeded';

/** One error for every loop that ran too often, as the sandbox reports a `for…of` loop's. */
const ITERATION_LIMIT_ERROR = {
  name: 'Error',
  message: `${ITERATION_LIMIT_PREFIX} (${MAX_ITERATIONS_PER_LOOP}). This limit prevents infinite loops.`,
};

/** The codes Enclave gives any error a script ends with: the script's own, and the refusals of a call it throws into it. */
const SCRIPT_ERROR_CODES = new Set(['DOUBLE_VM_EXECUTION_ERROR', 'VM_EXECUTION_ERROR']);

/** How Enclave's refusals of a call start, for an Enclave whose result does not name them: detectors, limits, an abort. */
const CALL_REFUSAL =
  /^(?:Suspicious pattern detected: |Operation rate limit exceeded |Operation ".*" (?:does not match allowed|matches blocked) pattern$|Maximum tool call limit exceeded|Execution aborted$)/;

/**
 * Whether Enclave stopped the script itself, never a tool: a timeout, a call it refused (from its result, or from its
 * error message where the result cannot say), or an error with a code of Enclave's own, the loop limit included.
 */
function stoppedBySandbox(
  result: CodeCallRunResult,
  mapped: EnclaveExecutionResult,
  reportsRefusals: boolean,
): boolean {
  const { error } = mapped;
  if (mapped.timedOut || result.refusedCall) return true;
  if (!error || error.toolName) return false;
  if (error.code !== undefined && !SCRIPT_ERROR_CODES.has(error.code)) return true;
  return error.message.startsWith(ITERATION_LIMIT_PREFIX) || (!reportsRefusals && CALL_REFUSAL.test(error.message));
}

/** `@enclave-vm/ast`'s message for a script that doesn't parse. */
const PARSE_FAILURE_PREFIX = 'Failed to parse AgentScript code: ';

/** How the sandbox's message starts for a value over `vm.maxSanitizeProperties`, whichever value it is. */
const TOO_MANY_VALUES_PREFIX = 'Tool handler return value exceeds maximum properties';

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

function toolResultTooLargeMessage(toolName: string, resultValues: number, maxResultValues: number): string {
  return (
    `The result of "${toolName}" holds ${formatCount(resultValues)} values (array items and object keys, at every ` +
    `depth); vm.maxSanitizeProperties allows ${formatCount(maxResultValues)}. Ask the tool for fewer items or fields.`
  );
}

function returnValueTooLargeMessage(maxResultValues: number): string {
  return (
    `The script's return value holds more than ${formatCount(maxResultValues)} values (array items and object keys, ` +
    `at every depth), the vm.maxSanitizeProperties limit. Return fewer items or fields, or a summary.`
  );
}

interface ValidationIssueSummary {
  code?: string;
  message?: string;
  location?: { line?: number };
  data?: { identifier?: unknown; allowedGlobals?: unknown };
}

/** The prefix the sandbox gives a global it renames before validating the script. */
const SANDBOX_NAME_PREFIX = '__safe_';

/** The names of the sandbox's own globals, which a script can't use. */
const INTERNAL_NAME_PREFIX = '__';

function scriptGlobalsOf(allowedGlobals: unknown): string[] {
  if (!Array.isArray(allowedGlobals)) return [];
  return allowedGlobals.filter(
    (name): name is string => typeof name === 'string' && !name.startsWith(INTERNAL_NAME_PREFIX),
  );
}

/**
 * An issue's message; an unknown identifier is named as the script wrote it, not by the sandbox's name for
 * it, with the globals a script can use in full instead of the sandbox's cut list of its internal ones.
 */
function issueMessageOf(issue: ValidationIssueSummary): string | undefined {
  const identifier = issue.data?.identifier;
  if (issue.code !== 'UNKNOWN_GLOBAL' || typeof identifier !== 'string') return issue.message;
  const scriptName = identifier.startsWith(SANDBOX_NAME_PREFIX)
    ? identifier.slice(SANDBOX_NAME_PREFIX.length)
    : identifier;
  const scriptGlobals = scriptGlobalsOf(issue.data?.allowedGlobals);
  const globalsText = scriptGlobals.length > 0 ? ` Globals a script can use: ${scriptGlobals.join(', ')}.` : '';
  return `Unknown identifier "${scriptName}". Declare it with const or let before using it.${globalsText}`;
}

/** A refusal and its issues, one per line, the same whichever runtime refused the script. */
function validationMessageOf(reportedMessage: string, issues: readonly ValidationIssueSummary[]): string {
  const lines = issues.flatMap((issue) => {
    const message = issueMessageOf(issue);
    if (!message) return [];
    const line = issue.location?.line === undefined ? '' : ` (line ${issue.location.line})`;
    return [`${issue.code ?? 'VALIDATION_ERROR'}${line}: ${message}`];
  });
  if (lines.length === 0) return reportedMessage;
  const summary = reportedMessage.split('\n', 1)[0].replace(/:$/, '');
  return `${summary}:\n${lines.join('\n')}`;
}

/** The `(line:column)` a parser message ends with. */
const PARSE_POSITION_RE = /\((\d+):(\d+)\)$/;

/**
 * A parse failure's message and position, in the script's own lines. The parse attempt the sandbox
 * reports reads the script inside an `async function` whose opening line comes first, so the line
 * it names is one past the script's; the column is the script's.
 */
function parseFailureOf(message: string): { message: string; location?: { line: number; column: number } } {
  const match = PARSE_POSITION_RE.exec(message);
  const line = match ? Number(match[1]) - 1 : 0;
  if (!match || line < 1) return { message };
  const column = Number(match[2]);
  return { message: `${message.slice(0, match.index)}(${line}:${column})`, location: { line, column } };
}

/**
 * Error thrown when script exceeds maximum length and sidecar is disabled
 */
export class ScriptTooLargeError extends Error {
  readonly code = 'SCRIPT_TOO_LARGE';
  readonly scriptLength: number;
  readonly maxLength: number;

  constructor(scriptLength: number, maxLength: number) {
    super(
      `Script length (${scriptLength} characters) exceeds maximum allowed length (${maxLength} characters). ` +
        `Enable sidecar to handle large data, or reduce script size.`,
    );
    this.name = 'ScriptTooLargeError';
    this.scriptLength = scriptLength;
    this.maxLength = maxLength;
  }
}

/**
 * Service for executing AgentScript code using enclave-vm
 *
 * It runs each script in the Enclave runtime `vm.runtime` selects (see ./runtime) and provides:
 * - Safe AgentScript execution: Enclave pre-scans, transforms and validates the raw script before
 *   anything runs, on every runtime
 * - Runtime limits (timeout, iterations, tool calls, and the interpreter's own budgets)
 * - Tool call integration with FrontMCP pipeline, closed when the run returns
 *
 * It loads the Node-only `@enclave-vm/core` barrel only for `vm.runtime: 'node-vm'`, starting in the
 * background when it is created on a long-running Node server (not serverless); otherwise, and for
 * the interpreter's entry point, the load happens when a script runs.
 */
@Provider({
  name: 'codecall:enclave',
  description: 'Executes AgentScript code in a secure enclave',
  scope: ProviderScope.GLOBAL,
})
export default class EnclaveService {
  private readonly vmOptions: ResolvedCodeCallVmOptions;
  private readonly sidecarOptions: CodeCallSidecarOptions;
  /** Where scripts' console calls go: set only with an explicit `vm.allowConsole: true`. */
  private readonly consoleHandler?: ConsoleHandler;
  private readonly runtimes: CodeCallScriptRuntimes;

  /**
   * @param config - The plugin's resolved options
   * @param scriptLogger - The logger scripts' console output goes to with `vm.allowConsole: true`
   * @param runtimes - The runtimes scripts run in, by `vm.runtime` name (replaced in tests)
   */
  constructor(
    config: CodeCallConfig,
    scriptLogger?: FrontMcpLogger,
    runtimes: CodeCallScriptRuntimes = createDefaultRuntimes(),
  ) {
    // Use getAll() to avoid deep type instantiation with DottedPath<T>
    const all = config.getAll();
    this.vmOptions = all.resolvedVm;
    this.sidecarOptions = all.sidecar;
    this.runtimes = runtimes;
    if (this.vmOptions.runtime === 'node-vm') runtimes['node-vm'].preload?.();
    if (this.vmOptions.allowConsole && scriptLogger) {
      this.consoleHandler = new ScriptConsoleLog(scriptLogger).write;
    }
  }

  /**
   * Execute AgentScript code in the enclave
   *
   * @param code - The AgentScript code to execute (raw, not transformed)
   * @param environment - The VM environment with callTool, getTool, etc.
   * @param journal - Records each tool call as the tool handler is entered; closed when the run returns
   * @param review - The review of the script and each call, when the server's `review` is on
   * @returns Execution result with success/error and logs
   * @throws ScriptTooLargeError if script exceeds max length and sidecar is disabled
   */
  async execute(
    code: string,
    environment: CodeCallVmEnvironment,
    journal = new RunJournal(),
    review?: EnclaveRunReview,
  ): Promise<EnclaveExecutionResult> {
    const logs: string[] = [];

    // Validate script length when sidecar is disabled
    if (!this.sidecarOptions.enabled && this.sidecarOptions.maxScriptLengthWhenDisabled !== null) {
      const maxLength = this.sidecarOptions.maxScriptLengthWhenDisabled;
      if (code.length > maxLength) {
        throw new ScriptTooLargeError(code.length, maxLength);
      }
    }

    const policyIssues = await findScriptPolicyIssues(code, {
      ...this.vmOptions,
      allowConsole: this.consoleHandler !== undefined,
    });
    if (policyIssues.length > 0) {
      return {
        success: false,
        error: {
          message: `AgentScript validation failed:\n${policyIssues
            .map((issue) => `${issue.code}${issue.location ? ` (line ${issue.location.line})` : ''}: ${issue.message}`)
            .join('\n')}`,
          name: 'ValidationError',
          code: 'VALIDATION_ERROR',
          blockedPatterns: [...new Set(policyIssues.map((issue) => issue.code))],
        },
        logs,
        timedOut: false,
        stats: { duration: 0, toolCallCount: 0, iterationCount: 0 },
      };
    }

    let settings: CodeCallRuntimeSettings;
    try {
      settings = runtimeSettingsOf(this.vmOptions);
    } catch (error: unknown) {
      if (error instanceof CodeCallRuntimeError) return runtimeRefusal(error, logs);
      throw error;
    }

    const { replay } = journal;
    if (replay) environment = replayedEnvironment(environment, replay);
    const { keptValues } = environment;
    const { script, preloadReferences } = keptValues
      ? await keptValues.prepare(code)
      : { script: code, preloadReferences: [] };

    // The host side of this execution. Once the run returns, a continuation of the script that is
    // still scheduled reaches none of the closures below, whatever the runtime.
    const gate = new ExecutionGate();

    // Create tool handler that bridges to CodeCallVmEnvironment. It always throws on a failing
    // tool: the sandbox applies the script's `{ throwOnError: false }` itself, for `callTool()` and
    // namespace methods alike. Failures are kept so a script a failing tool ended is a tool error.
    const toolFailures: ToolFailure[] = [];
    const maxResultValues = this.vmOptions.maxSanitizeProperties;
    const toolHandler: ToolHandler = gate.guardToolHandler(async (toolName, args, toolCall) => {
      const call = journal.begin(toolName, args, toolCall?.callIndex);
      try {
        const result = await callOrReplay(replay, toolCall, toolName, args, (callArgs) =>
          keptValues && isKeptValueCall(toolName)
            ? keptValues.call(toolName, callArgs)
            : environment.callTool(toolName, callArgs, undefined, toolCall),
        );
        const resultValues = countResultValues(result);
        if (resultValues > maxResultValues) {
          throw createPublicToolCallError(
            TOOL_CALL_ERROR_CODES.RESULT_TOO_LARGE,
            toolName,
            toolResultTooLargeMessage(toolName, resultValues, maxResultValues),
          );
        }
        call.succeed(result);
        return result;
      } catch (error: unknown) {
        call.fail(error);
        const code = (error as { code?: unknown } | null | undefined)?.code;
        toolFailures.push({
          toolName,
          name: toolFailureName(error),
          message: toolFailureMessage(error, toolName),
          ...(typeof code === 'string' ? { code } : {}),
          ...(toolCall && { callIndex: toolCall.callIndex }),
        });
        if (toolCall) await this.releaseRefusal(journal, toolCall.callIndex, error);
        throw error;
      }
    });

    // Build sidecar configuration if enabled
    const sidecar: ReferenceSidecarOptions | undefined = this.sidecarOptions.enabled
      ? {
          enabled: true,
          maxTotalSize: this.sidecarOptions.maxTotalSize,
          maxReferenceSize: this.sidecarOptions.maxReferenceSize,
          extractionThreshold: extractionThresholdOf(this.sidecarOptions),
          maxResolvedSize: this.sidecarOptions.maxResolvedSize,
          allowComposites: this.sidecarOptions.allowComposites,
        }
      : undefined;

    const hostFunctions = this.hostFunctionsOf(environment, logs, gate);
    const { rapidEnumerationThreshold, rapidEnumerationOverrides } = this.vmOptions;

    const spec: CodeCallScriptRunSpec = {
      timeoutMs: this.vmOptions.timeoutMs,
      maxIterations: MAX_ITERATIONS_PER_LOOP,
      maxToolCalls: settings.maxToolCalls,
      // Interpreter-only budgets: the Node VM has no such engine counters.
      ...(settings.runtime === 'interpreter' && {
        maxInterpreterSteps: settings.maxInterpreterSteps,
        maxCallDepth: settings.maxCallDepth,
        maxPendingCalls: settings.maxPendingCalls,
        memoryLimitBytes: settings.memoryLimitBytes,
      }),
      maxSanitizeDepth: this.vmOptions.maxSanitizeDepth,
      maxSanitizeProperties: this.vmOptions.maxSanitizeProperties,
      toolHandler,
      hostFunctions,
      // Scripts get `console` only with it; the sandbox bounds each script's console calls and bytes.
      consoleHandler: replay ? replay.quiet(this.consoleHandler) : this.consoleHandler,
      // Tool namespaces (`acme.getUser()` for a tool named `acme.getUser`) are built by the sandbox
      // itself: a method call is exactly `callTool('acme.getUser', args, options)`, with the
      // sandbox's tool-call cap, rate limit, suspicious-sequence checks and `throwOnError`.
      toolNamespaces: toSandboxToolNamespaces(environment.toolNamespaces, Object.keys(hostFunctions)),
      sidecar,
      ...(preloadReferences.length > 0 && { preloadReferences }),
      rapidEnumeration: {
        ...(rapidEnumerationThreshold !== undefined && { threshold: rapidEnumerationThreshold }),
        ...(rapidEnumerationOverrides !== undefined && { overrides: rapidEnumerationOverrides }),
      },
      ...(review && { review: journaledReviewHooks(review.hooks, journal), reviewContext: review.context }),
      ...replay?.hooks,
    };

    let runner: CodeCallScriptRunner;
    try {
      runner = await this.runtimes[settings.runtime].createRunner(spec);
    } catch (error: unknown) {
      gate.close();
      if (error instanceof CodeCallRuntimeError) return runtimeRefusal(error, logs);
      throw error;
    }

    replay?.appliedByRuntime(runner.replays === true, runner.replaysCallTimes === true);
    if (replay?.replaysRun && !runner.replays) {
      gate.close();
      runner.dispose();
      return replayRefusal(settings.runtime, logs);
    }

    try {
      const result = await runner.run(script);
      gate.close();
      // The calls still running in their tools: a refusal held while they settle is not one (see `releaseRefusal`).
      const pendingToolCalls = journal.running();
      replay?.endedWith(callsEndedWith(result, toolFailures));
      replay?.endedWith(refusalsEndedWith(result.review?.decisions ?? [], result.error).flatMap(callIndexOf));
      const mapped = this.mapEnclaveResult(result, logs, toolFailures, script, pendingToolCalls);
      const ended = replay ? replayEndOf(replay, result, mapped, runner.reportsRefusals === true) : mapped;
      return result.review ? { ...ended, review: result.review } : ended;
    } finally {
      gate.close();
      journal.close();
      runner.dispose();
    }
  }

  /**
   * Hands the script the failure of a call the call flow refused before its tool ran (its input, or a budget as it
   * entered the tool). In a run that can pause, it waits first while the run's other calls, a `parallel()`'s, settle,
   * so a run that stops at it records each of them (see `RunStops`); a failure the script never gets, because another
   * call's `needs_approval` stopped the run meanwhile, is moot, and its call is asked again on resume.
   */
  private async releaseRefusal(journal: RunJournal, callIndex: number, error: unknown): Promise<void> {
    if (!isRefusedBeforeTool(error)) return;
    if (journal.holdsStops && (await journal.stops.hold(callIndex, false)) === 'moot') {
      journal.markMoot(callIndex + 1);
      return;
    }
    journal.replay?.released(callIndex);
  }

  /** Whether the configured runtime's Enclave judges replayed calls by their recorded times, which some paused runs need. */
  async replaysCallTimes(): Promise<boolean> {
    try {
      return (await this.runtimes[runtimeSettingsOf(this.vmOptions).runtime].replaysCallTimes?.()) === true;
    } catch {
      return false;
    }
  }

  /**
   * The host functions a script may call: `getTool` always, `mcpLog` and `mcpNotify` when the
   * environment has them. Each is closed with the execution.
   */
  private hostFunctionsOf(
    environment: CodeCallVmEnvironment,
    logs: string[],
    gate: ExecutionGate,
  ): Record<string, CodeCallHostFunction> {
    const { getTool, mcpLog, mcpNotify } = environment;
    const functions: Record<string, CodeCallHostFunction> = {
      getTool: gate.guardHostFunction('getTool', (name) => getTool(name as string)),
    };
    if (mcpLog) {
      functions['mcpLog'] = gate.guardHostFunction('mcpLog', (level, message, metadata) => {
        const logLevel = level as 'debug' | 'info' | 'warn' | 'error';
        mcpLog(logLevel, message as string, metadata as Record<string, unknown> | undefined);
        logs.push(`[mcp:${logLevel}] ${message as string}`);
      });
    }
    if (mcpNotify) {
      functions['mcpNotify'] = gate.guardHostFunction('mcpNotify', (event, payload) => {
        mcpNotify(event as string, payload as Record<string, unknown>);
        logs.push(`[notify] ${event as string}`);
      });
    }
    return functions;
  }

  /**
   * Map Enclave ExecutionResult to EnclaveExecutionResult
   */
  private mapEnclaveResult(
    result: CodeCallRunResult,
    logs: string[],
    toolFailures: readonly ToolFailure[] = [],
    script = '',
    pendingToolCalls = 0,
  ): EnclaveExecutionResult {
    const stats: NonNullable<EnclaveExecutionResult['stats']> = {
      duration: result.stats.duration,
      toolCallCount: result.stats.toolCallCount,
      iterationCount: result.stats.iterationCount,
      ...(pendingToolCalls > 0 && { pendingToolCalls }),
    };
    if (result.success) {
      return { success: true, result: result.value, logs, timedOut: false, stats };
    }

    // Handle error cases
    const reportedError = result.error ?? { name: 'Error', message: 'Script execution failed' };

    // A script a failing tool ended, the tool's error uncaught (or rethrown): the sandbox hands back
    // only the error's name and message, so it is matched to the failure the tool handler threw by
    // both. A script that caught the failure and threw its own error with the same message is not
    // matched: its error has the sandbox's own name, not the tool's.
    const toolFailure = [...toolFailures]
      .reverse()
      .find((failure) => failure.message === reportedError.message && failure.name === reportedError.name);

    // The sandbox's own iteration-limit error, not a tool's whose message starts the same way.
    const error =
      !toolFailure && reportedError.message?.startsWith(ITERATION_LIMIT_PREFIX)
        ? { ...reportedError, ...ITERATION_LIMIT_ERROR }
        : reportedError;

    // A script that doesn't parse: the sandbox reports it as a generic error of its own.
    if (error.code === 'ENCLAVE_ERROR' && error.message?.startsWith(PARSE_FAILURE_PREFIX)) {
      const { message, location } = parseFailureOf(error.message);
      return {
        success: false,
        error: { message, name: 'SyntaxError', code: 'SYNTAX_ERROR', ...(location ? { location } : {}) },
        logs,
        timedOut: false,
        stats,
      };
    }

    if (toolFailure) {
      return {
        success: false,
        error: {
          message: error.message,
          name: error.name,
          ...(toolFailure.code ? { code: toolFailure.code } : {}),
          toolName: toolFailure.toolName,
        },
        logs,
        timedOut: false,
        stats,
      };
    }

    const timedOut = error.message?.includes('timed out') || error.code === 'TIMEOUT';

    // Check if it's a validation error
    if (error.code === 'VALIDATION_ERROR') {
      const issues = (error.data as { issues?: ValidationIssueSummary[] } | undefined)?.issues ?? [];
      const blockedPatterns = [...new Set(issues.map((issue) => issue.code).filter((code): code is string => !!code))];
      const message = validationMessageOf(error.message, issues);

      return {
        success: false,
        error: {
          // The enclave names lines of the code it validated (the script wrapped and printed again),
          // not the script's own.
          message: withScriptLines(message, script),
          name: 'ValidationError',
          code: error.code,
          ...(blockedPatterns.length > 0 ? { blockedPatterns } : {}),
        },
        logs,
        timedOut: false,
        stats,
      };
    }

    // The tool handler refuses a tool result over the limit itself, so what is left over it is the return value.
    if (error.message?.startsWith(TOO_MANY_VALUES_PREFIX) && error.code !== 'TOOL_RESULT_NOT_SAFE') {
      return {
        success: false,
        error: {
          message: returnValueTooLargeMessage(this.vmOptions.maxSanitizeProperties),
          name: 'RangeError',
          code: TOOL_CALL_ERROR_CODES.RESULT_TOO_LARGE,
        },
        logs,
        timedOut: false,
        stats,
      };
    }

    // Generic error
    return {
      success: false,
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack,
        code: error.code,
      },
      logs,
      timedOut,
      stats,
    };
  }
}

/**
 * How a replayed run ends: as it ran, unless it made a recorded call with another tool or arguments, or ended before
 * making them all by itself; then with the divergence. A run Enclave stopped there ends with Enclave's error, and one
 * whose script caught Enclave's refusal and returned ends with that refusal.
 */
function replayEndOf(
  replay: RunReplay,
  result: CodeCallRunResult,
  mapped: EnclaveExecutionResult,
  reportsRefusals: boolean,
): EnclaveExecutionResult {
  const divergence = replay.divergenceOf(stoppedBySandbox(result, mapped, reportsRefusals));
  if (divergence) return divergedResult(divergence, mapped);
  if (!mapped.success || !result.refusedCall || !replay.endedEarly) return mapped;
  const { code, pattern } = result.refusedCall;
  const refusal = pattern ? `${code}: ${pattern}` : code;
  const message = `The sandbox refused a call (${refusal}); the script caught it and ended before the calls its run made`;
  return divergedResult({ name: 'CallRefusedError', code, message }, mapped);
}

/** A replayed run whose script did not make the calls its journal recorded: whatever it returned, it ends with why. */
function divergedResult(
  why: { name: string; message: string; code: string },
  mapped: EnclaveExecutionResult,
): EnclaveExecutionResult {
  const { name, message, code } = why;
  return { success: false, error: { name, message, code }, logs: mapped.logs, timedOut: false, stats: mapped.stats };
}

/** A run that replays another, refused before any of it ran: the runtime cannot replay a run's clock, random and call order. */
function replayRefusal(runtime: string, logs: string[]): EnclaveExecutionResult {
  return {
    success: false,
    error: {
      name: 'CodeCallRuntimeError',
      code: 'RUNTIME_FEATURE_UNSUPPORTED',
      message: `CodeCall vm.runtime '${runtime}' cannot replay a run with the installed @enclave-vm/core; the run was not resumed.`,
      runtime,
    },
    logs,
    timedOut: false,
    stats: { duration: 0, toolCallCount: 0, iterationCount: 0 },
  };
}

/**
 * A refusal to run the script in the configured runtime, before any of it ran: the runtime is not
 * available here, cannot enforce a control this configuration needs, or is misconfigured.
 */
function runtimeRefusal(error: CodeCallRuntimeError, logs: string[]): EnclaveExecutionResult {
  return {
    success: false,
    error: { message: error.message, name: error.name, code: error.code, runtime: error.runtime },
    logs,
    timedOut: false,
    stats: { duration: 0, toolCallCount: 0, iterationCount: 0 },
  };
}
