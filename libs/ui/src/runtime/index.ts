/**
 * @frontmcp/ui Runtime Module
 *
 * Client-side utilities for content detection and JSX transpilation.
 *
 * @packageDocumentation
 */

// ============================================
// Content Detection
// ============================================

export { detectContentType, type RuntimeContentType } from './content-detector';

// ============================================
// Babel Runtime (JSX transpilation)
// ============================================

export {
  transpileJsx,
  loadBabel,
  isBabelLoaded,
  resetBabelState,
  BABEL_STANDALONE_CDN,
  BABEL_STANDALONE_FALLBACK_CDN,
} from './babel-runtime';
