/**
 * AST Transforms Module
 *
 * Provides AST transformation utilities for the pass-by-reference system.
 *
 * @packageDocumentation
 */

// String extraction
export {
  extractLargeStrings,
  shouldExtract,
  StringExtractionConfig,
  StringExtractionResult,
} from './string-extraction.transform';

// Concatenation transformation
export {
  transformConcatenation,
  transformTemplateLiterals,
  ConcatTransformConfig,
  ConcatTransformResult,
} from './concat.transform';
