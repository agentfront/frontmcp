/**
 * Concatenation Transform
 *
 * Transforms string concatenation operations (a + b) to safe function calls
 * (__safe_concat__(a, b)). This enables reference-aware concatenation that
 * can detect and properly handle reference IDs.
 *
 * @packageDocumentation
 */

import * as walk from 'acorn-walk';
import type * as acorn from 'acorn';

/**
 * Configuration for concatenation transformation
 */
export interface ConcatTransformConfig {
  /**
   * Prefix for safe functions
   * Default: '__safe_'
   */
  prefix?: string;

  /**
   * Function name to use for concatenation
   * Default: 'concat'
   * Full name will be: prefix + functionName (e.g., '__safe_concat')
   */
  functionName?: string;
}

/**
 * Result of concatenation transformation
 */
export interface ConcatTransformResult {
  /**
   * Number of binary expressions transformed
   */
  transformedCount: number;
}

/**
 * Transform string concatenation to safe function calls
 *
 * This function mutates the AST in place, replacing `+` binary expressions
 * with calls to `__safe_concat__()`. This allows the runtime to detect
 * and handle reference IDs in concatenation operations.
 *
 * Note: This transforms ALL `+` operations, not just string concatenations.
 * The safe_concat function at runtime handles both string and numeric addition.
 *
 * @param ast - The AST to process (mutated in place)
 * @param config - Transformation configuration
 * @returns Information about transformed expressions
 *
 * @example
 * ```typescript
 * // Input: a + b + c
 * // Output: __safe_concat__(__safe_concat__(a, b), c)
 *
 * const result = transformConcatenation(ast, { prefix: '__safe_' });
 * console.log(`Transformed ${result.transformedCount} concatenations`);
 * ```
 */
export function transformConcatenation(ast: acorn.Node, config: ConcatTransformConfig = {}): ConcatTransformResult {
  const prefix = config.prefix ?? '__safe_';
  const functionName = config.functionName ?? 'concat';
  const safeConcatName = `${prefix}${functionName}`;

  let transformedCount = 0;

  // Use simple walker. Because we mutate the node type to 'CallExpression'
  // and move children to 'arguments', the walker will naturally
  // continue traversing the children in their new location.
  walk.simple(ast as any, {
    BinaryExpression: (node: any) => {
      // Only transform addition operator
      if (node.operator !== '+') {
        return;
      }

      // 1. Capture References
      // CRITICAL: Do not use { ...node.left }. We must use the reference
      // so that if the child is also transformed, this parent sees the result.
      const left = node.left;
      const right = node.right;

      // 2. Transform to CallExpression
      // We mutate the type first so any subsequent traversal tools see the new structure
      node.type = 'CallExpression';

      node.callee = {
        type: 'Identifier',
        name: safeConcatName,
        // We do not set loc/start/end on the identifier implies it's synthetic,
        // which is usually fine.
      };

      node.arguments = [left, right];
      node.optional = false;

      // 3. Clean up BinaryExpression specific properties
      // CRITICAL: Do NOT delete all keys (Object.keys...).
      // We must preserve 'loc', 'start', 'end', 'range' for Source Maps.
      delete node.left;
      delete node.right;
      delete node.operator;

      transformedCount++;
    },
  });

  return {
    transformedCount,
  };
}

/**
 * Transform template literals with expressions to safe template calls
 *
 * Transforms template literals like `Hello ${name}!` to
 * __safe_template__(['Hello ', '!'], name)
 *
 * This is optional and only needed if you want to intercept template
 * literal interpolation for reference detection.
 *
 * @param ast - The AST to process (mutated in place)
 * @param config - Transformation configuration
 * @returns Information about transformed templates
 */
export function transformTemplateLiterals(ast: acorn.Node, config: ConcatTransformConfig = {}): ConcatTransformResult {
  const prefix = config.prefix ?? '__safe_';
  const safeFn = `${prefix}template`;

  let transformedCount = 0;

  walk.simple(ast as any, {
    TemplateLiteral: (node: any) => {
      // Only transform templates with expressions
      if (node.expressions.length === 0) {
        return;
      }

      // Build the quasis array (static parts)
      const quasisArray: any = {
        type: 'ArrayExpression',
        elements: node.quasis.map((quasi: any) => ({
          type: 'Literal',
          value: quasi.value.cooked ?? quasi.value.raw,
          raw: JSON.stringify(quasi.value.cooked ?? quasi.value.raw),
        })),
      };

      // 1. Capture References
      // CRITICAL: Do not spread/copy. Use the reference array.
      // However, since we are moving them into a new array structure
      // for the arguments, we can reference the items directly.
      const expressionRefs = node.expressions;

      // 2. Transform to CallExpression
      node.type = 'CallExpression';

      node.callee = {
        type: 'Identifier',
        name: safeFn,
      };

      // The first argument is the array of strings, followed by the expressions
      node.arguments = [quasisArray, ...expressionRefs];
      node.optional = false;

      // 3. Clean up TemplateLiteral specific properties
      // CRITICAL: Preserve location data
      delete node.quasis;
      delete node.expressions;

      transformedCount++;
    },
  });

  return {
    transformedCount,
  };
}
