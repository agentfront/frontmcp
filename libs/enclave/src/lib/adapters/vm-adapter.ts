/**
 * VM Adapter - Node.js vm module implementation
 *
 * Uses Node.js built-in vm module for sandboxed code execution.
 * Provides isolated execution context with controlled globals.
 *
 * @packageDocumentation
 */

import * as vm from 'vm';
import type {
  SandboxAdapter,
  ExecutionContext,
  ExecutionResult,
} from '../types';
import { createSafeRuntime } from '../safe-runtime';

/**
 * Sanitize stack trace by removing host file system paths
 * Security: Prevents information leakage about host environment
 *
 * @param stack Original stack trace
 * @returns Sanitized stack trace
 */
function sanitizeStackTrace(stack: string | undefined): string | undefined {
  if (!stack) return stack;

  // Remove absolute file paths while preserving the stack structure
  return stack
    .split('\n')
    .map(line => {
      // Remove absolute paths (Unix/Mac: /Users/, /home/, Linux: /var/, Windows: C:\)
      return line
        .replace(/\/Users\/[^/]+\/[^\s)]+/g, '[REDACTED]')
        .replace(/\/home\/[^/]+\/[^\s)]+/g, '[REDACTED]')
        .replace(/\/var\/[^\s)]+/g, '[REDACTED]')
        .replace(/\/opt\/[^\s)]+/g, '[REDACTED]')
        .replace(/C:\\[^\s)]+/g, '[REDACTED]')
        .replace(/D:\\[^\s)]+/g, '[REDACTED]');
    })
    .join('\n');
}

/**
 * VM-based sandbox adapter
 *
 * Uses Node.js vm module to execute AgentScript code in an isolated context.
 * Injects safe runtime wrappers and controls available globals.
 */
export class VmAdapter implements SandboxAdapter {
  private context?: vm.Context;

  /**
   * Execute code in the VM sandbox
   *
   * @param code Transformed AgentScript code to execute
   * @param executionContext Execution context with config and handlers
   * @returns Execution result
   */
  async execute<T = unknown>(
    code: string,
    executionContext: ExecutionContext
  ): Promise<ExecutionResult<T>> {
    const { stats, config } = executionContext;
    const startTime = Date.now();

    try {
      // Create safe runtime context
      const safeRuntime = createSafeRuntime(executionContext);

      // Create sandbox context with safe globals only
      // IMPORTANT: Use empty object to get NEW isolated prototypes
      const sandbox = vm.createContext({});

      // Add safe runtime functions to the isolated context
      // We must do this WITHOUT using Object.assign to avoid prototype chain issues
      for (const [key, value] of Object.entries(safeRuntime)) {
        (sandbox as any)[key] = value;
      }

      // Add user-provided globals (if any)
      if (config.globals) {
        for (const [key, value] of Object.entries(config.globals)) {
          (sandbox as any)[key] = value;
        }
      }

      // Add console (bind to host console)
      // These are just function references, safe to assign
      (sandbox as any).console = {
        log: console.log.bind(console),
        error: console.error.bind(console),
        warn: console.warn.bind(console),
        info: console.info.bind(console),
      };

      // Store context
      this.context = sandbox;

      // Wrap code in async IIFE to handle top-level await
      const wrappedCode = `
        (async () => {
          ${code}
          return typeof __ag_main === 'function' ? await __ag_main() : undefined;
        })();
      `;

      // Compile script
      const script = new vm.Script(wrappedCode, {
        filename: 'agentscript.js',
      });

      // Execute script with timeout
      const resultPromise = script.runInContext(this.context, {
        timeout: config.timeout,
        breakOnSigint: true,
      });

      // Wait for result
      const value = await resultPromise;

      // Update stats
      stats.duration = Date.now() - startTime;
      stats.endTime = Date.now();

      return {
        success: true,
        value: value as T,
        stats,
      };
    } catch (error: unknown) {
      const err = error as Error;

      // Update stats
      stats.duration = Date.now() - startTime;
      stats.endTime = Date.now();

      return {
        success: false,
        error: {
          name: err.name || 'VMExecutionError',
          message: err.message || 'Unknown VM execution error',
          stack: sanitizeStackTrace(err.stack),
          code: 'VM_EXECUTION_ERROR',
        },
        stats,
      };
    }
  }

  /**
   * Dispose the VM context and cleanup resources
   */
  dispose(): void {
    // VM contexts are garbage collected automatically
    this.context = undefined;
  }
}
