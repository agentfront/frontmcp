/**
 * Enclave-VM Secure Code Executor
 *
 * Executes bundled code in a secure sandbox using enclave-vm.
 * Provides defense-in-depth security with:
 * - AST-based validation (81+ blocked attack vectors)
 * - Timeout enforcement (default 5000ms)
 * - Resource limits (maxIterations, maxToolCalls)
 * - Six security layers
 *
 * @packageDocumentation
 */

import { Enclave, type CreateEnclaveOptions, type SecurityLevel } from 'enclave-vm';
import type { SecurityPolicy } from '../types';

/**
 * Context for code execution.
 */
export interface ExecutionContext {
  /**
   * React module to inject.
   */
  React?: unknown;

  /**
   * ReactDOM module to inject.
   */
  ReactDOM?: unknown;

  /**
   * Additional modules to inject.
   */
  modules?: Record<string, unknown>;

  /**
   * Additional global variables.
   */
  globals?: Record<string, unknown>;

  /**
   * Security policy to enforce.
   */
  security?: SecurityPolicy;

  /**
   * Execution timeout in milliseconds.
   * @default 5000
   */
  timeout?: number;

  /**
   * Maximum loop iterations allowed.
   * @default 10000
   */
  maxIterations?: number;
}

/**
 * Result of code execution.
 */
export interface ExecutionResult<T = unknown> {
  /**
   * Exported value from the code.
   */
  exports: T;

  /**
   * Execution time in ms.
   */
  executionTime: number;

  /**
   * Console output captured during execution.
   */
  consoleOutput?: string[];
}

/**
 * Default enclave options for secure widget execution.
 */
const DEFAULT_ENCLAVE_OPTIONS: Partial<CreateEnclaveOptions> = {
  securityLevel: 'SECURE',
  timeout: 5000,
  maxIterations: 10000,
  validate: true,
  transform: true,
};

/**
 * Threshold of blocked imports that triggers STRICT security level.
 * When a SecurityPolicy blocks more than this many imports, we escalate to STRICT.
 */
const STRICT_SECURITY_BLOCKED_IMPORTS_THRESHOLD = 10;

/**
 * Map SecurityPolicy to enclave-vm security level.
 */
function mapSecurityLevel(policy?: SecurityPolicy): SecurityLevel {
  // If policy has specific blockedImports or restrictive settings, use STRICT
  if (policy?.blockedImports && policy.blockedImports.length > STRICT_SECURITY_BLOCKED_IMPORTS_THRESHOLD) {
    return 'STRICT';
  }
  // Default to SECURE for widget code
  return 'SECURE';
}

/**
 * Create a minimal JSX runtime from React.
 */
function createJSXRuntime(React: unknown): Record<string, unknown> {
  const R = React as {
    createElement: (...args: unknown[]) => unknown;
    Fragment: unknown;
  };

  return {
    jsx: (type: unknown, props: Record<string, unknown>, key?: string) => {
      const { children, ...rest } = props;
      return R.createElement(type, key ? { ...rest, key } : rest, children);
    },
    jsxs: (type: unknown, props: Record<string, unknown>, key?: string) => {
      const { children, ...rest } = props;
      return R.createElement(type, key ? { ...rest, key } : rest, children);
    },
    jsxDEV: (
      type: unknown,
      props: Record<string, unknown>,
      key: string | undefined,
      _isStaticChildren: boolean,
      _source: unknown,
      _self: unknown,
    ) => {
      const { children, ...rest } = props;
      return R.createElement(type, key ? { ...rest, key } : rest, children);
    },
    Fragment: R.Fragment,
  };
}

/**
 * Build globals object from execution context.
 */
function buildGlobals(context: ExecutionContext): Record<string, unknown> {
  const globals: Record<string, unknown> = {};

  // Add React and ReactDOM if provided
  if (context.React) {
    globals['React'] = context.React;
  }
  if (context.ReactDOM) {
    globals['ReactDOM'] = context.ReactDOM;
  }

  // Add JSX runtime if React is available
  if (context.React) {
    const jsxRuntime = createJSXRuntime(context.React);
    globals['__jsx'] = jsxRuntime['jsx'];
    globals['__jsxs'] = jsxRuntime['jsxs'];
    globals['__jsxDEV'] = jsxRuntime['jsxDEV'];
    globals['Fragment'] = jsxRuntime['Fragment'];
  }

  // Add modules as globals (enclave-vm handles require internally)
  if (context.modules) {
    for (const [key, value] of Object.entries(context.modules)) {
      // Make modules accessible as globals
      globals[key.replace(/[^a-zA-Z0-9_$]/g, '_')] = value;
    }
  }

  // Add user globals
  if (context.globals) {
    Object.assign(globals, context.globals);
  }

  return globals;
}

/**
 * Build require function for module resolution.
 */
function buildRequireFunction(context: ExecutionContext): (id: string) => unknown {
  // Normalize all context.modules keys to lowercase for consistent lookup
  const normalizedContextModules: Record<string, unknown> = {};
  if (context.modules) {
    for (const [key, value] of Object.entries(context.modules)) {
      normalizedContextModules[key.toLowerCase()] = value;
    }
  }

  const modules: Record<string, unknown> = {
    react: context.React,
    'react-dom': context.ReactDOM,
    'react/jsx-runtime': context.React ? createJSXRuntime(context.React) : undefined,
    'react/jsx-dev-runtime': context.React ? createJSXRuntime(context.React) : undefined,
    ...normalizedContextModules,
  };

  return (id: string): unknown => {
    const normalizedId = id.toLowerCase();

    if (normalizedId in modules) {
      const mod = modules[normalizedId];
      if (mod === undefined) {
        throw new Error(`Module '${id}' is not available. Did you forget to provide it in the context?`);
      }
      return mod;
    }

    throw new Error(`Module '${id}' is not available in the sandbox environment`);
  };
}

/**
 * Execute bundled code in a secure enclave-vm sandbox.
 *
 * Provides a sandboxed execution context with:
 * - AST-based code validation (81+ attack vectors blocked)
 * - Timeout enforcement (default 5000ms)
 * - Resource limits (maxIterations)
 * - Six security layers (defense-in-depth)
 *
 * @param code - Bundled JavaScript code
 * @param context - Execution context
 * @returns Execution result with exports
 *
 * @example
 * ```typescript
 * const code = `
 *   const React = require('react');
 *   function Widget({ data }) {
 *     return React.createElement('div', null, data.message);
 *   }
 *   module.exports = Widget;
 * `;
 *
 * const result = await executeCode(code, {
 *   React: require('react'),
 *   timeout: 3000,
 * });
 *
 * console.log(result.exports); // Widget function
 * ```
 */
export async function executeCode<T = unknown>(
  code: string,
  context: ExecutionContext = {},
): Promise<ExecutionResult<T>> {
  const consoleOutput: string[] = [];

  // Build globals with console capture
  const globals = buildGlobals(context);

  // Add sandboxed console
  globals['console'] = {
    log: (...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    },
    info: (...args: unknown[]) => {
      consoleOutput.push(`[INFO] ${args.map(String).join(' ')}`);
    },
    warn: (...args: unknown[]) => {
      consoleOutput.push(`[WARN] ${args.map(String).join(' ')}`);
    },
    error: (...args: unknown[]) => {
      consoleOutput.push(`[ERROR] ${args.map(String).join(' ')}`);
    },
    debug: (...args: unknown[]) => {
      consoleOutput.push(`[DEBUG] ${args.map(String).join(' ')}`);
    },
    trace: () => {},
    dir: () => {},
    table: () => {},
    group: () => {},
    groupEnd: () => {},
    time: () => {},
    timeEnd: () => {},
    assert: () => {},
    clear: () => {},
    count: () => {},
    countReset: () => {},
  };

  // Add require function
  globals['require'] = buildRequireFunction(context);

  // Create enclave with options
  const enclave = new Enclave({
    ...DEFAULT_ENCLAVE_OPTIONS,
    timeout: context.timeout ?? DEFAULT_ENCLAVE_OPTIONS.timeout,
    maxIterations: context.maxIterations ?? DEFAULT_ENCLAVE_OPTIONS.maxIterations,
    securityLevel: mapSecurityLevel(context.security),
    globals,
    allowFunctionsInGlobals: true, // Required for React components
  });

  try {
    // Wrap code in module pattern to match CommonJS behavior
    const wrappedCode = `
      const module = { exports: {} };
      const exports = module.exports;
      const __filename = 'widget.js';
      const __dirname = '/';
      ${code}
      return module.exports;
    `;

    const result = await enclave.run<T>(wrappedCode);

    if (!result.success) {
      const errorMessage = result.error?.message ?? 'Execution failed';
      const errorCode = result.error?.code;

      // Map enclave error codes to descriptive messages
      if (errorCode === 'TIMEOUT') {
        throw new ExecutionError(`Execution timed out after ${context.timeout ?? DEFAULT_ENCLAVE_OPTIONS.timeout}ms`, {
          code: 'TIMEOUT',
        });
      }
      if (errorCode === 'MAX_ITERATIONS') {
        throw new ExecutionError(
          `Maximum iterations exceeded (${context.maxIterations ?? DEFAULT_ENCLAVE_OPTIONS.maxIterations})`,
          {
            code: 'MAX_ITERATIONS',
          },
        );
      }
      if (errorCode === 'VALIDATION_ERROR') {
        throw new ExecutionError(`Security validation failed: ${errorMessage}`, { code: 'SECURITY_VIOLATION' });
      }

      throw new ExecutionError(errorMessage, result.error);
    }

    return {
      exports: result.value as T,
      executionTime: result.stats.duration,
      consoleOutput: consoleOutput.length > 0 ? consoleOutput : undefined,
    };
  } finally {
    enclave.dispose();
  }
}

/**
 * Execute bundled code and extract the default export.
 *
 * Convenience wrapper around executeCode that extracts
 * the default export.
 *
 * @param code - Bundled JavaScript code
 * @param context - Execution context
 * @returns Default export from the code
 */
export async function executeDefault<T = unknown>(code: string, context: ExecutionContext = {}): Promise<T> {
  const result = await executeCode<{ default?: T } & Record<string, unknown>>(code, context);

  // Check for default export
  if ('default' in result.exports) {
    return result.exports.default as T;
  }

  // Check for named exports
  const exportKeys = Object.keys(result.exports);

  // Handle empty exports - throw error as code should export something
  if (exportKeys.length === 0) {
    throw new ExecutionError('Code did not export any values');
  }

  // If only one named export, return it as the default
  if (exportKeys.length === 1) {
    return result.exports[exportKeys[0]] as T;
  }

  // Multiple exports - return the whole exports object
  return result.exports as T;
}

/**
 * Error thrown during code execution.
 */
export class ExecutionError extends Error {
  /** Error code for categorization */
  code?: string;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ExecutionError';

    // Extract code from cause if present
    if (cause && typeof cause === 'object' && 'code' in cause) {
      this.code = (cause as { code: string }).code;
    }
  }
}

/**
 * Check if an error is an ExecutionError.
 */
export function isExecutionError(error: unknown): error is ExecutionError {
  return error instanceof ExecutionError;
}
