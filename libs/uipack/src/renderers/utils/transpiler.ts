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
    // Dynamic import with webpackIgnore to prevent webpack from bundling @swc/core.
    // Note: This directive is webpack-specific. Other bundlers (esbuild, Rollup)
    // require external dependency configuration in their config files.
    const swc = await import(/* webpackIgnore: true */ '@swc/core');
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
 * NOTE: This function has been moved to @frontmcp/ui/renderers.
 * Use executeTranspiledCode from @frontmcp/ui instead.
 *
 * @deprecated Use executeTranspiledCode from @frontmcp/ui/renderers
 */
export async function executeTranspiledCode(_code: string, _context: Record<string, unknown> = {}): Promise<never> {
  throw new Error(
    'executeTranspiledCode has been moved to @frontmcp/ui/renderers. ' +
      'Install @frontmcp/ui and import from there: import { executeTranspiledCode } from "@frontmcp/ui/renderers"',
  );
}

/**
 * Transpile and execute a JSX string, returning the component.
 *
 * NOTE: This function has been moved to @frontmcp/ui/renderers.
 * Use transpileAndExecute from @frontmcp/ui instead.
 *
 * @deprecated Use transpileAndExecute from @frontmcp/ui/renderers
 */
export async function transpileAndExecute(_source: string, _context: Record<string, unknown> = {}): Promise<never> {
  throw new Error(
    'transpileAndExecute has been moved to @frontmcp/ui/renderers. ' +
      'Install @frontmcp/ui and import from there: import { transpileAndExecute } from "@frontmcp/ui/renderers"',
  );
}
