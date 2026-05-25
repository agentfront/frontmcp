// file: libs/plugins/src/codecall/tools/execute.tool.ts

import { Tool, ToolContext } from '@frontmcp/sdk';

import type { CodeCallVmEnvironment } from '../codecall.symbol';
import {
  createToolCallError,
  TOOL_CALL_ERROR_CODES,
  type CallToolOptions,
  type ToolCallErrorCode,
  type ToolCallResult,
} from '../errors';
import CodeCallConfig from '../providers/code-call.config';
import { assertNotSelfReference } from '../security';
import EnclaveService from '../services/enclave.service';
import { buildToolNamespaces, extractResultFromCallToolResult } from '../utils';
import {
  executeToolDescription,
  executeToolInputSchema,
  executeToolOutputSchema,
  type CodeCallExecuteResult,
  type ExecuteToolInput,
} from './execute.schema';

/**
 * Determine the error code from an error object.
 * Used to categorize errors for sanitized reporting.
 */
function getErrorCode(error: unknown): ToolCallErrorCode {
  if (!(error instanceof Error)) {
    return TOOL_CALL_ERROR_CODES.EXECUTION;
  }

  // Check for specific error types
  if (error.name === 'ZodError' || error.message?.includes('validation')) {
    return TOOL_CALL_ERROR_CODES.VALIDATION;
  }

  if (error.message?.includes('timeout') || error.message?.includes('timed out')) {
    return TOOL_CALL_ERROR_CODES.TIMEOUT;
  }

  if (error.name === 'ToolNotFoundError' || error.message?.includes('not found')) {
    return TOOL_CALL_ERROR_CODES.NOT_FOUND;
  }

  return TOOL_CALL_ERROR_CODES.EXECUTION;
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
export default class ExecuteTool extends ToolContext {
  async execute(input: ExecuteToolInput): Promise<CodeCallExecuteResult> {
    const { script, allowedTools } = input;

    // Set up the VM environment with tool integration
    const allowedToolSet = allowedTools ? new Set(allowedTools) : null;

    const environment: CodeCallVmEnvironment = {
      callTool: async <TInput, TResult>(
        name: string,
        toolInput: TInput,
        options?: CallToolOptions,
      ): Promise<TResult | ToolCallResult<TResult>> => {
        const throwOnError = options?.throwOnError !== false; // Default: true

        // ============================================================
        // SECURITY LAYER 1: Self-reference blocking (FIRST CHECK)
        // This MUST be the first check - no exceptions, no try/catch
        // ============================================================
        assertNotSelfReference(name);

        // ============================================================
        // SECURITY LAYER 2: Whitelist check (if configured)
        // ============================================================
        if (allowedToolSet && !allowedToolSet.has(name)) {
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
        try {
          // Build MCP-compatible CallToolRequest
          const request = {
            method: 'tools/call' as const,
            params: {
              name,
              arguments: toolInput as Record<string, unknown>,
            },
          };

          // Build context with auth info
          const ctx = {
            authInfo: this.authInfo,
          };

          // Execute through the flow system - this runs all stages:
          // PRE: parseInput → findTool → createToolCallContext → acquireQuota → acquireSemaphore
          // EXECUTE: validateInput → execute → validateOutput
          // FINALIZE: releaseSemaphore → releaseQuota → finalize
          const mcpResult = await this.scope.runFlow('tools:call-tool', { request, ctx });

          if (!mcpResult) {
            const error = createToolCallError(TOOL_CALL_ERROR_CODES.EXECUTION, name, 'Flow returned no result');
            if (throwOnError) {
              throw error;
            }
            return { success: false, error };
          }

          // Extract the actual result from MCP CallToolResult format
          const result = extractResultFromCallToolResult(mcpResult);

          // Success path
          if (throwOnError) {
            return result as TResult;
          }
          return { success: true, data: result as TResult };
        } catch (error: unknown) {
          // ============================================================
          // Error sanitization - NEVER expose internal details
          // ============================================================

          // Determine error code from the error type
          const errorCode = getErrorCode(error);
          const rawMessage = error instanceof Error ? error.message : undefined;

          const sanitizedError = createToolCallError(errorCode, name, rawMessage);

          if (throwOnError) {
            // Throw sanitized error (no stack trace, no internal details)
            throw sanitizedError;
          }
          return { success: false, error: sanitizedError };
        }
      },

      getTool: (name: string) => {
        try {
          const tools = this.scope.tools.getTools(true);
          const tool = tools.find((t) => t.name === name || t.fullName === name);

          if (!tool) return undefined;

          return {
            name: tool.name,
            description: tool.metadata?.description,
            inputSchema: tool.rawInputSchema,
            outputSchema: tool.outputSchema,
          };
        } catch {
          return undefined;
        }
      },

      console: this.get(CodeCallConfig).get('resolvedVm.allowConsole') ? console : undefined,

      mcpLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>) => {
        // Log through FrontMCP logging system if available
        this.logger?.[level](message, metadata);
      },

      mcpNotify: (event: string, payload: Record<string, unknown>) => {
        // Send notifications through FrontMCP notification system if available
        this.logger?.debug('Notification sent', { event, payload });
      },
    };

    // Build namespaced bindings for AgentScript ergonomics. Tools named
    // `${ns}.${method}` become `await ns.method(args)` instead of
    // `await callTool('ns.method', args)`. Each binding delegates to the
    // same `callTool` closure above so all security checks (self-reference,
    // whitelist, sanitization, flow execution) apply uniformly.
    try {
      const registeredTools = this.scope.tools.getTools(true) as Array<{ name: string }>;
      const { namespaces, skipped } = buildToolNamespaces(registeredTools, environment.callTool);
      environment.namespaces = namespaces;
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

    try {
      const executionResult = await enclaveService.execute(script, environment);

      // Map execution result to CodeCall result
      if (executionResult.timedOut) {
        return {
          status: 'timeout',
          error: {
            message: `Script execution timed out after ${config.getAll().resolvedVm.timeoutMs}ms`,
          },
        };
      }

      if (!executionResult.success) {
        const error = executionResult.error!;

        // Check if it's a validation error (from AST validation)
        if (error.code === 'VALIDATION_ERROR' || error.name === 'ValidationError') {
          return {
            status: 'illegal_access',
            error: {
              kind: 'IllegalBuiltinAccess',
              message: error.message,
            },
          };
        }

        // Check if it's a tool error
        if (error.toolName) {
          return {
            status: 'tool_error',
            error: {
              source: 'tool',
              toolName: error.toolName,
              toolInput: error.toolInput,
              message: error.message,
              code: error.code,
              details: error.details,
            },
          };
        }

        // Otherwise it's a runtime error
        return {
          status: 'runtime_error',
          error: {
            source: 'script',
            message: error.message,
            name: error.name,
            stack: error.stack,
          },
        };
      }

      // Success!
      return {
        status: 'ok',
        result: executionResult.result,
        logs: executionResult.logs.length > 0 ? executionResult.logs : undefined,
      };
    } catch (error: unknown) {
      // Type-safe error handling
      const errorName = error instanceof Error ? error.name : 'Error';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorLoc = (error as { loc?: { line: number; column: number } }).loc;

      // Check for syntax errors
      if (errorName === 'SyntaxError' || errorMessage?.includes('syntax')) {
        return {
          status: 'syntax_error',
          error: {
            message: errorMessage || 'Syntax error in script',
            location: errorLoc ? { line: errorLoc.line, column: errorLoc.column } : undefined,
          },
        };
      }

      // Unexpected error during execution
      return {
        status: 'runtime_error',
        error: {
          source: 'script',
          message: errorMessage || 'An unexpected error occurred during script execution',
          name: errorName,
          stack: errorStack,
        },
      };
    }
  }
}
