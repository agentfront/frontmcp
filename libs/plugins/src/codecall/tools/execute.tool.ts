// file: libs/plugins/src/codecall/tools/execute.tool.ts

import { Tool, ToolContext, ToolEntry } from '@frontmcp/sdk';
import {
  CodeCallExecuteResult,
  executeToolOutputSchema,
  executeToolDescription,
  executeToolInputSchema,
  ExecuteToolInput,
} from './execute.schema';
import { CodeCallAstValidator, CodeCallVmEnvironment, ResolvedCodeCallVmOptions } from '../codecall.symbol';
import { IsolatedVmService } from '../services/isolated-vm.service';

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

    // Get the AST validator from DI
    const astValidator = this.get<CodeCallAstValidator>('codecall:ast-validator' as any);

    // Step 1: AST validation
    const validationResult = await astValidator.validate(script);

    if (!validationResult.ok) {
      const firstIssue = validationResult.issues[0];

      // Map to appropriate error type
      if (firstIssue.kind === 'ParseError') {
        return {
          status: 'syntax_error',
          error: {
            message: firstIssue.message,
            location: firstIssue.location,
          },
        };
      }

      // All other validation issues are illegal access
      return {
        status: 'illegal_access',
        error: {
          kind: firstIssue.kind,
          message: firstIssue.message,
        },
      };
    }

    // Step 2: Set up the VM environment
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

          // TODO: Properly invoke tool through the FrontMCP pipeline
          // For now, create a tool context and execute
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

      console: this.get<ResolvedCodeCallVmOptions>('codecall:vm-options' as any).allowConsole ? console : undefined,

      mcpLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>) => {
        // Log through FrontMCP logging system if available
        this.logger?.[level](message, metadata);
      },

      mcpNotify: (event: string, payload: Record<string, unknown>) => {
        // Send notifications through FrontMCP notification system if available
        // This is a placeholder - actual implementation depends on FrontMCP notification system
        this.logger?.debug('Notification sent', { event, payload });
      },
    };

    // Step 3: Execute in isolated-vm
    const vmOptions = this.get<ResolvedCodeCallVmOptions>('codecall:vm-options' as any);
    const vmService = new IsolatedVmService(vmOptions);

    try {
      const executionResult = await vmService.execute(script, environment);

      // Step 4: Map execution result to CodeCall result
      if (executionResult.timedOut) {
        return {
          status: 'timeout',
          error: {
            message: `Script execution timed out after ${vmOptions.timeoutMs}ms`,
          },
        };
      }

      if (!executionResult.success) {
        const error = executionResult.error!;

        // Check if it's a tool error
        if ((error as any).toolName) {
          return {
            status: 'tool_error',
            error: {
              source: 'tool',
              toolName: (error as any).toolName,
              toolInput: (error as any).toolInput,
              message: error.message,
              code: (error as any).code,
              details: (error as any).details,
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
      // Unexpected error during VM execution
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
