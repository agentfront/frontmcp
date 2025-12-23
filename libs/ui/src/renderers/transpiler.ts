/**
 * JSX Execution Utilities
 *
 * Provides React-dependent code execution for transpiled JSX.
 * Uses React runtime for component evaluation.
 *
 * For transpilation without React, use transpileJsx from @frontmcp/uipack.
 *
 * @module @frontmcp/ui/renderers
 */

import { transpileJsx } from '@frontmcp/uipack/renderers';

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
 * Requires React to be installed.
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
