/**
 * Handlers for advanced array and object validation
 */

import { z } from 'zod';
import { RefinementHandler, JSONSchemaObject } from '../../types';
import { isValidWithSchema, createUniqueItemsValidator, propertyExists } from '../../utils';
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';

/**
 * Handles the 'uniqueItems' constraint for arrays
 * Ensures all items in an array are unique using deep equality
 */
export class UniqueItemsHandler implements RefinementHandler {
  /**
   * Applies uniqueItems constraint using deep equality comparison
   * Handles complex types (objects, arrays) properly
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing uniqueItems
   * @returns Zod schema with uniqueItems constraint applied
   *
   * @example
   * { "type": "array", "uniqueItems": true }
   * // Valid: [1, 2, 3], [{"a":1}, {"a":2}]
   * // Invalid: [1, 2, 1], [{"a":1}, {"a":1}]
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (schema.uniqueItems !== true) return zodSchema;

    return zodSchema.refine(createUniqueItemsValidator(), {
      message: 'Array items must be unique',
    });
  }
}

/**
 * Handles the 'prefixItems' keyword for arrays
 * Validates fixed positions in an array with specific schemas
 */
export class PrefixItemsHandler implements RefinementHandler {
  /**
   * Applies prefixItems validation to array
   * First N items must match corresponding schemas, remaining items validated by 'items'
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing prefixItems
   * @returns Zod schema with prefixItems constraint applied
   *
   * @example
   * {
   *   "type": "array",
   *   "prefixItems": [
   *     { "type": "string" },
   *     { "type": "number" }
   *   ],
   *   "items": { "type": "boolean" }
   * }
   * // Valid: ["hello", 42, true, false]
   * // Invalid: [42, "hello"] (wrong types in prefix)
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (!schema.prefixItems || !Array.isArray(schema.prefixItems)) {
      return zodSchema;
    }

    const prefixItems = schema.prefixItems;
    const prefixSchemas = prefixItems.map((itemSchema) => convertJsonSchemaToZod(itemSchema));

    return zodSchema.refine(
      (value) => {
        if (!Array.isArray(value)) return true;

        // Validate prefix items
        for (let i = 0; i < Math.min(value.length, prefixSchemas.length); i++) {
          if (!isValidWithSchema(prefixSchemas[i], value[i])) {
            return false;
          }
        }

        // Validate additional items beyond the prefix
        if (value.length > prefixSchemas.length) {
          if (typeof schema.items === 'boolean' && !schema.items) {
            // No additional items allowed
            return false;
          } else if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
            // Additional items must match the item schema
            const additionalItemSchema = convertJsonSchemaToZod(schema.items);
            for (let i = prefixSchemas.length; i < value.length; i++) {
              if (!isValidWithSchema(additionalItemSchema, value[i])) {
                return false;
              }
            }
          }
        }

        return true;
      },
      { message: 'Array does not match prefixItems schema' },
    );
  }
}

/**
 * Handles the 'contains' keyword for arrays
 * Requires that an array contains at least one (or more) items matching a schema
 */
export class ContainsHandler implements RefinementHandler {
  /**
   * Applies contains constraint with optional min/maxContains
   * Array must contain between minContains and maxContains items matching the schema
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing contents, minContains, maxContains
   * @returns Zod schema with contains constraint applied
   *
   * @example
   * {
   *   "type": "array",
   *   "contains": { "type": "number", "minimum": 5 },
   *   "minContains": 2,
   *   "maxContains": 4
   * }
   * // Valid: [1, 5, 10, "text"] (has 2 numbers >= 5)
   * // Invalid: [1, 2, 3] (no numbers >= 5)
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (schema.contains === undefined) return zodSchema;

    const containsSchema = convertJsonSchemaToZod(schema.contains);
    const minContains = schema.minContains ?? 1;
    const maxContains = schema.maxContains;

    return zodSchema.refine(
      (value) => {
        if (!Array.isArray(value)) return true;

        let matchCount = 0;
        for (const item of value) {
          if (isValidWithSchema(containsSchema, item)) {
            matchCount++;
          }
        }

        if (matchCount < minContains) return false;
        return !(maxContains !== undefined && matchCount > maxContains);
      },
      { message: 'Array must contain required items matching the schema' },
    );
  }
}

/**
 * Handles object properties, required fields, and additionalProperties
 * This is the main handler for object shape definition
 */
export class ObjectPropertiesHandler implements RefinementHandler {
  /**
   * Applies complete object property validation including
   * - Property schemas from 'properties'
   * - Required field validation from 'required'
   * - Additional properties control from 'additionalProperties'
   *
   * For ZodObject/ZodRecord, builds a new object with a proper shape.
   * For other schemas, applies refinement validation.
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing properties, required, additionalProperties
   * @returns Zod schema with object constraints applied
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    // Skip if no object-related constraints
    if (!schema.properties && !schema.required && schema.additionalProperties === undefined) {
      return zodSchema;
    }

    // For ZodObject or ZodRecord, build proper object shape
    if (zodSchema instanceof z.ZodObject || zodSchema instanceof z.ZodRecord) {
      const shape: Record<string, z.ZodTypeAny> = {};

      // Convert properties to Zod schemas
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (propSchema !== undefined) {
            shape[key] = convertJsonSchemaToZod(propSchema);
          }
        }
      }

      // Handle required fields
      const requiredFields = new Set(Array.isArray(schema.required) ? schema.required : []);

      for (const key of Object.keys(shape)) {
        if (!requiredFields.has(key)) {
          shape[key] = shape[key].optional();
        }
      }

      // Control additional properties
      if (schema.additionalProperties === false) {
        return z.object(shape);
      } else {
        return z.object(shape).passthrough();
      }
    }

    // For other schema types, use refinement
    return zodSchema.refine(
      (value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return true;
        }

        // Validate each property
        if (schema.properties) {
          for (const [propName, propSchema] of Object.entries(schema.properties)) {
            if (propSchema !== undefined) {
              const propExists = propertyExists(value, propName);
              if (propExists) {
                const zodPropSchema = convertJsonSchemaToZod(propSchema);
                const propResult = zodPropSchema.safeParse(value[propName]);
                if (!propResult.success) {
                  return false;
                }
              }
            }
          }
        }

        // Check required properties
        if (schema.required && Array.isArray(schema.required)) {
          for (const requiredProp of schema.required) {
            if (!propertyExists(value, requiredProp)) {
              return false;
            }
          }
        }

        // Check additional properties restriction
        if (schema.additionalProperties === false && schema.properties) {
          const allowedProps = new Set(Object.keys(schema.properties));
          for (const prop in value) {
            if (!allowedProps.has(prop)) {
              return false;
            }
          }
        }

        return true;
      },
      { message: 'Object constraints validation failed' },
    );
  }
}
