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
 * Secure proxy configuration per security level
 *
 * Controls which dangerous properties are blocked at runtime via JavaScript Proxies.
 * This provides defense-in-depth against computed property access attacks that
 * bypass static AST analysis.
 */
export interface SecureProxyLevelConfig {
  /**
   * Whether to block 'constructor' property access
   * Prevents: obj['const' + 'ructor'] attacks for code execution
   * @default true (blocks constructor for security)
   *
   * Set to false in PERMISSIVE mode for development/debugging
   */
  blockConstructor: boolean;

  /**
   * Whether to block prototype access (__proto__, prototype)
   * Prevents: prototype chain manipulation attacks
   * @default true (always recommended to keep true)
   */
  blockPrototype: boolean;

  /**
   * Whether to block legacy getter/setter methods
   * Blocks: __defineGetter__, __defineSetter__, __lookupGetter__, __lookupSetter__
   * @default true
   */
  blockLegacyAccessors: boolean;

  /**
   * Maximum depth for recursive proxying
   * Limits how deep nested objects are wrapped in secure proxies
   * @default 10
   */
  proxyMaxDepth: number;
}

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

  /**
   * Maximum total console output in bytes
   * Prevents I/O flood attacks via console.log spam
   */
  maxConsoleOutputBytes: number;

  /**
   * Maximum number of console calls (log, warn, error, info)
   * Prevents I/O flood attacks via excessive console calls
   */
  maxConsoleCalls: number;

  /**
   * Secure proxy configuration for runtime property access protection
   * Controls which dangerous properties are blocked via JavaScript Proxies
   */
  secureProxy: SecureProxyLevelConfig;
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
    maxConsoleOutputBytes: 64 * 1024, // 64KB - prevent I/O flood attacks
    maxConsoleCalls: 100,
    secureProxy: {
      blockConstructor: true,
      blockPrototype: true,
      blockLegacyAccessors: true,
      proxyMaxDepth: 5,
    },
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
    maxConsoleOutputBytes: 256 * 1024, // 256KB
    maxConsoleCalls: 500,
    secureProxy: {
      blockConstructor: true,
      blockPrototype: true,
      blockLegacyAccessors: true,
      proxyMaxDepth: 10,
    },
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
    maxConsoleOutputBytes: 1024 * 1024, // 1MB
    maxConsoleCalls: 1000,
    secureProxy: {
      blockConstructor: true,
      blockPrototype: true,
      blockLegacyAccessors: true,
      proxyMaxDepth: 15,
    },
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
    maxConsoleOutputBytes: 10 * 1024 * 1024, // 10MB
    maxConsoleCalls: 10000,
    secureProxy: {
      blockConstructor: false, // Allow constructor access for development/debugging
      blockPrototype: true, // Still block prototype for safety
      blockLegacyAccessors: true,
      proxyMaxDepth: 20,
    },
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

  /**
   * AI scoring result (if scoring gate is enabled)
   */
  scoringResult?: ScoringGateResult;
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

  /**
   * Maximum total console output in bytes
   * Default: Determined by securityLevel (1MB for STANDARD)
   * Prevents I/O flood attacks via console.log spam
   */
  maxConsoleOutputBytes?: number;

  /**
   * Maximum number of console calls (log, warn, error, info)
   * Default: Determined by securityLevel (1000 for STANDARD)
   * Prevents I/O flood attacks via excessive console calls
   */
  maxConsoleCalls?: number;
}

/**
 * Tool call handler function
 */
export type ToolHandler = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

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
  __safe_for: (init: () => void, test: () => boolean, update: () => void, body: () => void) => void;

  /**
   * Safe while loop wrapper
   * Enforces iteration limits
   */
  __safe_while: (test: () => boolean, body: () => void) => void;

  /**
   * Safe do-while loop wrapper
   * Enforces iteration limits
   */
  __safe_doWhile: (body: () => void, test: () => boolean) => void;

  /**
   * Safe string concatenation
   * Detects reference IDs and handles them appropriately
   */
  __safe_concat: (left: unknown, right: unknown) => unknown;

  /**
   * Safe template literal interpolation
   * Detects reference IDs in interpolated values
   */
  __safe_template: (quasis: string[], ...values: unknown[]) => unknown;

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

// Forward reference - imported at runtime to avoid circular dependency
import type { ReferenceSidecar } from './sidecar/reference-sidecar';
import type { ReferenceConfig } from './sidecar/reference-config';
import type { ScoringGateConfig, ScoringGateResult } from './scoring/types';
import type { WorkerPoolConfig } from './adapters/worker-pool/config';

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

  /**
   * Reference sidecar for pass-by-reference support (per-execution)
   * Created and disposed by the Enclave for each run
   */
  sidecar?: ReferenceSidecar;

  /**
   * Reference configuration for sidecar
   */
  referenceConfig?: ReferenceConfig;

  /**
   * Secure proxy configuration for runtime property blocking
   */
  secureProxyConfig?: SecureProxyLevelConfig;
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
  execute<T = unknown>(code: string, context: ExecutionContext): Promise<ExecutionResult<T>>;

  /**
   * Cleanup the sandbox
   */
  dispose(): void;
}

/**
 * Options for reference sidecar (pass-by-reference) support
 */
export interface ReferenceSidecarOptions {
  /**
   * Enable pass-by-reference support
   * When enabled, large strings are automatically lifted to a sidecar
   * and replaced with reference IDs.
   * @default false
   */
  enabled: boolean;

  /**
   * Maximum total size of all stored references in bytes
   * Prevents memory exhaustion from excessive data storage
   * @default Determined by securityLevel
   */
  maxTotalSize?: number;

  /**
   * Maximum size of a single reference in bytes
   * @default Determined by securityLevel
   */
  maxReferenceSize?: number;

  /**
   * Threshold in bytes to trigger extraction from source code
   * Strings larger than this are lifted to the sidecar
   * @default Determined by securityLevel
   */
  extractionThreshold?: number;

  /**
   * Maximum expanded size when resolving references for tool calls
   * @default Determined by securityLevel
   */
  maxResolvedSize?: number;

  /**
   * Whether to allow composite handles from string concatenation
   * If false, concatenating references throws an error
   * @default Determined by securityLevel (false for STRICT/SECURE)
   */
  allowComposites?: boolean;

  /**
   * Maximum number of references in a single execution
   * @default Determined by securityLevel
   */
  maxReferenceCount?: number;
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

  /**
   * Reference sidecar (pass-by-reference) configuration
   *
   * When enabled, the enclave:
   * - Extracts large strings from code and stores them in a sidecar
   * - Transforms concatenation to detect reference IDs
   * - Resolves references at the callTool boundary
   * - Lifts large tool results back to the sidecar
   *
   * This enables scripts to manipulate large data (videos, PDFs, images)
   * without loading them into the JavaScript sandbox.
   *
   * @example
   * ```typescript
   * const enclave = new Enclave({
   *   securityLevel: 'STRICT',
   *   sidecar: {
   *     enabled: true,
   *     extractionThreshold: 64 * 1024, // 64KB
   *   },
   * });
   * ```
   */
  sidecar?: ReferenceSidecarOptions;

  /**
   * AI Scoring Gate configuration
   *
   * Adds semantic security analysis that detects attack patterns
   * beyond what static AST validation can catch:
   * - Data exfiltration patterns (list→send)
   * - Excessive access (high limits, wildcards)
   * - Fan-out attacks (tool calls in loops)
   * - Sensitive data access (passwords, tokens)
   *
   * Runs AFTER AST validation but BEFORE code execution.
   *
   * @example
   * ```typescript
   * // Rule-based scorer (~1ms, zero dependencies)
   * const enclave = new Enclave({
   *   scoringGate: {
   *     scorer: 'rule-based',
   *     blockThreshold: 70,
   *   },
   * });
   *
   * // External API scorer (best detection)
   * const enclave = new Enclave({
   *   scoringGate: {
   *     scorer: 'external-api',
   *     externalApi: {
   *       endpoint: 'https://api.example.com/score',
   *       apiKey: process.env.SCORING_API_KEY,
   *     },
   *   },
   * });
   * ```
   */
  scoringGate?: ScoringGateConfig;

  /**
   * Worker Pool Adapter configuration
   *
   * Only used when adapter is set to 'worker_threads'.
   * Provides OS-level memory isolation via worker threads with:
   * - Pool management (min/max workers, scaling)
   * - Memory monitoring and enforcement
   * - Hard halt capability via worker.terminate()
   * - Rate limiting for message flood protection
   * - Dual-layer sandbox (worker thread + VM context)
   *
   * @example
   * ```typescript
   * const enclave = new Enclave({
   *   adapter: 'worker_threads',
   *   workerPoolConfig: {
   *     minWorkers: 2,
   *     maxWorkers: 8,
   *     memoryLimitPerWorker: 256 * 1024 * 1024, // 256MB
   *   },
   * });
   * ```
   */
  workerPoolConfig?: Partial<WorkerPoolConfig>;

  /**
   * Secure proxy configuration override
   *
   * Override individual secure proxy settings from the security level preset.
   * If not provided, uses the security level defaults.
   *
   * @example
   * ```typescript
   * // Use STRICT but allow constructor access for debugging
   * const enclave = new Enclave({
   *   securityLevel: 'STRICT',
   *   secureProxyConfig: { blockConstructor: false },
   * });
   * ```
   */
  secureProxyConfig?: Partial<SecureProxyLevelConfig>;
}

// Re-export scoring types for convenience
export type { ScoringGateConfig, ScoringGateResult };

// Re-export worker pool types for convenience
export type { WorkerPoolConfig };
