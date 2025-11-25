// file: libs/plugins/src/codecall/services/enclave.service.ts

import { Provider, ProviderScope } from '@frontmcp/sdk';
import { Enclave, type ExecutionResult, type ToolHandler } from '@frontmcp/enclave';
import type CodeCallConfig from '../providers/code-call.config';
import type { CodeCallVmEnvironment, ResolvedCodeCallVmOptions } from '../codecall.symbol';

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
 * Service for executing AgentScript code using @frontmcp/enclave
 *
 * This service wraps the Enclave class and provides:
 * - Safe AgentScript execution with AST validation
 * - Automatic code transformation (callTool -> __safe_callTool)
 * - Runtime limits (timeout, iterations, tool calls)
 * - Tool call integration with FrontMCP pipeline
 */
@Provider({
  name: 'codecall:enclave',
  description: 'Executes AgentScript code in a secure enclave',
  scope: ProviderScope.GLOBAL,
})
export default class EnclaveService {
  private readonly vmOptions: ResolvedCodeCallVmOptions;

  constructor(config: CodeCallConfig) {
    this.vmOptions = config.get('resolvedVm');
  }

  /**
   * Execute AgentScript code in the enclave
   *
   * @param code - The AgentScript code to execute (raw, not transformed)
   * @param environment - The VM environment with callTool, getTool, etc.
   * @returns Execution result with success/error and logs
   */
  async execute(code: string, environment: CodeCallVmEnvironment): Promise<EnclaveExecutionResult> {
    const logs: string[] = [];

    // Create tool handler that bridges to CodeCallVmEnvironment
    const toolHandler: ToolHandler = async (toolName: string, args: Record<string, unknown>) => {
      return environment.callTool(toolName, args);
    };

    // Create enclave with configuration from CodeCallConfig
    const enclave = new Enclave({
      timeout: this.vmOptions.timeoutMs,
      maxToolCalls: this.vmOptions.maxSteps || 100,
      maxIterations: 10000,
      toolHandler,
      validate: true,
      transform: true,
      globals: {
        // Provide getTool as a custom global
        getTool: environment.getTool,
        // Provide codecallContext
        codecallContext: environment.codecallContext,
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
        // Provide console if allowed
        ...(this.vmOptions.allowConsole
          ? {
              console: {
                log: (...args: unknown[]) => {
                  const message = args.map((arg) => String(arg)).join(' ');
                  logs.push(`[log] ${message}`);
                },
                warn: (...args: unknown[]) => {
                  const message = args.map((arg) => String(arg)).join(' ');
                  logs.push(`[warn] ${message}`);
                },
                error: (...args: unknown[]) => {
                  const message = args.map((arg) => String(arg)).join(' ');
                  logs.push(`[error] ${message}`);
                },
              },
            }
          : {}),
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
