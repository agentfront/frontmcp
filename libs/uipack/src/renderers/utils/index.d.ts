/**
 * Renderer Utilities
 *
 * Utility functions for template detection, hashing, and transpilation.
 */
export {
  isReactComponent,
  isTemplateBuilderFunction,
  containsJsx,
  containsMdxSyntax,
  isPlainHtml,
  detectTemplateType,
} from './detect';
export { hashString, hashCombined, isHash } from './hash';
export { transpileJsx, isSwcAvailable, executeTranspiledCode, transpileAndExecute } from './transpiler';
//# sourceMappingURL=index.d.ts.map
