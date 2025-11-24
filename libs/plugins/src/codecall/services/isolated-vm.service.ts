// file: libs/plugins/src/codecall/services/isolated-vm.service.ts

import ivm from 'isolated-vm';
import { CodeCallVmEnvironment, ResolvedCodeCallVmOptions } from '../codecall.symbol';

/**
 * Error from VM execution with preserved metadata
 */
export interface VmExecutionError {
  message: string;
  name: string;
  stack?: string;
  toolName?: string;
  toolInput?: unknown;
  code?: unknown;
  details?: unknown;
  [key: string]: unknown;
}

/**
 * Result of VM execution
 */
export interface VmExecutionResult {
  success: boolean;
  result?: unknown;
  error?: VmExecutionError;
  logs: string[];
  timedOut: boolean;
}

/**
 * Service for executing JavaScript code in isolated-vm
 * Provides secure sandboxed execution with timeout and memory limits
 */
export class IsolatedVmService {
  constructor(private readonly vmOptions: ResolvedCodeCallVmOptions) {}

  /**
   * Executes a script in an isolated VM
   */
  async execute(script: string, environment: CodeCallVmEnvironment): Promise<VmExecutionResult> {
    const logs: string[] = [];
    const isolate = new ivm.Isolate({ memoryLimit: 128 }); // 128MB memory limit

    try {
      const context = await isolate.createContext();
      const jail = context.global;

      // Set up the jail with allowed globals
      await jail.set('global', jail.derefInto());

      // Set up async tool caller
      // Create a plain async function in the context that can be called with applySyncPromise
      const asyncToolCaller = async (name: string, inputJson: string) => {
        try {
          const input = JSON.parse(inputJson);
          const result = await environment.callTool(name, input);
          // Return as a plain string - primitives are transferable
          return JSON.stringify(result);
        } catch (error: any) {
          // Return error in a structured format that can be reconstructed in the isolate
          const errorData = {
            __isError: true,
            message: error?.message || 'Unknown error',
            name: error?.name || 'Error',
            stack: error?.stack,
            // Preserve tool-specific metadata if present
            toolName: error?.toolName,
            toolInput: error?.toolInput,
            code: error?.code,
            details: error?.details,
          };
          return JSON.stringify(errorData);
        }
      };

      // Use Reference with the async function
      await jail.set('_callToolAsync', new ivm.Reference(asyncToolCaller));

      // Set up getTool (synchronous, no changes needed)
      await jail.set(
        'getTool',
        new ivm.Callback((name: string) => {
          const tool = environment.getTool(name);
          if (!tool) return undefined;
          return JSON.stringify(tool);
        }),
      );

      // Implement callTool using applySyncPromise
      // This waits for the Promise to resolve while allowing the default isolate event loop to continue
      await context.eval(`
        globalThis.callTool = function(name, input) {
          const inputJson = JSON.stringify(input);
          // applySyncPromise waits for the async function to complete
          // Note: result options are not available for applySyncPromise
          const resultJson = _callToolAsync.applySyncPromise(
            undefined,
            [name, inputJson],
            { arguments: { copy: true } }
          );
          const result = JSON.parse(resultJson);

          // Check if the result is an error and reconstruct it
          if (result.__isError) {
            const error = new Error(result.message);
            error.name = result.name;
            if (result.stack) error.stack = result.stack;
            // Preserve tool-specific metadata
            if (result.toolName) error.toolName = result.toolName;
            if (result.toolInput) error.toolInput = result.toolInput;
            if (result.code) error.code = result.code;
            if (result.details) error.details = result.details;
            throw error;
          }

          return result;
        };

        globalThis.getTool = function(name) {
          const toolJson = getTool(name);
          return toolJson ? JSON.parse(toolJson) : undefined;
        };
      `);

      // Set codecallContext as a read-only object
      const contextCopy = new ivm.ExternalCopy(environment.codecallContext);
      await jail.set('codecallContext', contextCopy.copyInto());

      // Make codecallContext readonly by freezing it
      await context.eval(`
        Object.freeze(codecallContext);
      `);

      // Set up MCP logging functions if provided
      if (environment.mcpLog) {
        await jail.set(
          '_mcpLog',
          new ivm.Callback((level: string, message: string, dataJson?: string) => {
            const data = dataJson ? JSON.parse(dataJson) : undefined;
            environment.mcpLog!(level, message, data);
            logs.push(`[mcp:${level}] ${message}`);
          }),
        );

        await context.eval(`
          globalThis.mcpLog = function(level, message, data) {
            const dataJson = data ? JSON.stringify(data) : undefined;
            _mcpLog(level, message, dataJson);
          };
        `);
      }

      if (environment.mcpNotify) {
        await jail.set(
          '_mcpNotify',
          new ivm.Callback((event: string, dataJson: string) => {
            const data = JSON.parse(dataJson);
            environment.mcpNotify!(event, data);
            logs.push(`[notify] ${event}`);
          }),
        );

        await context.eval(`
          globalThis.mcpNotify = function(event, data) {
            const dataJson = JSON.stringify(data);
            _mcpNotify(event, dataJson);
          };
        `);
      }

      // Set up console if allowed
      if (this.vmOptions.allowConsole) {
        await jail.set(
          '_log',
          new ivm.Reference(function (...args: any[]) {
            const message = args.map((arg) => String(arg)).join(' ');
            logs.push(`[log] ${message}`);
          }),
        );

        await jail.set(
          '_warn',
          new ivm.Reference(function (...args: any[]) {
            const message = args.map((arg) => String(arg)).join(' ');
            logs.push(`[warn] ${message}`);
          }),
        );

        await jail.set(
          '_error',
          new ivm.Reference(function (...args: any[]) {
            const message = args.map((arg) => String(arg)).join(' ');
            logs.push(`[error] ${message}`);
          }),
        );

        // Bootstrap console object
        // Note: Variables registered via jail.set() are accessed without $ prefix in eval()
        await context.eval(`
          globalThis.console = {
            log: function(...args) { _log.applySync(undefined, args); },
            warn: function(...args) { _warn.applySync(undefined, args); },
            error: function(...args) { _error.applySync(undefined, args); }
          };
        `);
      } else {
        // Remove console when not allowed
        await context.eval(`
          delete globalThis.console;
        `);
      }

      // Wrap the script to make it async-compatible and enable strict mode
      // Use string concatenation to avoid template literal interpolation issues
      const wrappedScript = '(async function() {\n"use strict";\n' + script + '\n})()';

      // Compile and run the script
      const compiledScript = await isolate.compileScript(wrappedScript);
      const resultPromise = await compiledScript.run(context, {
        timeout: this.vmOptions.timeoutMs,
        promise: true,
      });

      // Wait for the promise to resolve
      const result = await resultPromise;

      // Copy result out of the isolate
      let finalResult: unknown;
      if (result && typeof result.copy === 'function') {
        finalResult = await result.copy();
      } else {
        finalResult = result;
      }

      return {
        success: true,
        result: finalResult,
        logs,
        timedOut: false,
      };
    } catch (error: any) {
      // Check if it's a timeout error
      const timedOut = error.message?.includes('timeout') || error.message?.includes('Script execution timed out');

      // Serialize error preserving all metadata (toolName, toolInput, code, details, etc.)
      const serializedError: VmExecutionError = {
        message: error?.message || 'Unknown error during script execution',
        name: error?.name || 'Error',
        stack: error?.stack,
      };

      // Preserve tool-specific metadata if present
      if (error && typeof error === 'object') {
        const errorObj = error as Record<string, unknown>;

        // Copy well-known tool error fields using bracket notation
        if ('toolName' in errorObj && errorObj['toolName'] !== undefined && errorObj['toolName'] !== null) {
          serializedError.toolName = errorObj['toolName'] as string;
        }
        if ('toolInput' in errorObj && errorObj['toolInput'] !== undefined && errorObj['toolInput'] !== null) {
          serializedError.toolInput = errorObj['toolInput'];
        }
        if ('code' in errorObj && errorObj['code'] !== undefined && errorObj['code'] !== null) {
          serializedError.code = errorObj['code'];
        }
        if ('details' in errorObj && errorObj['details'] !== undefined && errorObj['details'] !== null) {
          serializedError.details = errorObj['details'];
        }

        // Copy any other custom properties
        for (const [key, value] of Object.entries(errorObj)) {
          if (
            !(key in serializedError) &&
            key !== 'message' &&
            key !== 'name' &&
            key !== 'stack' &&
            value !== undefined &&
            value !== null
          ) {
            serializedError[key] = value;
          }
        }
      }

      return {
        success: false,
        error: serializedError,
        logs,
        timedOut,
      };
    } finally {
      // Clean up the isolate
      isolate.dispose();
    }
  }
}
