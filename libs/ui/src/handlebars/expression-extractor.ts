/**
 * Handlebars Expression Extractor
 *
 * Extracts variable paths from Handlebars templates for validation
 * against schemas.
 *
 * @packageDocumentation
 */

// ============================================
// Types
// ============================================

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

// ============================================
// Constants
// ============================================

/**
 * Regex to match Handlebars expressions.
 * Captures:
 * - {{expression}} - simple expressions
 * - {{#helper expression}} - block helpers
 * - {{/helper}} - block close
 * - {{{unescaped}}} - triple braces (unescaped)
 *
 * Excludes:
 * - {{! comment }} - single line comments
 * - {{!-- comment --}} - multi-line comments
 */
const EXPRESSION_REGEX = /\{\{\{?(?!!)(#|\/)?([^}]+?)\}?\}\}/g;

/**
 * Regex to extract variable paths from expression content.
 * Matches: output.foo, input.bar.baz, structuredContent.items
 */
const PATH_REGEX = /\b(output|input|structuredContent)(\.[a-zA-Z_$][a-zA-Z0-9_$]*|\.\[[^\]]+\])+/g;

/**
 * Built-in Handlebars helpers that should be recognized.
 */
const BUILT_IN_HELPERS = new Set(['if', 'unless', 'each', 'with', 'lookup', 'log', 'else']);

/**
 * Built-in keywords that are not variable paths.
 */
const KEYWORDS = new Set(['this', 'else', '@index', '@key', '@first', '@last', '@root']);

// ============================================
// Core Functions
// ============================================

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
export function extractExpressions(template: string): ExtractedExpression[] {
  const expressions: ExtractedExpression[] = [];
  const lines = template.split('\n');

  // Build a map of character positions to line/column
  const positionMap = buildPositionMap(template);

  let match: RegExpExecArray | null;
  EXPRESSION_REGEX.lastIndex = 0; // Reset regex state

  while ((match = EXPRESSION_REGEX.exec(template)) !== null) {
    const fullExpression = match[0];
    const prefix = match[1]; // '#' for block start, '/' for block close
    const content = match[2].trim();
    const position = positionMap.get(match.index) ?? { line: 1, column: 1 };

    // Determine expression type
    let type: ExpressionType = 'variable';
    let helperName: string | undefined;

    if (prefix === '/') {
      type = 'block-close';
      helperName = content;
    } else if (prefix === '#') {
      type = 'block';
      // Extract helper name (first word)
      const parts = content.split(/\s+/);
      helperName = parts[0];
    } else {
      // Check if it's a helper call (first token is a helper name)
      const parts = content.split(/\s+/);
      if (parts.length > 1 && !content.startsWith('(')) {
        // Could be a helper with arguments
        const firstToken = parts[0];
        if (!firstToken.includes('.') && !KEYWORDS.has(firstToken)) {
          type = 'helper';
          helperName = firstToken;
        }
      }
    }

    // Extract variable paths from the expression content
    const paths = extractPathsFromContent(content);

    for (const path of paths) {
      expressions.push({
        path,
        fullExpression,
        line: position.line,
        column: position.column,
        type,
        helperName,
      });
    }

    // If no paths found but it's a variable expression, check for root-level access
    if (paths.length === 0 && type === 'variable') {
      const cleanContent = content.trim();
      // Skip keywords and helpers
      if (!KEYWORDS.has(cleanContent) && !cleanContent.includes(' ') && !cleanContent.startsWith('(')) {
        // This might be a root-level property access (spread from output)
        // We don't validate these as they could be legitimate
      }
    }
  }

  return expressions;
}

/**
 * Extract variable paths from expression content.
 *
 * @param content - Expression content (without braces)
 * @returns Array of variable paths
 */
function extractPathsFromContent(content: string): string[] {
  const paths: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  const regex = new RegExp(PATH_REGEX.source, 'g');

  while ((match = regex.exec(content)) !== null) {
    paths.push(match[0]);
  }

  return paths;
}

/**
 * Build a map from character position to line/column.
 */
function buildPositionMap(template: string): Map<number, { line: number; column: number }> {
  const map = new Map<number, { line: number; column: number }>();
  let line = 1;
  let column = 1;

  for (let i = 0; i < template.length; i++) {
    map.set(i, { line, column });

    if (template[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }

  return map;
}

// ============================================
// Convenience Functions
// ============================================

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
export function extractVariablePaths(template: string): string[] {
  const expressions = extractExpressions(template);
  const paths = new Set(expressions.map((e) => e.path));
  return Array.from(paths);
}

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
export function extractOutputPaths(template: string): string[] {
  return extractVariablePaths(template).filter((p) => p.startsWith('output.'));
}

/**
 * Extract only input.* paths from a template.
 *
 * @param template - Handlebars template string
 * @returns Array of unique input paths
 */
export function extractInputPaths(template: string): string[] {
  return extractVariablePaths(template).filter((p) => p.startsWith('input.'));
}

/**
 * Extract only structuredContent.* paths from a template.
 *
 * @param template - Handlebars template string
 * @returns Array of unique structuredContent paths
 */
export function extractStructuredContentPaths(template: string): string[] {
  return extractVariablePaths(template).filter((p) => p.startsWith('structuredContent.'));
}

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
export function extractAll(template: string): ExtractionResult {
  const expressions = extractExpressions(template);
  const paths = [...new Set(expressions.map((e) => e.path))];

  return {
    expressions,
    paths,
    outputPaths: paths.filter((p) => p.startsWith('output.')),
    inputPaths: paths.filter((p) => p.startsWith('input.')),
    structuredContentPaths: paths.filter((p) => p.startsWith('structuredContent.')),
  };
}

/**
 * Check if a template contains any Handlebars expressions with variable paths.
 *
 * @param template - Handlebars template string
 * @returns true if template contains variable paths
 */
export function hasVariablePaths(template: string): boolean {
  return extractVariablePaths(template).length > 0;
}

/**
 * Get expression details at a specific line and column.
 *
 * @param template - Handlebars template string
 * @param line - Line number (1-indexed)
 * @param column - Column number (1-indexed)
 * @returns Expression at position or undefined
 */
export function getExpressionAt(template: string, line: number, column: number): ExtractedExpression | undefined {
  const expressions = extractExpressions(template);

  return expressions.find((expr) => {
    if (expr.line !== line) return false;

    const exprEnd = expr.column + expr.fullExpression.length;
    return column >= expr.column && column <= exprEnd;
  });
}

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
export function normalizePath(path: string): string {
  // Convert numeric indices to [] wildcard
  // output.items.0.name -> output.items.[].name
  // output.items[0].name -> output.items.[].name
  return path
    .replace(/\.\d+\./g, '.[].')
    .replace(/\.\d+$/g, '.[]')
    .replace(/\[\d+\]/g, '.[]');
}
