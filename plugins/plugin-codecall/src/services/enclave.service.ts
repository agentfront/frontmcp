// file: libs/plugins/src/codecall/services/enclave.service.ts

import type { ConsoleHandler, ReferenceSidecarOptions } from '@enclave-vm/core';
import type { ToolHandler } from '@enclave-vm/core/worker';

import { Provider, ProviderScope, type FrontMcpLogger } from '@frontmcp/sdk';

import type { CodeCallVmEnvironment, ResolvedCodeCallVmOptions } from '../codecall.symbol';
import type { CodeCallSidecarOptions } from '../codecall.types';
import type CodeCallConfig from '../providers/code-call.config';
import { MAX_ITERATIONS_PER_LOOP } from '../providers/code-call.config';
import { RunJournal } from '../runs/run-journal';
import { findScriptPolicyIssues } from '../security/script-policy';
import { toSandboxToolNamespaces } from '../utils/build-tool-namespaces';
import { withScriptLines } from '../utils/script-lines';
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

/** `@enclave-vm/ast`'s message for a script that doesn't parse. */
const PARSE_FAILURE_PREFIX = 'Failed to parse AgentScript code: ';

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
 * It loads no Enclave entry point until a script runs, and the Node-only `@enclave-vm/core` barrel
 * only for `vm.runtime: 'node-vm'`.
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
   * @returns Execution result with success/error and logs
   * @throws ScriptTooLargeError if script exceeds max length and sidecar is disabled
   */
  async execute(
    code: string,
    environment: CodeCallVmEnvironment,
    journal = new RunJournal(),
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

    // The host side of this execution. Once the run returns, a continuation of the script that is
    // still scheduled reaches none of the closures below, whatever the runtime.
    const gate = new ExecutionGate();

    // Create tool handler that bridges to CodeCallVmEnvironment. It always throws on a failing
    // tool: the sandbox applies the script's `{ throwOnError: false }` itself, for `callTool()` and
    // namespace methods alike. Failures are kept so a script a failing tool ended is a tool error.
    const toolFailures: ToolFailure[] = [];
    const toolHandler: ToolHandler = gate.guardToolHandler(async (toolName: string, args: Record<string, unknown>) => {
      const call = journal.begin(toolName, args);
      try {
        const result = await environment.callTool(toolName, args);
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
        });
        throw error;
      }
    });

    // Build sidecar configuration if enabled
    const sidecar: ReferenceSidecarOptions | undefined = this.sidecarOptions.enabled
      ? {
          enabled: true,
          maxTotalSize: this.sidecarOptions.maxTotalSize,
          maxReferenceSize: this.sidecarOptions.maxReferenceSize,
          extractionThreshold: this.sidecarOptions.extractionThreshold,
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
      consoleHandler: this.consoleHandler,
      // Tool namespaces (`acme.getUser()` for a tool named `acme.getUser`) are built by the sandbox
      // itself: a method call is exactly `callTool('acme.getUser', args, options)`, with the
      // sandbox's tool-call cap, rate limit, suspicious-sequence checks and `throwOnError`.
      toolNamespaces: toSandboxToolNamespaces(environment.toolNamespaces, Object.keys(hostFunctions)),
      sidecar,
      rapidEnumeration: {
        ...(rapidEnumerationThreshold !== undefined && { threshold: rapidEnumerationThreshold }),
        ...(rapidEnumerationOverrides !== undefined && { overrides: rapidEnumerationOverrides }),
      },
    };

    let runner: CodeCallScriptRunner;
    try {
      runner = await this.runtimes[settings.runtime].createRunner(spec);
    } catch (error: unknown) {
      gate.close();
      if (error instanceof CodeCallRuntimeError) return runtimeRefusal(error, logs);
      throw error;
    }

    try {
      const result = await runner.run(code);
      const { pendingToolCalls } = gate.close();
      return this.mapEnclaveResult(result, logs, toolFailures, code, pendingToolCalls);
    } finally {
      gate.close();
      journal.close();
      runner.dispose();
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
      const issues = (error.data as { issues?: Array<{ code?: string }> } | undefined)?.issues ?? [];
      const blockedPatterns = [...new Set(issues.map((issue) => issue.code).filter((code): code is string => !!code))];

      return {
        success: false,
        error: {
          // The enclave names lines of the code it validated (the script wrapped and printed again),
          // not the script's own.
          message: withScriptLines(error.message, script),
          name: 'ValidationError',
          code: error.code,
          ...(blockedPatterns.length > 0 ? { blockedPatterns } : {}),
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
