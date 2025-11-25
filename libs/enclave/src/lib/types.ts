/**
 * Enclave Types and Interfaces
 *
 * Core types for the AgentScript execution environment.
 *
 * @packageDocumentation
 */

/**
 * Security levels for Enclave configuration
 *
 * These levels provide pre-configured security profiles that balance
 * functionality against security risk. Higher levels are more restrictive.
 *
 * @example
 * ```typescript
 * // Use STRICT for untrusted AI-generated code
 * const enclave = new Enclave({ securityLevel: 'STRICT' });
 *
 * // Use STANDARD for trusted internal tools
 * const enclave = new Enclave({ securityLevel: 'STANDARD' });
 * ```
 */
export type SecurityLevel = 'STRICT' | 'SECURE' | 'STANDARD' | 'PERMISSIVE';

/**
 * Security level configuration presets
 *
 * Each level adjusts:
 * - Resource limits (timeout, iterations, tool calls)
 * - Validation strictness
 * - Stack trace sanitization
 * - Value sanitization depth
 */
export interface SecurityLevelConfig {
  /**
   * Maximum execution time in milliseconds
   */
  timeout: number;

  /**
   * Maximum number of loop iterations
   */
  maxIterations: number;

  /**
   * Maximum number of tool calls
   */
  maxToolCalls: number;

  /**
   * Maximum depth for value sanitization
   */
  maxSanitizeDepth: number;

  /**
   * Maximum properties per object in sanitized values
   */
  maxSanitizeProperties: number;

  /**
   * Whether to sanitize stack traces (remove file paths, line numbers)
   */
  sanitizeStackTraces: boolean;

  /**
   * Whether to block Date.now() and performance timing APIs
   * (prevents timing attacks)
   */
  blockTimingAPIs: boolean;

  /**
   * Whether to allow while/do-while loops
   * (false = only bounded for/for-of loops allowed)
   */
  allowUnboundedLoops: boolean;

  /**
   * Whether to check for Unicode security attacks in code
   */
  unicodeSecurityCheck: boolean;

  /**
   * Whether to allow functions in custom globals
   */
  allowFunctionsInGlobals: boolean;
}

/**
 * Pre-defined security level configurations
 */
export const SECURITY_LEVEL_CONFIGS: Record<SecurityLevel, SecurityLevelConfig> = {
  /**
   * STRICT: Maximum security for untrusted code
   *
   * Use for:
   * - AI-generated code from external sources
   * - User-submitted scripts
   * - Untrusted third-party integrations
   *
   * Characteristics:
   * - Short timeout (5s)
   * - Low iteration limits (1000)
   * - Limited tool calls (10)
   * - Deep value sanitization
   * - Full stack trace sanitization
   * - Timing API blocking
   * - No unbounded loops
   * - Unicode security checks
   */
  STRICT: {
    timeout: 5000,
    maxIterations: 1000,
    maxToolCalls: 10,
    maxSanitizeDepth: 5,
    maxSanitizeProperties: 50,
    sanitizeStackTraces: true,
    blockTimingAPIs: true,
    allowUnboundedLoops: false,
    unicodeSecurityCheck: true,
    allowFunctionsInGlobals: false,
  },

  /**
   * SECURE: High security with more headroom
   *
   * Use for:
   * - AI-generated code from trusted models
   * - Internal automation scripts
   * - Controlled multi-tenant environments
   *
   * Characteristics:
   * - Moderate timeout (15s)
   * - Moderate iteration limits (5000)
   * - Moderate tool calls (50)
   * - Standard value sanitization
   * - Stack trace sanitization
   * - No timing API blocking
   * - No unbounded loops
   */
  SECURE: {
    timeout: 15000,
    maxIterations: 5000,
    maxToolCalls: 50,
    maxSanitizeDepth: 10,
    maxSanitizeProperties: 100,
    sanitizeStackTraces: true,
    blockTimingAPIs: false,
    allowUnboundedLoops: false,
    unicodeSecurityCheck: true,
    allowFunctionsInGlobals: false,
  },

  /**
   * STANDARD: Balanced security and functionality (DEFAULT)
   *
   * Use for:
   * - Internal tools and scripts
   * - Development and testing
   * - Trusted environments
   *
   * Characteristics:
   * - Standard timeout (30s)
   * - Standard iteration limits (10000)
   * - Standard tool calls (100)
   * - Basic value sanitization
   * - Minimal stack trace sanitization
   * - Unbounded loops allowed
   */
  STANDARD: {
    timeout: 30000,
    maxIterations: 10000,
    maxToolCalls: 100,
    maxSanitizeDepth: 20,
    maxSanitizeProperties: 500,
    sanitizeStackTraces: false,
    blockTimingAPIs: false,
    allowUnboundedLoops: true,
    unicodeSecurityCheck: false,
    allowFunctionsInGlobals: false,
  },

  /**
   * PERMISSIVE: Minimal restrictions
   *
   * Use for:
   * - Local development only
   * - Debugging
   * - Performance testing
   *
   * WARNING: Not recommended for production use with untrusted code
   *
   * Characteristics:
   * - Long timeout (60s)
   * - High iteration limits (100000)
   * - High tool calls (1000)
   * - Minimal sanitization
   * - No stack trace sanitization
   * - All features enabled
   */
  PERMISSIVE: {
    timeout: 60000,
    maxIterations: 100000,
    maxToolCalls: 1000,
    maxSanitizeDepth: 50,
    maxSanitizeProperties: 1000,
    sanitizeStackTraces: false,
    blockTimingAPIs: false,
    allowUnboundedLoops: true,
    unicodeSecurityCheck: false,
    allowFunctionsInGlobals: true,
  },
};

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
  config: Omit<Required<EnclaveConfig>, 'toolHandler'> & {
    toolHandler?: ToolHandler;
    sanitizeStackTraces: boolean;
    maxSanitizeDepth: number;
    maxSanitizeProperties: number;
  };

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
   * Security level preset
   *
   * Pre-configured security profiles that balance functionality against risk.
   * Individual options (timeout, maxIterations, etc.) override the preset values.
   *
   * Levels:
   * - STRICT: Maximum security for untrusted AI-generated code
   * - SECURE: High security with more headroom for trusted AI code
   * - STANDARD: Balanced security and functionality (DEFAULT)
   * - PERMISSIVE: Minimal restrictions (development only)
   *
   * @default 'STANDARD'
   *
   * @example
   * ```typescript
   * // Use STRICT for untrusted code
   * const enclave = new Enclave({ securityLevel: 'STRICT' });
   *
   * // Override specific values from the preset
   * const enclave = new Enclave({
   *   securityLevel: 'SECURE',
   *   timeout: 20000,  // Override SECURE's 15s default
   * });
   * ```
   */
  securityLevel?: SecurityLevel;

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

  /**
   * Whether to allow functions in custom globals
   * Default: Determined by securityLevel (false for STRICT/SECURE/STANDARD)
   *
   * Security Warning: Functions can leak host scope via closures.
   * Only enable if you understand the security implications.
   */
  allowFunctionsInGlobals?: boolean;

  /**
   * Whether to sanitize stack traces in error messages
   * Default: Determined by securityLevel (true for STRICT/SECURE)
   *
   * When enabled, file paths and line numbers are removed from stack traces
   * to prevent information leakage about the host system.
   */
  sanitizeStackTraces?: boolean;

  /**
   * Maximum depth for value sanitization in tool responses
   * Default: Determined by securityLevel
   */
  maxSanitizeDepth?: number;

  /**
   * Maximum properties per object in sanitized values
   * Default: Determined by securityLevel
   */
  maxSanitizeProperties?: number;
}
