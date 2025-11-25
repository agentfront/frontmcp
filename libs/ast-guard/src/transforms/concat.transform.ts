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

  // Use ancestor walker to properly handle nested expressions
  walk.simple(ast as any, {
    BinaryExpression: (node: any) => {
      // Only transform addition operator
      if (node.operator !== '+') {
        return;
      }

      // Save the operands
      const left = { ...node.left };
      const right = { ...node.right };

      // Clear existing properties
      Object.keys(node).forEach((k) => delete node[k]);

      // Transform to CallExpression
      node.type = 'CallExpression';
      node.callee = {
        type: 'Identifier',
        name: safeConcatName,
      };
      node.arguments = [left, right];
      node.optional = false;

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

      // Save expressions
      const expressions = [...node.expressions];

      // Clear existing properties
      Object.keys(node).forEach((k) => delete node[k]);

      // Transform to CallExpression
      node.type = 'CallExpression';
      node.callee = {
        type: 'Identifier',
        name: safeFn,
      };
      node.arguments = [quasisArray, ...expressions];
      node.optional = false;

      transformedCount++;
    },
  });

  return {
    transformedCount,
  };
}
