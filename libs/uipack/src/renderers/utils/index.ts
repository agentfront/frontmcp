/**
 * Renderer Utilities
 *
 * Utility functions for template detection, hashing, and transpilation.
 */

// Detection utilities
export {
  isReactComponent,
  isTemplateBuilderFunction,
  containsJsx,
  containsMdxSyntax,
  isPlainHtml,
  detectTemplateType,
} from './detect';

// Hash utilities
export { hashString, hashCombined, isHash } from './hash';

// Transpilation utilities
export { transpileJsx, isSwcAvailable } from './transpiler';
