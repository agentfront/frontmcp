// file: libs/plugins/src/codecall/services/enclave.service.ts

import {
  Enclave,
  type CreateEnclaveOptions,
  type ExecutionResult,
  type ReferenceSidecarOptions,
  type ToolHandler,
} from '@enclave-vm/core';

import { Provider, ProviderScope } from '@frontmcp/sdk';

import type { CodeCallVmEnvironment, ResolvedCodeCallVmOptions } from '../codecall.symbol';
import type { CodeCallSidecarOptions } from '../codecall.types';
import type CodeCallConfig from '../providers/code-call.config';
import { MAX_ITERATIONS_PER_LOOP, maxToolCallsOf } from '../providers/code-call.config';
import { findScriptPolicyIssues } from '../security/script-policy';
import { toSandboxToolNamespaces } from '../utils/build-tool-namespaces';
import { withScriptLines } from '../utils/script-lines';

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
 * Service for executing AgentScript code using enclave-vm
 *
 * This service wraps the Enclave class and provides:
 * - Safe AgentScript execution with AST validation
 * - Automatic code transformation (callTool -> __safe_callTool)
 * - Runtime limits (timeout, iterations, tool calls)
 * - Tool call integration with FrontMCP pipeline
 */
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

@Provider({
  name: 'codecall:enclave',
  description: 'Executes AgentScript code in a secure enclave',
  scope: ProviderScope.GLOBAL,
})
export default class EnclaveService {
  private readonly vmOptions: ResolvedCodeCallVmOptions;
  private readonly sidecarOptions: CodeCallSidecarOptions;

  constructor(config: CodeCallConfig) {
    // Use getAll() to avoid deep type instantiation with DottedPath<T>
    const all = config.getAll();
    this.vmOptions = all.resolvedVm;
    this.sidecarOptions = all.sidecar;
  }

  /**
   * Execute AgentScript code in the enclave
   *
   * @param code - The AgentScript code to execute (raw, not transformed)
   * @param environment - The VM environment with callTool, getTool, etc.
   * @returns Execution result with success/error and logs
   * @throws ScriptTooLargeError if script exceeds max length and sidecar is disabled
   */
  async execute(code: string, environment: CodeCallVmEnvironment): Promise<EnclaveExecutionResult> {
    const logs: string[] = [];

    // Validate script length when sidecar is disabled
    if (!this.sidecarOptions.enabled && this.sidecarOptions.maxScriptLengthWhenDisabled !== null) {
      const maxLength = this.sidecarOptions.maxScriptLengthWhenDisabled;
      if (code.length > maxLength) {
        throw new ScriptTooLargeError(code.length, maxLength);
      }
    }

    const policyIssues = await findScriptPolicyIssues(code, this.vmOptions);
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

    // Create tool handler that bridges to CodeCallVmEnvironment. It always throws on a failing
    // tool: the sandbox applies the script's `{ throwOnError: false }` itself, for `callTool()` and
    // namespace methods alike. Failures are kept so a script a failing tool ended is a tool error.
    const toolFailures: ToolFailure[] = [];
    const toolHandler: ToolHandler = async (toolName: string, args: Record<string, unknown>) => {
      try {
        return await environment.callTool(toolName, args);
      } catch (error: unknown) {
        const code = (error as { code?: unknown } | null | undefined)?.code;
        toolFailures.push({
          toolName,
          name: toolFailureName(error),
          message: toolFailureMessage(error, toolName),
          ...(typeof code === 'string' ? { code } : {}),
        });
        throw error;
      }
    };

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

    const { mcpLog, mcpNotify } = environment;
    const globals: Record<string, unknown> = {
      // Provide getTool as a custom global
      getTool: environment.getTool,
      // Provide logging functions if available
      ...(mcpLog
        ? {
            mcpLog: (
              level: 'debug' | 'info' | 'warn' | 'error',
              message: string,
              metadata?: Record<string, unknown>,
            ) => {
              mcpLog(level, message, metadata);
              logs.push(`[mcp:${level}] ${message}`);
            },
          }
        : {}),
      ...(mcpNotify
        ? {
            mcpNotify: (event: string, payload: Record<string, unknown>) => {
              mcpNotify(event, payload);
              logs.push(`[notify] ${event}`);
            },
          }
        : {}),
      // Note: enclave-vm v2.0.0+ provides its own __safe_console internally with rate limiting
      // and output size limits. Passing console in globals causes "Cannot redefine property"
      // errors due to Double VM architecture. Console output from user scripts goes to stdout
      // via enclave's internal console, not to this logs array. Only mcpLog/mcpNotify are captured.
    };

    // Create enclave with configuration from CodeCallConfig
    const options: CreateEnclaveOptions = {
      timeout: this.vmOptions.timeoutMs,
      maxToolCalls: maxToolCallsOf(this.vmOptions),
      maxIterations: MAX_ITERATIONS_PER_LOOP,
      maxSanitizeDepth: this.vmOptions.maxSanitizeDepth,
      maxSanitizeProperties: this.vmOptions.maxSanitizeProperties,
      toolHandler,
      validate: true,
      transform: true,
      sidecar,
      // Error stacks name no host file, whatever stage raised them.
      sanitizeStackTraces: true,
      // Allow functions in globals since we intentionally provide getTool, mcpLog, mcpNotify, and console
      allowFunctionsInGlobals: true,
      globals,
      // Tool namespaces (`acme.getUser()` for a tool named `acme.getUser`) are built by the sandbox
      // itself: a method call is exactly `callTool('acme.getUser', args, options)`, with the
      // sandbox's tool-call cap, rate limit, suspicious-sequence checks and `throwOnError`.
      toolNamespaces: toSandboxToolNamespaces(environment.toolNamespaces, Object.keys(globals)),
    };

    const enclave = createEnclave(options);
    try {
      const result = await enclave.run<unknown>(code);
      return this.mapEnclaveResult(result, logs, toolFailures, code);
    } finally {
      enclave.dispose();
    }
  }

  /**
   * Map Enclave ExecutionResult to EnclaveExecutionResult
   */
  private mapEnclaveResult(
    result: ExecutionResult<unknown>,
    logs: string[],
    toolFailures: readonly ToolFailure[] = [],
    script = '',
  ): EnclaveExecutionResult {
    const stats = {
      duration: result.stats.duration,
      toolCallCount: result.stats.toolCallCount,
      iterationCount: result.stats.iterationCount,
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
 * An enclave for these options. The sandbox refuses a whole `toolNamespaces` configuration over one
 * name it can't bind; `toSandboxToolNamespaces` leaves such names out, and should one still get
 * through, the script runs without namespaces rather than failing (`callTool()` always works).
 */
function createEnclave(options: CreateEnclaveOptions): Enclave {
  try {
    return new Enclave(options);
  } catch (error: unknown) {
    if (
      !options.toolNamespaces ||
      !(error instanceof TypeError) ||
      !error.message.startsWith('Invalid toolNamespaces')
    ) {
      throw error;
    }
    return new Enclave({ ...options, toolNamespaces: undefined });
  }
}
