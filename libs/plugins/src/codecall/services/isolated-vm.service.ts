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

      // Set up callTool and getTool using evalClosure
      // Use JSON serialization to transfer complex objects
      await context.evalClosure(
        `
        globalThis.callTool = function(name, input) {
          // Serialize input to JSON string for safe transfer
          const inputJson = JSON.stringify(input);
          return $0.applySyncPromise(undefined, [name, inputJson]);
        };
        globalThis.getTool = function(name) {
          return $1.applySync(undefined, [name]);
        };
        `,
        [
          async (name: string, inputJson: string) => {
            const input = JSON.parse(inputJson);
            const result = await environment.callTool(name, input);
            // Return result as JSON string
            return JSON.stringify(result);
          },
          (name: string) => {
            const tool = environment.getTool(name);
            if (!tool) return undefined;
            // Return tool as JSON string
            return JSON.stringify(tool);
          },
        ],
        { arguments: { reference: true } },
      );

      // Wrap the JSON-based callTool/getTool with JSON parsing
      await context.eval(`
        const _callToolJson = globalThis.callTool;
        const _getToolJson = globalThis.getTool;

        globalThis.callTool = async function(name, input) {
          const resultJson = await _callToolJson(name, input);
          return JSON.parse(resultJson);
        };

        globalThis.getTool = function(name) {
          const toolJson = _getToolJson(name);
          return toolJson ? JSON.parse(toolJson) : undefined;
        };
      `);

      // Set codecallContext as a read-only object
      const contextCopy = new ivm.ExternalCopy(environment.codecallContext);
      await jail.set('codecallContext', contextCopy.copyInto());

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
      }

      // Wrap the script to make it async-compatible
      // Use string concatenation to avoid template literal interpolation issues
      const wrappedScript = '(async function() {\n' + script + '\n})()';

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
