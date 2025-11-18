/**
 * Handlers for JSON Schema string constraints
 */

import { z } from 'zod';
import { SchemaHandler, TypeRegistry, JSONSchemaObject } from '../../types';
import { createSafePatternValidator } from '../../security';

/**
 * Detects an implicit string type from string-specific constraints
 * If minLength, maxLength, or pattern are present without an explicit type, infer a string type
 */
export class ImplicitStringHandler implements SchemaHandler {
  /**
   * Checks if string constraints are present without explicit type declaration
   * Initializes a string type if string-specific keywords are found
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema to check for string constraints
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.type === undefined &&
      (schema.minLength !== undefined ||
        schema.maxLength !== undefined ||
        schema.pattern !== undefined)) {
      if (types.string === undefined) {
        types.string = z.string();
      }
    }
  }
}

/**
 * Handles the 'minLength' constraint for strings
 * Uses grapheme-aware length calculation for proper Unicode handling
 */
export class MinLengthHandler implements SchemaHandler {
  /**
   * Applies minimum length constraint to string type
   * Uses Array.from() to properly count grapheme clusters (visible characters)
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing minLength
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.minLength === undefined) return;
    if (types.string === false) return;

    const currentString = types.string || z.string();
    if (currentString instanceof z.ZodString) {
      types.string = currentString.refine(
        (value) => {
          // Use Array.from for proper grapheme counting (handles emojis, etc.)
          const graphemeLength = Array.from(value).length;
          return graphemeLength >= schema.minLength!;
        },
        { message: `String must be at least ${schema.minLength} characters long` }
      );
    }
  }
}

/**
 * Handles the 'maxLength' constraint for strings
 * Uses grapheme-aware length calculation for proper Unicode handling
 */
export class MaxLengthHandler implements SchemaHandler {
  /**
   * Applies maximum length constraint to string type
   * Uses Array.from() to properly count grapheme clusters (visible characters)
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing maxLength
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.maxLength === undefined) return;
    if (types.string === false) return;

    const currentString = types.string || z.string();
    if (currentString instanceof z.ZodString) {
      types.string = currentString.refine(
        (value) => {
          // Use Array.from for proper grapheme counting (handles emojis, etc.)
          const graphemeLength = Array.from(value).length;
          return graphemeLength <= schema.maxLength!;
        },
        { message: `String must be at most ${schema.maxLength} characters long` }
      );
    }
  }
}

/**
 * Handles the 'pattern' constraint for strings
 * Applies regular expression validation with ReDoS protection
 */
export class PatternHandler implements SchemaHandler {
  /**
   * Applies regex pattern constraint to a string type with ReDoS protection
   *
   * SECURITY: Patterns are validated before use to prevent ReDoS attacks.
   * Unsafe patterns are rejected and logged as warnings.
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing a pattern
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (!schema.pattern) return;
    if (types.string === false) return;

    const currentString = types.string || z.string();
    if (currentString instanceof z.ZodString) {
      // Use safe pattern validator that includes ReDoS protection
      const validator = createSafePatternValidator(schema.pattern);
      types.string = currentString.refine(
        validator,
        { message: `String must match pattern: ${schema.pattern}` }
      );
    }
  }
}
