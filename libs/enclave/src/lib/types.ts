/**
 * Enclave Types and Interfaces
 *
 * Core types for the AgentScript execution environment.
 *
 * @packageDocumentation
 */

/**
 * Result of executing AgentScript code
 */
export interface ExecutionResult<T = unknown> {
  /**
   * Whether execution was successful
   */
  success: boolean;

  /**
   * Return value from the script (if successful)
   */
  value?: T;

  /**
   * Error that occurred during execution (if failed)
   */
  error?: ExecutionError;

  /**
   * Execution statistics
   */
  stats: ExecutionStats;
}

/**
 * Execution error details
 */
export interface ExecutionError {
  /**
   * Error message
   */
  message: string;

  /**
   * Error name/type
   */
  name: string;

  /**
   * Stack trace (if available)
   */
  stack?: string;

  /**
   * Error code (for structured errors)
   */
  code?: string;

  /**
   * Additional error data
   */
  data?: Record<string, unknown>;
}

/**
 * Execution statistics
 */
export interface ExecutionStats {
  /**
   * Execution duration in milliseconds
   */
  duration: number;

  /**
   * Peak memory usage in bytes (if available)
   */
  memoryUsage?: number;

  /**
   * Number of tool calls made
   */
  toolCallCount: number;

  /**
   * Number of loop iterations executed
   */
  iterationCount: number;

  /**
   * Timestamp when execution started
   */
  startTime: number;

  /**
   * Timestamp when execution ended
   */
  endTime: number;
}

/**
 * Configuration for Enclave execution
 */
export interface EnclaveConfig {
  /**
   * Maximum execution time in milliseconds
   * Default: 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Maximum memory usage in bytes
   * Default: 128 * 1024 * 1024 (128MB)
   */
  memoryLimit?: number;

  /**
   * Maximum number of tool calls allowed
   * Default: 100
   */
  maxToolCalls?: number;

  /**
   * Maximum number of loop iterations (per loop)
   * Default: 10000
   */
  maxIterations?: number;

  /**
   * Sandbox adapter to use
   * Default: 'vm'
   */
  adapter?: 'vm' | 'isolated-vm' | 'worker_threads';

  /**
   * Whether to allow access to Node.js built-ins
   * Default: false
   */
  allowBuiltins?: boolean;

  /**
   * Custom globals to inject into the sandbox
   */
  globals?: Record<string, unknown>;

  /**
   * Tool call handler
   * This function is called when the script calls __safe_callTool
   */
  toolHandler?: ToolHandler;
}

/**
 * Tool call handler function
 */
export type ToolHandler = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<unknown>;

/**
 * Safe runtime context provided to AgentScript code
 */
export interface SafeRuntimeContext {
  /**
   * Safe tool call function
   * Tracks calls, enforces limits, and delegates to the tool handler
   */
  __safe_callTool: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

  /**
   * Safe for-of loop iterator
   * Enforces iteration limits
   */
  __safe_forOf: <T>(iterable: Iterable<T>) => Iterable<T>;

  /**
   * Safe for loop wrapper
   * Enforces iteration limits
   */
  __safe_for: (
    init: () => void,
    test: () => boolean,
    update: () => void,
    body: () => void
  ) => void;

  /**
   * Safe while loop wrapper
   * Enforces iteration limits
   */
  __safe_while: (test: () => boolean, body: () => void) => void;

  /**
   * Whitelisted safe globals
   */
  Math: typeof Math;
  JSON: typeof JSON;
  Array: typeof Array;
  Object: typeof Object;
  String: typeof String;
  Number: typeof Number;
  Date: typeof Date;
  NaN: typeof NaN;
  Infinity: typeof Infinity;
  undefined: typeof undefined;
  isNaN: typeof isNaN;
  isFinite: typeof isFinite;
  parseInt: typeof parseInt;
  parseFloat: typeof parseFloat;
}

/**
 * Internal execution context (tracks state during execution)
 */
export interface ExecutionContext {
  /**
   * Configuration
   */
  config: Omit<Required<EnclaveConfig>, 'toolHandler'> & { toolHandler?: ToolHandler };

  /**
   * Statistics tracker
   */
  stats: ExecutionStats;

  /**
   * Abort controller for cancellation
   */
  abortController: AbortController;

  /**
   * Whether execution has been aborted
   */
  aborted: boolean;

  /**
   * Tool handler
   */
  toolHandler?: ToolHandler;
}

/**
 * Sandbox adapter interface
 * Different sandboxing strategies (isolated-vm, vm2, worker_threads) implement this
 */
export interface SandboxAdapter {
  /**
   * Execute code in the sandbox
   *
   * @param code Transformed AgentScript code to execute
   * @param context Execution context
   * @returns Execution result
   */
  execute<T = unknown>(
    code: string,
    context: ExecutionContext
  ): Promise<ExecutionResult<T>>;

  /**
   * Cleanup the sandbox
   */
  dispose(): void;
}

/**
 * Options for creating an Enclave instance
 */
export interface CreateEnclaveOptions extends EnclaveConfig {
  /**
   * Whether to validate AgentScript code before execution
   * Default: true
   */
  validate?: boolean;

  /**
   * Whether to transform AgentScript code before execution
   * Default: true
   */
  transform?: boolean;
}
