/**
 * Lazy module import helper.
 *
 * Creates a lazy-loading wrapper for peer dependencies that are externalized
 * and loaded via esm.sh. Follows the state machine pattern from babel-runtime.ts.
 *
 * @packageDocumentation
 */

// ============================================
// esm.sh CDN
// ============================================

/** Base URL for esm.sh CDN. */
export const ESM_SH_BASE = 'https://esm.sh/';

/**
 * Build an esm.sh CDN URL for a package.
 *
 * @param pkg - Package specifier with version (e.g., 'recharts@2', 'mermaid@11')
 * @param options - Optional configuration
 * @param options.external - Packages to externalize (e.g., ['react', 'react-dom'])
 *
 * @example
 * ```typescript
 * esmShUrl('mermaid@11');
 * // => 'https://esm.sh/mermaid@11'
 *
 * esmShUrl('recharts@2', { external: ['react', 'react-dom'] });
 * // => 'https://esm.sh/recharts@2?external=react,react-dom'
 * ```
 */
export function esmShUrl(pkg: string, options?: { external?: string[] }): string {
  let url = `${ESM_SH_BASE}${pkg}`;
  if (options?.external?.length) {
    url += `?external=${options.external.join(',')}`;
  }
  return url;
}

// ============================================
// Types
// ============================================

/** Loading state for a lazy-imported module. */
export type LazyImportState<T> =
  | { status: 'idle' }
  | { status: 'loading'; promise: Promise<T> }
  | { status: 'loaded'; module: T }
  | { status: 'error'; error: Error };

export interface LazyImport<T> {
  /** Load the module (cached after first call). */
  load(): Promise<T>;
  /** Get the module if already loaded, or undefined. */
  get(): T | undefined;
  /** Check current loading status. */
  getState(): LazyImportState<T>;
  /** Reset state (for testing). */
  reset(): void;
}

// ============================================
// Runtime Imports
// ============================================

/**
 * Runtime dynamic import that avoids TS2307 for uninstalled optional peer deps.
 * Uses Function constructor so TypeScript doesn't try to resolve the module.
 */
export function runtimeImport(specifier: string): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<Record<string, unknown>>;
  return dynamicImport(specifier);
}

/**
 * Try importing a bare specifier first (works in bundled environments),
 * then fall back to an esm.sh URL (works in raw browser environments).
 *
 * This is the primary import strategy for optional peer dependencies.
 * In Vite dev mode, bare specifiers resolve via `optimizeDeps.include`.
 * In production or unbundled environments, the esm.sh CDN URL is used.
 *
 * @param bareSpecifier - The npm package name (e.g., 'recharts', 'mermaid')
 * @param fallbackUrl - The esm.sh URL to use if bare import fails
 *
 * @example
 * ```typescript
 * const mod = await runtimeImportWithFallback(
 *   'recharts',
 *   esmShUrl('recharts@2', { external: ['react', 'react-dom'] }),
 * );
 * ```
 */
export async function runtimeImportWithFallback(
  bareSpecifier: string,
  fallbackUrl: string,
): Promise<Record<string, unknown>> {
  try {
    return await runtimeImport(bareSpecifier);
  } catch {
    return runtimeImport(fallbackUrl);
  }
}

// ============================================
// Lazy Import Factory
// ============================================

/**
 * Create a lazy-loading wrapper for an external module.
 *
 * @param moduleId - The module specifier (e.g., 'recharts', 'mermaid')
 * @param importer - Optional custom import function. Defaults to dynamic import().
 */
export function createLazyImport<T>(moduleId: string, importer?: () => Promise<T>): LazyImport<T> {
  let state: LazyImportState<T> = { status: 'idle' };

  const doImport =
    importer ??
    (async () => {
      const mod = await runtimeImport(moduleId);
      return (mod['default'] ?? mod) as T;
    });

  return {
    load(): Promise<T> {
      if (state.status === 'loaded') return Promise.resolve(state.module);
      if (state.status === 'loading') return state.promise;
      if (state.status === 'error') {
        // Allow retry — transient failures (network issues, CDN timeouts)
        // should not permanently block the module from loading.
        state = { status: 'idle' };
      }

      const promise = doImport().then(
        (mod) => {
          state = { status: 'loaded', module: mod };
          return mod;
        },
        (err) => {
          const error = err instanceof Error ? err : new Error(`Failed to load module "${moduleId}": ${String(err)}`);
          state = { status: 'error', error };
          throw error;
        },
      );

      state = { status: 'loading', promise };
      return promise;
    },

    get(): T | undefined {
      return state.status === 'loaded' ? state.module : undefined;
    },

    getState(): LazyImportState<T> {
      return state;
    },

    reset(): void {
      state = { status: 'idle' };
    },
  };
}
