/**
 * Runtime JSX/TSX Transpiler
 *
 * Uses SWC to transpile JSX/TSX strings to executable JavaScript at runtime.
 * This enables dynamic React templates without requiring a build step.
 */

import { transpileCache } from '../cache';
import { hashString } from './hash';
import type { TranspileResult } from '../types';

/**
 * SWC transformation options for JSX.
 */
interface SwcTransformOptions {
  /** Enable TypeScript syntax */
  typescript?: boolean;
  /** Enable JSX syntax */
  jsx?: boolean;
  /** JSX runtime mode ('automatic' for React 17+, 'classic' for older) */
  jsxRuntime?: 'automatic' | 'classic';
  /** Enable development mode (better error messages) */
  development?: boolean;
}

/**
 * Default SWC options for React JSX transpilation.
 */
const DEFAULT_SWC_OPTIONS: SwcTransformOptions = {
  typescript: true,
  jsx: true,
  jsxRuntime: 'automatic',
  development: false,
};

/**
 * Lazy-loaded SWC transform function.
 * We load @swc/core dynamically to avoid requiring it at startup.
 */
let swcTransform: ((source: string, options: object) => Promise<{ code: string }>) | null = null;

/**
 * Load the SWC transform function.
 * Returns null if @swc/core is not available.
 */
async function loadSwcTransform(): Promise<typeof swcTransform> {
  if (swcTransform !== null) {
    return swcTransform;
  }

  try {
    // Dynamic import to avoid requiring @swc/core at startup
    const swc = await import('@swc/core');
    swcTransform = swc.transform;
    return swcTransform;
  } catch {
    console.warn(
      '[@frontmcp/ui] @swc/core not available. Runtime JSX transpilation disabled. ' +
        'Install @swc/core to enable: npm install @swc/core',
    );
    return null;
  }
}

/**
 * Transpile a JSX/TSX string to executable JavaScript.
 *
 * Uses SWC with React 17+ automatic JSX runtime.
 * Results are cached by content hash.
 *
 * @param source - JSX/TSX source code string
 * @param options - Transpilation options
 * @returns Transpiled result with code and caching metadata
 *
 * @example
 * ```typescript
 * const source = `
 *   function Widget({ output }) {
 *     return <div>{output.name}</div>;
 *   }
 * `;
 *
 * const result = await transpileJsx(source);
 * console.log(result.code); // JavaScript code
 * console.log(result.cached); // Whether from cache
 * ```
 */
export async function transpileJsx(source: string, options: SwcTransformOptions = {}): Promise<TranspileResult> {
  const hash = hashString(source);

  // Check cache first
  const cached = transpileCache.getByKey(hash);
  if (cached) {
    return { ...cached, cached: true };
  }

  // Load SWC
  const transform = await loadSwcTransform();
  if (!transform) {
    throw new Error(
      'Runtime JSX transpilation requires @swc/core. ' +
        'Either install @swc/core or use pre-compiled React components.',
    );
  }

  // Merge options
  const opts = { ...DEFAULT_SWC_OPTIONS, ...options };

  // Build SWC configuration
  const swcOptions = {
    jsc: {
      parser: {
        syntax: opts.typescript ? 'typescript' : 'ecmascript',
        tsx: opts.jsx,
        jsx: opts.jsx,
      },
      transform: {
        react: {
          runtime: opts.jsxRuntime,
          development: opts.development,
        },
      },
      target: 'es2020',
    },
    module: {
      type: 'commonjs',
    },
  };

  // Transpile
  const result = await transform(source, swcOptions);

  // Create result
  const transpileResult: TranspileResult = {
    code: result.code,
    hash,
    cached: false,
  };

  // Cache the result
  transpileCache.setByKey(hash, transpileResult);

  return transpileResult;
}

/**
 * Check if SWC is available for runtime transpilation.
 *
 * @returns Promise resolving to true if SWC is available
 */
export async function isSwcAvailable(): Promise<boolean> {
  const transform = await loadSwcTransform();
  return transform !== null;
}

/**
 * Execute transpiled JavaScript code and extract the component.
 *
 * Creates a sandboxed environment with React available,
 * executes the code, and returns the exported component.
 *
 * @param code - Transpiled JavaScript code
 * @param context - Additional context to inject
 * @returns The exported component or default export
 *
 * @example
 * ```typescript
 * const code = `
 *   "use strict";
 *   Object.defineProperty(exports, "__esModule", { value: true });
 *   const jsx_runtime = require("react/jsx-runtime");
 *   function Widget(props) {
 *     return jsx_runtime.jsx("div", { children: props.output.name });
 *   }
 *   exports.default = Widget;
 * `;
 *
 * const Component = await executeTranspiledCode(code);
 * // Component is now a usable React component function
 * ```
 */
export async function executeTranspiledCode(
  code: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: Record<string, any> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  // Load React dynamically
  let React;
  let jsxRuntime;

  try {
    React = await import('react');
    jsxRuntime = await import('react/jsx-runtime');
  } catch {
    throw new Error('React is required for JSX templates. Install react: npm install react react-dom');
  }

  // Create module-like exports object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exports: Record<string, any> = {};
  const module = { exports };

  // Create require function for the sandboxed code
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const require = (id: string): any => {
    switch (id) {
      case 'react':
        return React;
      case 'react/jsx-runtime':
        return jsxRuntime;
      case 'react/jsx-dev-runtime':
        return jsxRuntime;
      default:
        // Check if it's in the context
        if (context[id]) {
          return context[id];
        }
        throw new Error(`Module '${id}' not available in JSX template context`);
    }
  };

  // Execute the code in a function scope
  try {
    const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', 'React', 'context', code);

    fn(exports, require, module, 'template.js', '/', React, context);

    // Return the default export or first export
    return module.exports['default'] || module.exports[Object.keys(module.exports)[0]] || module.exports;
  } catch (error) {
    throw new Error(`Failed to execute transpiled JSX: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Transpile and execute a JSX string, returning the component.
 *
 * Convenience function that combines transpileJsx and executeTranspiledCode.
 *
 * @param source - JSX/TSX source code
 * @param context - Additional context for execution
 * @returns The component function
 */
export async function transpileAndExecute(
  source: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: Record<string, any> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const result = await transpileJsx(source);
  return executeTranspiledCode(result.code, context);
}
