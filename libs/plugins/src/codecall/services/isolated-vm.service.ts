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

      // Create a wrapper for callTool that returns a promise
      const callToolWrapper = new ivm.Reference(async (name: string, input: any) => {
        try {
          const result = await environment.callTool(name, input);
          return new ivm.ExternalCopy(result).copyInto();
        } catch (error: any) {
          throw new Error(`Tool error: ${error.message}`);
        }
      });

      await jail.set('callTool', callToolWrapper);

      // Create a wrapper for getTool
      const getToolWrapper = new ivm.Reference((name: string) => {
        const tool = environment.getTool(name);
        if (!tool) return undefined;
        return new ivm.ExternalCopy(tool).copyInto();
      });

      await jail.set('getTool', getToolWrapper);

      // Set codecallContext as a read-only object
      const contextCopy = new ivm.ExternalCopy(environment.codecallContext);
      await jail.set('codecallContext', contextCopy.copyInto({ transferIn: true }));

      // Set up console if allowed
      if (this.vmOptions.allowConsole && environment.console) {
        const consoleLog = new ivm.Reference((...args: any[]) => {
          const message = args.map((arg) => String(arg)).join(' ');
          logs.push(`[log] ${message}`);
          if (environment.console) {
            environment.console.log(message);
          }
        });

        const consoleWarn = new ivm.Reference((...args: any[]) => {
          const message = args.map((arg) => String(arg)).join(' ');
          logs.push(`[warn] ${message}`);
          if (environment.console) {
            environment.console.warn(message);
          }
        });

        const consoleError = new ivm.Reference((...args: any[]) => {
          const message = args.map((arg) => String(arg)).join(' ');
          logs.push(`[error] ${message}`);
          if (environment.console) {
            environment.console.error(message);
          }
        });

        await jail.set('console', {
          log: consoleLog,
          warn: consoleWarn,
          error: consoleError,
        });
      }

      // Set up mcpLog if available
      if (environment.mcpLog) {
        const mcpLogWrapper = new ivm.Reference(
          (level: string, message: string, metadata?: Record<string, unknown>) => {
            logs.push(`[mcp:${level}] ${message}`);
            if (environment.mcpLog) {
              environment.mcpLog(level as any, message, metadata);
            }
          },
        );

        await jail.set('mcpLog', mcpLogWrapper);
      }

      // Set up mcpNotify if available
      if (environment.mcpNotify) {
        const mcpNotifyWrapper = new ivm.Reference((event: string, payload: Record<string, unknown>) => {
          logs.push(`[notify] ${event}`);
          if (environment.mcpNotify) {
            environment.mcpNotify(event, payload);
          }
        });

        await jail.set('mcpNotify', mcpNotifyWrapper);
      }

      // Wrap the script to make it async-compatible
      const wrappedScript = `
        (async () => {
          ${script}
        })()
      `;

      // Compile and run the script
      const compiledScript = await isolate.compileScript(wrappedScript);
      const result = await compiledScript.run(context, {
        timeout: this.vmOptions.timeoutMs,
        reference: true,
      });

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
