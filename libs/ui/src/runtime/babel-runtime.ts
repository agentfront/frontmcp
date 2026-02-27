/**
 * Babel Standalone Runtime
 *
 * Loads Babel Standalone from CDN for in-browser JSX transpilation.
 * Lazy-loaded on first JSX content to avoid unnecessary network requests.
 *
 * @packageDocumentation
 */

// ============================================
// CDN Configuration
// ============================================

/**
 * CDN URL for Babel Standalone.
 * Uses esm.sh for ES module compatibility.
 */
export const BABEL_STANDALONE_CDN = 'https://esm.sh/@babel/standalone@7';

/**
 * Fallback CDN for environments that block esm.sh.
 */
export const BABEL_STANDALONE_FALLBACK_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.10/babel.min.js';

// ============================================
// Types
// ============================================

/**
 * Babel Standalone API shape (subset we use).
 */
interface BabelStandalone {
  transform(
    code: string,
    options: {
      presets?: string[];
      plugins?: string[];
      filename?: string;
    },
  ): { code: string };
}

/**
 * Loading state for Babel Standalone.
 */
type BabelLoadState =
  | { status: 'idle' }
  | { status: 'loading'; promise: Promise<BabelStandalone> }
  | { status: 'loaded'; babel: BabelStandalone }
  | { status: 'error'; error: Error };

// ============================================
// Module State
// ============================================

let babelState: BabelLoadState = { status: 'idle' };

// ============================================
// Loading Functions
// ============================================

/**
 * Load Babel Standalone from CDN.
 *
 * Lazy-loads on first call and caches the result.
 * Subsequent calls return the cached instance.
 *
 * @returns Promise resolving to Babel Standalone instance
 * @throws Error if Babel cannot be loaded from any CDN
 */
export async function loadBabel(): Promise<BabelStandalone> {
  if (babelState.status === 'loaded') {
    return babelState.babel;
  }

  if (babelState.status === 'loading') {
    return babelState.promise;
  }

  if (babelState.status === 'error') {
    throw babelState.error;
  }

  const promise = doLoadBabel();
  babelState = { status: 'loading', promise };

  try {
    const babel = await promise;
    babelState = { status: 'loaded', babel };
    return babel;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    babelState = { status: 'error', error: err };
    throw err;
  }
}

/**
 * Actual loading logic with fallback.
 */
async function doLoadBabel(): Promise<BabelStandalone> {
  // Check if Babel is already loaded globally (e.g., via script tag)
  const globalBabel = (globalThis as Record<string, unknown>)['Babel'] as BabelStandalone | undefined;
  if (globalBabel && typeof globalBabel.transform === 'function') {
    return globalBabel;
  }

  // Try ESM import first
  try {
    const module = await import(/* webpackIgnore: true */ BABEL_STANDALONE_CDN);
    if (module && typeof module.transform === 'function') {
      return module as BabelStandalone;
    }
    if (module.default && typeof module.default.transform === 'function') {
      return module.default as BabelStandalone;
    }
  } catch {
    // ESM import failed, try script tag fallback
  }

  // Fallback: load via script tag (for UMD builds)
  return new Promise<BabelStandalone>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Babel Standalone requires a browser environment'));
      return;
    }

    const script = document.createElement('script');
    script.src = BABEL_STANDALONE_FALLBACK_CDN;
    script.crossOrigin = 'anonymous';

    script.onload = () => {
      const babel = (globalThis as Record<string, unknown>)['Babel'] as BabelStandalone | undefined;
      if (babel && typeof babel.transform === 'function') {
        resolve(babel);
      } else {
        reject(new Error('Babel Standalone loaded but transform function not found'));
      }
    };

    script.onerror = () => {
      reject(new Error(`Failed to load Babel Standalone from ${BABEL_STANDALONE_FALLBACK_CDN}`));
    };

    document.head.appendChild(script);
  });
}

// ============================================
// Transpilation Functions
// ============================================

/**
 * Transpile JSX source code using Babel Standalone.
 *
 * Loads Babel lazily on first call.
 *
 * @param source - JSX/TSX source code
 * @param filename - Optional filename for error messages
 * @returns Transpiled JavaScript code
 *
 * @example
 * ```typescript
 * const code = await transpileJsx(`
 *   function App() {
 *     return <div>Hello</div>;
 *   }
 * `);
 * ```
 */
export async function transpileJsx(source: string, filename = 'component.jsx'): Promise<string> {
  const babel = await loadBabel();

  const result = babel.transform(source, {
    presets: ['react'],
    filename,
  });

  return result.code;
}

/**
 * Check if Babel is currently loaded and ready.
 *
 * @returns true if Babel is loaded and available
 */
export function isBabelLoaded(): boolean {
  return babelState.status === 'loaded';
}

/**
 * Reset Babel loading state (for testing).
 */
export function resetBabelState(): void {
  babelState = { status: 'idle' };
}
