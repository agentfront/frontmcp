/**
 * Handlebars Expression Extractor
 *
 * Extracts variable paths from Handlebars templates for validation
 * against schemas.
 *
 * @packageDocumentation
 */
/**
 * Type of Handlebars expression.
 */
export type ExpressionType = 'variable' | 'helper' | 'block' | 'block-close';
/**
 * Extracted expression with metadata.
 */
export interface ExtractedExpression {
  /** The variable path (e.g., "output.temperature") */
  path: string;
  /** The full expression (e.g., "{{output.temperature}}") */
  fullExpression: string;
  /** Line number in template (1-indexed) */
  line: number;
  /** Column position (1-indexed) */
  column: number;
  /** Type of expression */
  type: ExpressionType;
  /** For helpers, the helper name */
  helperName?: string;
}
/**
 * Result of expression extraction.
 */
export interface ExtractionResult {
  /** All extracted expressions */
  expressions: ExtractedExpression[];
  /** Unique variable paths */
  paths: string[];
  /** Paths starting with "output." */
  outputPaths: string[];
  /** Paths starting with "input." */
  inputPaths: string[];
  /** Paths starting with "structuredContent." */
  structuredContentPaths: string[];
}
/**
 * Extract all Handlebars expressions from a template.
 *
 * @param template - Handlebars template string
 * @returns Array of extracted expressions with metadata
 *
 * @example
 * ```typescript
 * const expressions = extractExpressions('<div>{{output.name}}</div>');
 * // [{ path: 'output.name', fullExpression: '{{output.name}}', ... }]
 * ```
 */
export declare function extractExpressions(template: string): ExtractedExpression[];
/**
 * Extract all variable paths from a template.
 *
 * @param template - Handlebars template string
 * @returns Array of unique variable paths
 *
 * @example
 * ```typescript
 * const paths = extractVariablePaths('<div>{{output.a}} {{input.b}}</div>');
 * // ['output.a', 'input.b']
 * ```
 */
export declare function extractVariablePaths(template: string): string[];
/**
 * Extract only output.* paths from a template.
 *
 * @param template - Handlebars template string
 * @returns Array of unique output paths
 *
 * @example
 * ```typescript
 * const paths = extractOutputPaths('<div>{{output.temp}} {{input.city}}</div>');
 * // ['output.temp']
 * ```
 */
export declare function extractOutputPaths(template: string): string[];
/**
 * Extract only input.* paths from a template.
 *
 * @param template - Handlebars template string
 * @returns Array of unique input paths
 */
export declare function extractInputPaths(template: string): string[];
/**
 * Extract only structuredContent.* paths from a template.
 *
 * @param template - Handlebars template string
 * @returns Array of unique structuredContent paths
 */
export declare function extractStructuredContentPaths(template: string): string[];
/**
 * Comprehensive extraction returning all path categories.
 *
 * @param template - Handlebars template string
 * @returns Extraction result with categorized paths
 *
 * @example
 * ```typescript
 * const result = extractAll('<div>{{output.a}} {{input.b}}</div>');
 * // {
 * //   expressions: [...],
 * //   paths: ['output.a', 'input.b'],
 * //   outputPaths: ['output.a'],
 * //   inputPaths: ['input.b'],
 * //   structuredContentPaths: []
 * // }
 * ```
 */
export declare function extractAll(template: string): ExtractionResult;
/**
 * Check if a template contains any Handlebars expressions with variable paths.
 *
 * @param template - Handlebars template string
 * @returns true if template contains variable paths
 */
export declare function hasVariablePaths(template: string): boolean;
/**
 * Get expression details at a specific line and column.
 *
 * @param template - Handlebars template string
 * @param line - Line number (1-indexed)
 * @param column - Column number (1-indexed)
 * @returns Expression at position or undefined
 */
export declare function getExpressionAt(
  template: string,
  line: number,
  column: number,
): ExtractedExpression | undefined;
/**
 * Normalize a path for comparison.
 * Converts array index access to wildcard format.
 *
 * @param path - Variable path
 * @returns Normalized path
 *
 * @example
 * ```typescript
 * normalizePath('output.items.0.name'); // 'output.items.[].name'
 * normalizePath('output.data[0].value'); // 'output.data.[].value'
 * ```
 */
export declare function normalizePath(path: string): string;
//# sourceMappingURL=expression-extractor.d.ts.map
