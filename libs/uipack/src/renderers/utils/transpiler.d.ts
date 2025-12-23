/**
 * Runtime JSX/TSX Transpiler
 *
 * Uses SWC to transpile JSX/TSX strings to executable JavaScript at runtime.
 * This enables dynamic React templates without requiring a build step.
 */
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
export declare function transpileJsx(source: string, options?: SwcTransformOptions): Promise<TranspileResult>;
/**
 * Check if SWC is available for runtime transpilation.
 *
 * @returns Promise resolving to true if SWC is available
 */
export declare function isSwcAvailable(): Promise<boolean>;
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
export declare function executeTranspiledCode(code: string, context?: Record<string, any>): Promise<any>;
/**
 * Transpile and execute a JSX string, returning the component.
 *
 * Convenience function that combines transpileJsx and executeTranspiledCode.
 *
 * @param source - JSX/TSX source code
 * @param context - Additional context for execution
 * @returns The component function
 */
export declare function transpileAndExecute(source: string, context?: Record<string, any>): Promise<any>;
export {};
//# sourceMappingURL=transpiler.d.ts.map
