/**
 * Handlers for JSON Schema number constraints
 */

import { z } from 'zod';
import { SchemaHandler, TypeRegistry, JSONSchemaObject } from '../../types';

/**
 * Handles the 'minimum' constraint for numbers
 * Applies inclusive lower bound validation
 */
export class MinimumHandler implements SchemaHandler {
  /**
   * Applies minimum value constraint to a number type (inclusive)
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing minimum
   *
   * @example
   * { "type": "number", "minimum": 0 } // >= 0
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.minimum === undefined) return;
    if (types.number === false) return;

    const currentNumber = types.number || z.number();
    if (currentNumber instanceof z.ZodNumber) {
      types.number = currentNumber.min(schema.minimum);
    }
  }
}

/**
 * Handles the 'maximum' constraint for numbers
 * Applies inclusive upper bound validation
 */
export class MaximumHandler implements SchemaHandler {
  /**
   * Applies maximum value constraint to a number type (inclusive)
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing maximum
   *
   * @example
   * { "type": "number", "maximum": 100 } // <= 100
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.maximum === undefined) return;
    if (types.number === false) return;

    const currentNumber = types.number || z.number();
    if (currentNumber instanceof z.ZodNumber) {
      types.number = currentNumber.max(schema.maximum);
    }
  }
}

/**
 * Handles the 'exclusiveMinimum' constraint for numbers
 * Applies exclusive lower-bound validation (value must be strictly greater)
 */
export class ExclusiveMinimumHandler implements SchemaHandler {
  /**
   * Applies exclusive minimum constraint to number type
   * Only supports numeric values (not boolean form from older drafts)
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing exclusiveMinimum
   *
   * @example
   * { "type": "number", "exclusiveMinimum": 0 } // > 0 (not including 0)
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.exclusiveMinimum === undefined) return;
    if (types.number === false) return;

    const currentNumber = types.number || z.number();
    if (currentNumber instanceof z.ZodNumber) {
      if (typeof schema.exclusiveMinimum === 'number') {
        types.number = currentNumber.gt(schema.exclusiveMinimum);
      } else {
        // Boolean form is not supported - disable number type
        types.number = false;
      }
    }
  }
}

/**
 * Handles the 'exclusiveMaximum' constraint for numbers
 * Applies exclusive upper-bound validation (value must be strictly less)
 */
export class ExclusiveMaximumHandler implements SchemaHandler {
  /**
   * Applies exclusive maximum constraint to number type
   * Only supports numeric values (not boolean form from older drafts)
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing exclusiveMaximum
   *
   * @example
   * { "type": "number", "exclusiveMaximum": 100 } // < 100 (not including 100)
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.exclusiveMaximum === undefined) return;
    if (types.number === false) return;

    const currentNumber = types.number || z.number();
    if (currentNumber instanceof z.ZodNumber) {
      if (typeof schema.exclusiveMaximum === 'number') {
        types.number = currentNumber.lt(schema.exclusiveMaximum);
      } else {
        // Boolean form is not supported - disable number type
        types.number = false;
      }
    }
  }
}

/**
 * Handles the 'multipleOf' constraint for numbers
 * Ensures the number is a multiple of the specified value
 * Uses floating-point-safe comparison with tolerance
 */
export class MultipleOfHandler implements SchemaHandler {
  /**
   * Applies multipleOf constraint to number type
   * Uses epsilon-based tolerance to handle floating-point precision issues
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing multipleOf
   *
   * @example
   * { "type": "number", "multipleOf": 5 } // Must be 0, 5, 10, 15, etc.
   * { "type": "number", "multipleOf": 0.01 } // Two decimal places (like currency)
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.multipleOf === undefined) return;
    if (types.number === false) return;

    const currentNumber = types.number || z.number();
    if (currentNumber instanceof z.ZodNumber) {
      types.number = currentNumber.refine(
        (value) => {
          if (schema.multipleOf === 0) return false;

          const quotient = value / schema.multipleOf!;
          const rounded = Math.round(quotient);

          // Calculate tolerance based on floating-point precision
          const tolerance = Math.min(
            Math.abs(value) * Number.EPSILON * 10,
            Math.abs(schema.multipleOf!) * Number.EPSILON * 10,
          );

          // Check if the quotient is close enough to an integer
          return Math.abs(quotient - rounded) <= tolerance / Math.abs(schema.multipleOf!);
        },
        { message: `Must be a multiple of ${schema.multipleOf}` },
      );
    }
  }
}
