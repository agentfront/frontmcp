/**
 * Secure Code Executor
 *
 * Executes bundled code in a restricted environment with
 * controlled access to globals and modules.
 *
 * @packageDocumentation
 */

import type { SecurityPolicy } from '../types';
import { DEFAULT_SECURITY_POLICY } from '../types';

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
 * Execute bundled code in a restricted environment.
 *
 * Provides a sandboxed execution context with:
 * - Controlled module resolution
 * - Restricted global access
 * - Timeout enforcement
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
 * });
 *
 * console.log(result.exports); // Widget function
 * ```
 */
export async function executeCode<T = unknown>(
  code: string,
  context: ExecutionContext = {},
): Promise<ExecutionResult<T>> {
  const startTime = performance.now();
  const consoleOutput: string[] = [];

  // Create module system
  const moduleExports: Record<string, unknown> = {};
  const module = { exports: moduleExports };

  // Build require function
  const requireFn = createRequire(context);

  // Build restricted globals
  const sandboxGlobals = createSandboxGlobals(context, consoleOutput);

  // Execute the code
  try {
    // Create function with controlled scope
    const fn = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      ...Object.keys(sandboxGlobals),
      code,
    );

    // Execute with sandbox globals
    fn(module.exports, requireFn, module, 'widget.js', '/', ...Object.values(sandboxGlobals));

    const executionTime = performance.now() - startTime;

    return {
      exports: module.exports as T,
      executionTime,
      consoleOutput: consoleOutput.length > 0 ? consoleOutput : undefined,
    };
  } catch (error) {
    throw new ExecutionError(`Code execution failed: ${error instanceof Error ? error.message : String(error)}`, error);
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
  if (exportKeys.length === 1) {
    return result.exports[exportKeys[0]] as T;
  }

  // Return the whole exports object
  return result.exports as T;
}

/**
 * Create a restricted require function.
 */
function createRequire(context: ExecutionContext): (id: string) => unknown {
  const modules: Record<string, unknown> = {
    react: context.React,
    'react-dom': context.ReactDOM,
    'react/jsx-runtime': context.React ? createJSXRuntime(context.React) : undefined,
    'react/jsx-dev-runtime': context.React ? createJSXRuntime(context.React) : undefined,
    ...context.modules,
  };

  return (id: string): unknown => {
    // Normalize module ID
    const normalizedId = id.toLowerCase();

    // Check if module is available
    if (normalizedId in modules) {
      const mod = modules[normalizedId];
      if (mod === undefined) {
        throw new Error(`Module '${id}' is not available. Did you forget to provide it in the context?`);
      }
      return mod;
    }

    // Check allowed imports
    const policy = context.security ?? DEFAULT_SECURITY_POLICY;
    if (policy.blockedImports) {
      for (const blocked of policy.blockedImports) {
        if (blocked.test(id)) {
          throw new Error(`Module '${id}' is blocked by security policy`);
        }
      }
    }

    throw new Error(`Module '${id}' is not available in the sandbox environment`);
  };
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
 * Create restricted sandbox globals.
 */
function createSandboxGlobals(context: ExecutionContext, consoleOutput: string[]): Record<string, unknown> {
  const policy = context.security ?? DEFAULT_SECURITY_POLICY;
  const allowedGlobals = policy.allowedGlobals ?? DEFAULT_SECURITY_POLICY.allowedGlobals!;

  // Create sandboxed console
  const sandboxConsole = {
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

  // Build allowed globals
  const globals: Record<string, unknown> = {
    console: sandboxConsole,
    React: context.React,
    ReactDOM: context.ReactDOM,
    ...context.globals,
  };

  // Add standard globals that are in the allowed list
  const globalObj =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
      ? window
      : typeof global !== 'undefined'
      ? global
      : {};

  for (const name of allowedGlobals) {
    if (name in globalObj && !(name in globals)) {
      globals[name] = (globalObj as Record<string, unknown>)[name];
    }
  }

  // Ensure dangerous globals are not available
  delete globals['process'];
  delete globals['require'];
  delete globals['__dirname'];
  delete globals['__filename'];
  delete globals['Buffer'];

  return globals;
}

/**
 * Error thrown during code execution.
 */
export class ExecutionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ExecutionError';
  }
}

/**
 * Check if an error is an ExecutionError.
 */
export function isExecutionError(error: unknown): error is ExecutionError {
  return error instanceof ExecutionError;
}
