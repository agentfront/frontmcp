/**
 * esbuild Configuration for Builders
 *
 * Shared esbuild configuration for component transpilation.
 * Supports externalization for hybrid mode and inline bundling.
 *
 * CDN constants and script generators are defined in ./cdn-config.ts
 * and re-exported here for backwards compatibility.
 *
 * @packageDocumentation
 */

import type { TransformOptions } from 'esbuild';
import type { TranspileOptions } from './types';
import { DEFAULT_EXTERNALS, createExternalsBanner } from './cdn-config';

// ============================================
// Re-exports from cdn-config (backwards compatibility)
// ============================================

export {
  DEFAULT_EXTERNALS,
  EXTERNAL_GLOBALS,
  CDN_URLS,
  CLOUDFLARE_CDN_URLS,
  BABEL_STANDALONE_CDN,
  FRONTMCP_UI_CDN,
  createExternalsBanner,
  generateCdnScriptTags,
  generateGlobalsSetupScript,
} from './cdn-config';

// ============================================
// Transform Configuration
// ============================================

/**
 * Create esbuild transform options for component transpilation.
 *
 * @param options - Transpile options
 * @returns esbuild transform options
 */
export function createTransformConfig(options: TranspileOptions = {}): TransformOptions {
  const {
    format = 'esm',
    target = 'es2020',
    minify = false,
    jsxImportSource = 'react',
  } = options;

  return {
    loader: 'tsx',
    format,
    target,
    minify,
    treeShaking: true,
    jsx: 'automatic',
    jsxImportSource,
    sourcemap: options.minify ? false : 'inline',
  };
}

/**
 * Create esbuild transform options for externalized component chunks.
 *
 * This configuration produces code that:
 * 1. Imports React/deps from external globals
 * 2. Uses ESM format for dynamic import
 * 3. Has all FrontMCP UI components externalized
 *
 * @param options - Transpile options
 * @returns esbuild transform options with externalization
 */
export function createExternalizedConfig(options: TranspileOptions = {}): TransformOptions {
  const baseConfig = createTransformConfig({
    ...options,
    format: 'esm',
  });

  return {
    ...baseConfig,
    // Add banner to define external namespace objects
    banner: createExternalsBanner(options.externals || DEFAULT_EXTERNALS),
  };
}

/**
 * Create inline bundle configuration.
 *
 * This configuration bundles everything together for inline mode,
 * including React and all dependencies.
 *
 * @param options - Transpile options
 * @returns esbuild transform options for inline bundling
 */
export function createInlineConfig(options: TranspileOptions = {}): TransformOptions {
  return createTransformConfig({
    ...options,
    format: 'iife',
    minify: options.minify ?? true,
  });
}
