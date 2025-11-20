/**
 * Handlers for JSON Schema array constraints
 */

import { z } from 'zod';
import { SchemaHandler, TypeRegistry, JSONSchemaObject } from '../../types';
import { convertJsonSchemaToZod } from '../../converter';

/**
 * Detects an implicit array type from array-specific constraints
 * If array keywords are present without an explicit type, infer an array type
 */
export class ImplicitArrayHandler implements SchemaHandler {
  /**
   * Checks if array constraints are present without explicit type declaration
   * Initializes an array type if array-specific keywords are found
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema to check for array constraints
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (
      schema.type === undefined &&
      (schema.minItems !== undefined ||
        schema.maxItems !== undefined ||
        schema.items !== undefined ||
        schema.prefixItems !== undefined)
    ) {
      if (types.array === undefined) {
        types.array = z.array(z.any());
      }
    }
  }
}

/**
 * Handles the 'minItems' constraint for arrays
 * Applies minimum length validation to arrays
 */
export class MinItemsHandler implements SchemaHandler {
  /**
   * Applies minimum items constraint to the array type
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing minItems
   *
   * @example
   * { "type": "array", "minItems": 1 } // At least 1 item required
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.minItems === undefined) return;
    if (types.array === false) return;

    types.array = ((types.array || z.array(z.any())) as z.ZodArray<any>).min(schema.minItems);
  }
}

/**
 * Handles the 'maxItems' constraint for arrays
 * Applies maximum length validation to arrays
 */
export class MaxItemsHandler implements SchemaHandler {
  /**
   * Applies maximum items constraint to the array type
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing maxItems
   *
   * @example
   * { "type": "array", "maxItems": 10 } // At most 10 items allowed
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.maxItems === undefined) return;
    if (types.array === false) return;

    types.array = ((types.array || z.array(z.any())) as z.ZodArray<any>).max(schema.maxItems);
  }
}

/**
 * Handles the 'items' keyword for arrays
 * Defines the schema for array items (all items must match this schema)
 */
export class ItemsHandler implements SchemaHandler {
  /**
   * Applies items constraint to array type
   * Handles various forms:
   * - Object schema: all items must match
   * - Boolean true: any items allowed
   * - Boolean false: no items allowed (an empty array only)
   * - Array schema: treated as tuple (handled by TupleHandler)
   *
   * Preserves existing min/max constraints when creating a new array
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing items
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (types.array === false) return;

    // Array form is handled by TupleHandler
    if (Array.isArray(schema.items)) {
      types.array = types.array || z.array(z.any());
      return;
    }

    // Object schema - all items must match this schema
    if (schema.items && typeof schema.items !== 'boolean' && !schema.prefixItems) {
      const itemSchema = convertJsonSchemaToZod(schema.items);
      let arraySchema = z.array(itemSchema) as z.ZodArray<any>;

      // Reapply min/max constraints from the JSON schema to preserve them
      if (schema.minItems !== undefined) {
        arraySchema = arraySchema.min(schema.minItems);
      }
      if (schema.maxItems !== undefined) {
        arraySchema = arraySchema.max(schema.maxItems);
      }

      types.array = arraySchema;
      return;
    }

    // Boolean false - no items allowed (only empty array)
    if (typeof schema.items === 'boolean' && !schema.items) {
      if (!schema.prefixItems) {
        types.array = z.array(z.any()).max(0);
      } else {
        types.array = types.array || z.array(z.any());
      }
      return;
    }

    // Boolean true or undefined - any items allowed
    if (typeof schema.items === 'boolean' && schema.items) {
      types.array = types.array || z.array(z.any());
      return;
    }

    // prefixItems present - an array type remains
    if (schema.prefixItems) {
      types.array = types.array || z.array(z.any());
    }
  }
}

/**
 * Handles tuple validation using the 'items' array form
 * Converts array schemas with fixed-length item schemas to Zod tuples
 */
export class TupleHandler implements SchemaHandler {
  /**
   * Converts array schema with items array to Zod tuple
   * Only applies when the type is explicitly "array" and items is an array
   *
   * Each position in the item array defines the schema for that position in the tuple
   * Validates min/max items constraints against tuple length
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema with items as array
   *
   * @example
   * {
   *   "type": "array",
   *   "items": [
   *     { "type": "string" },
   *     { "type": "number" }
   *   ]
   * }
   * // Becomes z.tuple([z.string(), z.number()])
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.type !== 'array') return;
    if (!Array.isArray(schema.items)) return;
    if (types.array === false) return;

    const itemSchemas = schema.items.map((itemSchema) => convertJsonSchemaToZod(itemSchema));

    let tuple: z.ZodTypeAny | false;
    if (itemSchemas.length === 0) {
      tuple = z.tuple([]);
    } else {
      tuple = z.tuple(itemSchemas as any);
    }

    // Validate that min/max items constraints are compatible with tuple length
    if (schema.minItems !== undefined && schema.minItems > itemSchemas.length) {
      tuple = false; // Impossible constraint
    }
    if (schema.maxItems !== undefined && schema.maxItems < itemSchemas.length) {
      tuple = false; // Impossible constraint
    }

    types.tuple = tuple;
    types.array = false; // Disable a regular array since we're using tuple
  }
}
