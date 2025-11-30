/**
 * String Extraction Transform
 *
 * Extracts large string literals from AST and replaces them with reference IDs.
 * This prevents large data from entering the JavaScript sandbox.
 *
 * @packageDocumentation
 */

import * as walk from 'acorn-walk';
import type * as acorn from 'acorn';

/**
 * Configuration for string extraction
 */
export interface StringExtractionConfig {
  /**
   * Size threshold in bytes to trigger extraction
   * Strings larger than this are lifted to the sidecar
   */
  threshold: number;

  /**
   * Callback function to store extracted string
   * Should return the reference ID to replace the string with
   */
  onExtract: (value: string) => string;
}

/**
 * Result of string extraction
 */
export interface StringExtractionResult {
  /**
   * Number of strings that were extracted
   */
  extractedCount: number;

  /**
   * Total bytes extracted
   */
  extractedBytes: number;

  /**
   * Reference IDs that were created
   */
  referenceIds: string[];
}

/**
 * Extract large string literals from an AST
 *
 * This function mutates the AST in place, replacing large string literals
 * with reference ID strings. The original strings are passed to the
 * `onExtract` callback for storage.
 *
 * @param ast - The AST to process (mutated in place)
 * @param config - Extraction configuration
 * @returns Information about extracted strings
 *
 * @example
 * ```typescript
 * const sidecar = new ReferenceSidecar(config);
 *
 * const result = extractLargeStrings(ast, {
 * threshold: 64 * 1024, // 64KB
 * onExtract: (value) => sidecar.store(value, 'extraction'),
 * });
 *
 * console.log(`Extracted ${result.extractedCount} strings (${result.extractedBytes} bytes)`);
 * ```
 */
export function extractLargeStrings(ast: acorn.Node, config: StringExtractionConfig): StringExtractionResult {
  let extractedCount = 0;
  let extractedBytes = 0;
  const referenceIds: string[] = [];

  // Helper to check if a node is an Object Property or Method key
  const isObjectKey = (node: any, parent: any) => {
    if (!parent) return false;

    // Check standard Object Property: { "key": val }
    if (parent.type === 'Property' && parent.key === node && !parent.computed) {
      return true;
    }

    // Check Class Method/Property: class X { "key"() {} }
    if (
      (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') &&
      parent.key === node &&
      !parent.computed
    ) {
      return true;
    }

    return false;
  };

  // Helper to check if a node is an Import/Export source
  const isModuleSource = (node: any, parent: any) => {
    if (!parent) return false;

    return (
      (parent.type === 'ImportDeclaration' ||
        parent.type === 'ExportNamedDeclaration' ||
        parent.type === 'ExportAllDeclaration') &&
      parent.source === node
    );
  };

  // Use ancestor walker to check parent context
  walk.ancestor(ast as any, {
    Literal: (node: any, ancestors: any[]) => {
      // Only process string literals
      if (typeof node.value !== 'string') {
        return;
      }

      // Get Parent to check context
      // ancestors[last] is the node itself, ancestors[last-1] is the parent
      const parent = ancestors.length > 1 ? ancestors[ancestors.length - 2] : null;

      // SAFETY CHECKS:
      // 1. Do not extract Object Keys ({ "key": val })
      if (isObjectKey(node, parent)) return;

      // 2. Do not extract Import/Export paths (import x from "path")
      if (isModuleSource(node, parent)) return;

      // 3. Do not extract "use strict" directives (usually handled by size threshold, but good to be safe)
      // (Skipping explicit check here as 'use strict' is tiny and won't pass threshold)

      const value = node.value;
      const size = Buffer.byteLength(value, 'utf-8');

      // Check threshold
      if (size < config.threshold) {
        return;
      }

      // Extract the string
      const refId = config.onExtract(value);
      referenceIds.push(refId);

      // Replace the literal value with the reference ID
      node.value = refId;
      node.raw = JSON.stringify(refId);

      extractedCount++;
      extractedBytes += size;
    },

    TemplateLiteral: (node: any, ancestors: any[]) => {
      // Only extract fully static template literals (no expressions)
      if (node.expressions.length > 0) {
        return;
      }

      // Should have exactly one quasi for a static template
      if (node.quasis.length !== 1) {
        return;
      }

      // Get Parent
      const parent = ancestors.length > 1 ? ancestors[ancestors.length - 2] : null;

      // SAFETY CHECK:
      // Do not transform Tagged Templates (gql`query...`)
      // Transforming these to a Literal (gql"ref") creates a Syntax Error.
      if (parent && parent.type === 'TaggedTemplateExpression' && parent.quasi === node) {
        return;
      }

      const quasi = node.quasis[0];
      const value = quasi.value.cooked;

      if (!value) {
        return;
      }

      const size = Buffer.byteLength(value, 'utf-8');

      // Check threshold
      if (size < config.threshold) {
        return;
      }

      // Extract the string
      const refId = config.onExtract(value);
      referenceIds.push(refId);

      // Transform TemplateLiteral to a simple Literal

      // CRITICAL: Do NOT use Object.keys().forEach(delete).
      // We must preserve 'loc', 'start', 'end' for source maps.
      delete node.quasis;
      delete node.expressions;

      // Set as Literal node
      node.type = 'Literal';
      node.value = refId;
      node.raw = JSON.stringify(refId);

      extractedCount++;
      extractedBytes += size;
    },
  });

  return {
    extractedCount,
    extractedBytes,
    referenceIds,
  };
}

/**
 * Check if a string should be extracted based on size
 *
 * @param value - The string to check
 * @param threshold - Size threshold in bytes
 * @returns true if the string should be extracted
 */
export function shouldExtract(value: string, threshold: number): boolean {
  return Buffer.byteLength(value, 'utf-8') >= threshold;
}
