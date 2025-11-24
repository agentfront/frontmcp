// file: libs/plugins/src/codecall/services/isolated-vm.service.ts

import ivm from 'isolated-vm';
import { CodeCallVmEnvironment, ResolvedCodeCallVmOptions } from '../codecall.symbol';

/**
 * Result of VM execution
 */
export interface VmExecutionResult {
  success: boolean;
  result?: unknown;
  error?: {
    message: string;
    name: string;
    stack?: string;
  };
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

      // Create callTool as an async function accessible from the isolate
      await jail.set(
        'callTool',
        new ivm.Reference(async function (name: string, input: any) {
          try {
            const result = await environment.callTool(name, input);
            return new ivm.ExternalCopy(result).copyInto();
          } catch (error: any) {
            throw new Error(`Tool error: ${error.message}`);
          }
        }),
      );

      // Create getTool function
      await jail.set(
        'getTool',
        new ivm.Reference(function (name: string) {
          const tool = environment.getTool(name);
          if (!tool) return undefined;
          return new ivm.ExternalCopy(tool).copyInto();
        }),
      );

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
        await context.eval(`
          globalThis.console = {
            log: function(...args) { $_log.applySync(undefined, args); },
            warn: function(...args) { $_warn.applySync(undefined, args); },
            error: function(...args) { $_error.applySync(undefined, args); }
          };
        `);
      }

      // Wrap the script to make it async-compatible
      const wrappedScript = `
        (async function() {
          ${script}
        })()
      `;

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

      return {
        success: false,
        error: {
          message: error.message || 'Unknown error during script execution',
          name: error.name || 'Error',
          stack: error.stack,
        },
        logs,
        timedOut,
      };
    } finally {
      // Clean up the isolate
      isolate.dispose();
    }
  }
}
