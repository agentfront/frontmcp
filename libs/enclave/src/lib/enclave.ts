/**
 * Enclave - Safe AgentScript Execution Environment
 *
 * Provides a sandboxed environment for executing AgentScript code with:
 * - AST validation
 * - Code transformation
 * - Runtime safety wrappers
 * - Resource limits (timeout, memory, iterations)
 *
 * @packageDocumentation
 */

import { JSAstValidator, createAgentScriptPreset } from 'ast-guard';
import { transformAgentScript, isWrappedInMain } from 'ast-guard';
import type {
  EnclaveConfig,
  CreateEnclaveOptions,
  ExecutionResult,
  ExecutionContext,
  ExecutionStats,
  SandboxAdapter,
  ToolHandler,
} from './types';
import { createSafeRuntime } from './safe-runtime';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
  timeout: 30000, // 30 seconds
  memoryLimit: 128 * 1024 * 1024, // 128MB
  maxToolCalls: 100,
  maxIterations: 10000,
  adapter: 'vm' as const,
  allowBuiltins: false,
  globals: {},
  toolHandler: undefined as ToolHandler | undefined,
};

/**
 * Enclave - Safe AgentScript Execution Environment
 *
 * @example
 * ```typescript
 * import { Enclave } from '@frontmcp/enclave';
 *
 * // Create enclave with tool handler
 * const enclave = new Enclave({
 *   timeout: 5000,
 *   maxToolCalls: 50,
 *   toolHandler: async (toolName, args) => {
 *     // Handle tool calls
 *     return { result: 'data' };
 *   },
 * });
 *
 * // Execute AgentScript code
 * const code = `
 *   const users = await callTool('users:list', {});
 *   return users.items.length;
 * `;
 *
 * const result = await enclave.run(code);
 * console.log(result.value); // Number of users
 * ```
 */
export class Enclave {
  private readonly config: Omit<Required<EnclaveConfig>, 'toolHandler'> & { toolHandler?: ToolHandler };
  private readonly validator: JSAstValidator;
  private readonly validateCode: boolean;
  private readonly transformCode: boolean;
  private adapter?: SandboxAdapter;

  constructor(options: CreateEnclaveOptions = {}) {
    // Merge with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...options,
      globals: {
        ...DEFAULT_CONFIG.globals,
        ...options.globals,
      },
    };

    // Create validator with custom globals
    // Extract custom global names from options
    const customGlobalNames = options.globals ? Object.keys(options.globals) : [];

    // For each custom global, we need to whitelist both:
    // 1. The original name (customValue)
    // 2. The transformed name (__safe_customValue)
    const customAllowedGlobals = customGlobalNames.flatMap(name => [
      name,
      `__safe_${name}`,
    ]);

    this.validator = new JSAstValidator(createAgentScriptPreset({
      allowedGlobals: [
        'callTool',
        'Math',
        'JSON',
        'Array',
        'Object',
        'String',
        'Number',
        'Date',
        '__safe_callTool',
        '__safe_forOf',
        '__safe_for',
        '__safe_while',
        '__safe_doWhile',
        ...customAllowedGlobals,
      ],
    }));

    // Configuration flags
    this.validateCode = options.validate !== false; // Default: true
    this.transformCode = options.transform !== false; // Default: true

    // Adapter will be lazy-loaded based on config.adapter
  }

  /**
   * Execute AgentScript code
   *
   * @param code AgentScript code to execute
   * @param toolHandler Optional tool handler (overrides constructor config)
   * @returns Execution result
   */
  async run<T = unknown>(
    code: string,
    toolHandler?: ToolHandler
  ): Promise<ExecutionResult<T>> {
    const startTime = Date.now();

    // Initialize stats
    const stats: ExecutionStats = {
      duration: 0,
      toolCallCount: 0,
      iterationCount: 0,
      startTime,
      endTime: 0,
    };

    try {
      // Step 1: Transform (if enabled) - MUST happen before validation
      // because AgentScript allows top-level return, await, etc. which are only
      // valid after wrapping in async function __ag_main()
      let transformedCode = code;
      if (this.transformCode) {
        // Check if already wrapped
        const needsWrapping = !isWrappedInMain(code);

        transformedCode = transformAgentScript(code, {
          wrapInMain: needsWrapping,
          transformCallTool: true,
          transformLoops: true,
        });
      }

      // Step 2: Validate (if enabled) - validate TRANSFORMED code
      if (this.validateCode) {
        const validationResult = await this.validator.validate(transformedCode);
        if (!validationResult.valid) {
          const errorMessages = validationResult.issues
            .map(issue => `${issue.code}: ${issue.message}`)
            .join('\n');

          return {
            success: false,
            error: {
              name: 'ValidationError',
              message: `AgentScript validation failed:\n${errorMessages}`,
              code: 'VALIDATION_ERROR',
              data: { issues: validationResult.issues },
            },
            stats: {
              ...stats,
              duration: Date.now() - startTime,
              endTime: Date.now(),
            },
          };
        }
      }

      // Step 3: Create execution context
      const context: ExecutionContext = {
        config: this.config,
        stats,
        abortController: new AbortController(),
        aborted: false,
        toolHandler: toolHandler || this.config.toolHandler,
      };

      // Set up timeout
      const timeoutId = setTimeout(() => {
        context.aborted = true;
        context.abortController.abort();
      }, this.config.timeout);

      try {
        // Step 4: Execute in sandbox
        const adapter = await this.getAdapter();
        const result = await adapter.execute<T>(transformedCode, context);

        // Clear timeout
        clearTimeout(timeoutId);

        return result;
      } catch (error: unknown) {
        // Clear timeout
        clearTimeout(timeoutId);

        const err = error as Error;
        return {
          success: false,
          error: {
            name: err.name || 'ExecutionError',
            message: err.message || 'Unknown execution error',
            stack: err.stack,
            code: 'EXECUTION_ERROR',
          },
          stats: {
            ...stats,
            duration: Date.now() - startTime,
            endTime: Date.now(),
          },
        };
      }
    } catch (error: unknown) {
      const err = error as Error;
      return {
        success: false,
        error: {
          name: err.name || 'EnclaveError',
          message: err.message || 'Unknown enclave error',
          stack: err.stack,
          code: 'ENCLAVE_ERROR',
        },
        stats: {
          ...stats,
          duration: Date.now() - startTime,
          endTime: Date.now(),
        },
      };
    }
  }

  /**
   * Get or create the sandbox adapter
   */
  private async getAdapter(): Promise<SandboxAdapter> {
    if (this.adapter) {
      return this.adapter;
    }

    // Lazy-load adapter based on configuration
    switch (this.config.adapter) {
      case 'vm': {
        const { VmAdapter } = await import('./adapters/vm-adapter.js');
        this.adapter = new VmAdapter();
        return this.adapter!;
      }

      case 'isolated-vm':
        throw new Error('isolated-vm adapter not yet implemented');

      case 'worker_threads':
        throw new Error('worker_threads adapter not yet implemented');

      default:
        throw new Error(`Unknown adapter: ${this.config.adapter}`);
    }
  }

  /**
   * Dispose the enclave and cleanup resources
   */
  dispose(): void {
    if (this.adapter) {
      this.adapter.dispose();
      this.adapter = undefined;
    }
  }
}

/**
 * Convenience function to create an enclave and run code in one step
 *
 * @param code AgentScript code to execute
 * @param options Enclave configuration options
 * @returns Execution result
 */
export async function runAgentScript<T = unknown>(
  code: string,
  options: CreateEnclaveOptions = {}
): Promise<ExecutionResult<T>> {
  const enclave = new Enclave(options);
  try {
    return await enclave.run<T>(code);
  } finally {
    enclave.dispose();
  }
}
