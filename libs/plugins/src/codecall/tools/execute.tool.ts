// file: libs/plugins/src/codecall/tools/execute.tool.ts

import { Tool, ToolContext } from '@frontmcp/sdk';
import {
  CodeCallExecuteResult,
  executeToolOutputSchema,
  executeToolDescription,
  executeToolInputSchema,
  ExecuteToolInput,
} from './execute.schema';
import { CodeCallVmEnvironment, ResolvedCodeCallVmOptions } from '../codecall.symbol';
import EnclaveService from '../services/enclave.service';

@Tool({
  name: 'codecall:execute',
  cache: {
    ttl: 0, // No caching - each execution is unique
    slideWindow: false,
  },
  description: executeToolDescription,
  inputSchema: executeToolInputSchema,
  outputSchema: executeToolOutputSchema,
})
export default class ExecuteTool extends ToolContext {
  async execute(input: ExecuteToolInput): Promise<CodeCallExecuteResult> {
    const { script, allowedTools, context } = input;

    // Set up the VM environment with tool integration
    const allowedToolSet = allowedTools ? new Set(allowedTools) : null;

    const environment: CodeCallVmEnvironment = {
      callTool: async <TInput, TResult>(name: string, toolInput: TInput): Promise<TResult> => {
        // Check if tool is allowed
        if (allowedToolSet && !allowedToolSet.has(name)) {
          throw new Error(`Tool "${name}" is not in the allowedTools list`);
        }

        try {
          // Find the tool in the registry
          const tools = this.scope.tools.getTools(true);
          const tool = tools.find((t) => t.name === name || t.fullName === name);

          if (!tool) {
            throw new Error(`Tool "${name}" not found`);
          }

          // Create a tool context and execute
          const toolContext = tool.create(
            toolInput as any,
            {
              authInfo: this.authInfo,
            } as any,
          );

          const result = await toolContext.execute(toolInput as any);
          return result as TResult;
        } catch (error: any) {
          // Re-throw with tool context
          const toolError = new Error(error.message || 'Tool call failed');
          (toolError as any).toolName = name;
          (toolError as any).toolInput = toolInput;
          (toolError as any).code = error.code;
          (toolError as any).details = error.details;
          throw toolError;
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

      codecallContext: Object.freeze(context || {}),

      console: this.get<ResolvedCodeCallVmOptions>('codecall:vm-options' as any)?.allowConsole ? console : undefined,

      mcpLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>) => {
        // Log through FrontMCP logging system if available
        this.logger?.[level](message, metadata);
      },

      mcpNotify: (event: string, payload: Record<string, unknown>) => {
        // Send notifications through FrontMCP notification system if available
        this.logger?.debug('Notification sent', { event, payload });
      },
    };

    // Get the enclave service and execute
    const enclaveService = this.get<EnclaveService>('codecall:enclave' as any);
    const vmOptions = this.get<ResolvedCodeCallVmOptions>('codecall:vm-options' as any);

    try {
      const executionResult = await enclaveService.execute(script, environment);

      // Map execution result to CodeCall result
      if (executionResult.timedOut) {
        return {
          status: 'timeout',
          error: {
            message: `Script execution timed out after ${vmOptions?.timeoutMs || 30000}ms`,
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
    } catch (error: any) {
      // Check for syntax errors
      if (error.name === 'SyntaxError' || error.message?.includes('syntax')) {
        return {
          status: 'syntax_error',
          error: {
            message: error.message || 'Syntax error in script',
            location: error.loc ? { line: error.loc.line, column: error.loc.column } : undefined,
          },
        };
      }

      // Unexpected error during execution
      return {
        status: 'runtime_error',
        error: {
          source: 'script',
          message: error.message || 'An unexpected error occurred during script execution',
          name: error.name || 'Error',
          stack: error.stack,
        },
      };
    }
  }
}
