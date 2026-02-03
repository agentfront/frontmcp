// file: libs/plugins/src/codecall/services/enclave.service.ts

import { Provider, ProviderScope } from '@frontmcp/sdk';
import { Enclave, type ExecutionResult, type ToolHandler, type ReferenceSidecarOptions } from '@enclave-vm/core';
import type CodeCallConfig from '../providers/code-call.config';
import type { CodeCallVmEnvironment, ResolvedCodeCallVmOptions } from '../codecall.symbol';
import type { CodeCallSidecarOptions } from '../codecall.types';

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
    toolInput?: unknown;
    details?: unknown;
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

    // Create tool handler that bridges to CodeCallVmEnvironment
    const toolHandler: ToolHandler = async (toolName: string, args: Record<string, unknown>) => {
      return environment.callTool(toolName, args);
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

    // Create enclave with configuration from CodeCallConfig
    const enclave = new Enclave({
      timeout: this.vmOptions.timeoutMs,
      maxToolCalls: this.vmOptions.maxSteps || 100,
      maxIterations: 10000,
      maxSanitizeDepth: this.vmOptions.maxSanitizeDepth,
      maxSanitizeProperties: this.vmOptions.maxSanitizeProperties,
      toolHandler,
      validate: true,
      transform: true,
      sidecar,
      // Allow functions in globals since we intentionally provide getTool, mcpLog, mcpNotify, and console
      allowFunctionsInGlobals: true,
      globals: {
        // Provide getTool as a custom global
        getTool: environment.getTool,
        // Provide logging functions if available
        ...(environment.mcpLog
          ? {
              mcpLog: (
                level: 'debug' | 'info' | 'warn' | 'error',
                message: string,
                metadata?: Record<string, unknown>,
              ) => {
                environment.mcpLog!(level, message, metadata);
                logs.push(`[mcp:${level}] ${message}`);
              },
            }
          : {}),
        ...(environment.mcpNotify
          ? {
              mcpNotify: (event: string, payload: Record<string, unknown>) => {
                environment.mcpNotify!(event, payload);
                logs.push(`[notify] ${event}`);
              },
            }
          : {}),
        // Note: enclave-vm v2.0.0+ provides its own __safe_console internally with rate limiting
        // and output size limits. Passing console in globals causes "Cannot redefine property"
        // errors due to Double VM architecture. Console output from user scripts goes to stdout
        // via enclave's internal console, not to this logs array. Only mcpLog/mcpNotify are captured.
      },
    });

    try {
      const result = await enclave.run<unknown>(code);
      return this.mapEnclaveResult(result, logs);
    } finally {
      enclave.dispose();
    }
  }

  /**
   * Map Enclave ExecutionResult to EnclaveExecutionResult
   */
  private mapEnclaveResult(result: ExecutionResult<unknown>, logs: string[]): EnclaveExecutionResult {
    if (result.success) {
      return {
        success: true,
        result: result.value,
        logs,
        timedOut: false,
        stats: {
          duration: result.stats.duration,
          toolCallCount: result.stats.toolCallCount,
          iterationCount: result.stats.iterationCount,
        },
      };
    }

    // Handle error cases
    const error = result.error!;
    const timedOut = error.message?.includes('timed out') || error.code === 'TIMEOUT';

    // Check if it's a validation error
    if (error.code === 'VALIDATION_ERROR') {
      return {
        success: false,
        error: {
          message: error.message,
          name: 'ValidationError',
          code: error.code,
        },
        logs,
        timedOut: false,
      };
    }

    // Check if it's a tool error (has toolName in the error data)
    const errorData = error.data as Record<string, unknown> | undefined;
    const toolName = errorData?.['toolName'] as string | undefined;
    if (toolName) {
      return {
        success: false,
        error: {
          message: error.message,
          name: error.name,
          stack: error.stack,
          code: error.code,
          toolName,
          toolInput: errorData?.['toolInput'],
          details: errorData?.['details'],
        },
        logs,
        timedOut,
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
      stats: {
        duration: result.stats.duration,
        toolCallCount: result.stats.toolCallCount,
        iterationCount: result.stats.iterationCount,
      },
    };
  }
}
