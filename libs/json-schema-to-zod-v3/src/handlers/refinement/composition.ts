/**
 * Handlers for JSON Schema composition keywords
 * These handle logical combinations of schemas
 */

import { z } from 'zod';
import { RefinementHandler, JSONSchemaObject } from '../../types';
import { isValidWithSchema } from '../../utils';
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';

/**
 * Handles the 'allOf' keyword
 * Validates that a value matches ALL the provided schemas (intersection)
 */
export class AllOfHandler implements RefinementHandler {
  /**
   * Creates an intersection of all schemas in allOf
   * The value must satisfy every schema in the array
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing allOf
   * @returns Zod schema with allOf constraint applied
   *
   * @example
   * {
   *   "allOf": [
   *     { "type": "object", "properties": { "name": { "type": "string" } } },
   *     { "type": "object", "properties": { "age": { "type": "number" } } }
   *   ]
   * }
   * // Value must have both name (string) and age (number)
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (!schema.allOf || schema.allOf.length === 0) return zodSchema;

    const allOfSchemas = schema.allOf.map((s) => convertJsonSchemaToZod(s));

    // Reduce all schemas into intersections
    return allOfSchemas.reduce((acc, s) => z.intersection(acc, s), zodSchema);
  }
}

/**
 * Handles the 'anyOf' keyword
 * Validates that a value matches AT LEAST ONE of the provided schemas (union)
 */
export class AnyOfHandler implements RefinementHandler {
  /**
   * Creates a union of all schemas in anyOf, then intersects with the current schema
   * The value must satisfy at least one schema in the array
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing anyOf
   * @returns Zod schema with anyOf constraint applied
   *
   * @example
   * {
   *   "anyOf": [
   *     { "type": "string" },
   *     { "type": "number" }
   *   ]
   * }
   * // Value can be either string or number
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (!schema.anyOf || schema.anyOf.length === 0) return zodSchema;

    // Build union of all anyOf schemas
    const anyOfSchema =
      schema.anyOf.length === 1
        ? convertJsonSchemaToZod(schema.anyOf[0])
        : z.union([
            convertJsonSchemaToZod(schema.anyOf[0]),
            convertJsonSchemaToZod(schema.anyOf[1]),
            ...schema.anyOf.slice(2).map((s) => convertJsonSchemaToZod(s)),
          ] as any);

    // Intersect with existing schema
    return z.intersection(zodSchema, anyOfSchema);
  }
}

/**
 * Handles the 'oneOf' keyword
 * Validates that a value matches EXACTLY ONE of the provided schemas
 */
export class OneOfHandler implements RefinementHandler {
  /**
   * Ensures value matches exactly one schema from oneOf array
   * More restrictive than anyOf - fails if multiple schemas match
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing oneOf
   * @returns Zod schema with oneOf constraint applied
   *
   * @example
   * {
   *   "oneOf": [
   *     { "type": "string", "minLength": 5 },
   *     { "type": "number", "minimum": 100 }
   *   ]
   * }
   * // Valid: "hello" (matches first), 150 (matches second)
   * // Invalid: 50 (doesn't match any), value matching both
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (!schema.oneOf || schema.oneOf.length === 0) return zodSchema;

    const oneOfSchemas = schema.oneOf.map((s) => convertJsonSchemaToZod(s));

    return zodSchema.refine(
      (value) => {
        let validCount = 0;

        for (const oneOfSchema of oneOfSchemas) {
          const result = oneOfSchema.safeParse(value);
          if (result.success) {
            validCount++;
            // Early exit if more than one matches
            if (validCount > 1) return false;
          }
        }

        return validCount === 1;
      },
      { message: 'Value must match exactly one of the oneOf schemas' },
    );
  }
}

/**
 * Handles the 'not' keyword
 * Validates that a value does NOT match the provided schema
 */
export class NotHandler implements RefinementHandler {
  /**
   * Ensures value does not match the not schema
   * Inverts the validation - fails if the schema would succeed
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing not
   * @returns Zod schema with not constraint applied
   *
   * @example
   * { "not": { "type": "null" } }
   * // Valid: any value except null
   * // Invalid: null
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (!schema.not) return zodSchema;

    const notSchema = convertJsonSchemaToZod(schema.not);

    return zodSchema.refine((value) => !isValidWithSchema(notSchema, value), {
      message: "Value must not match the 'not' schema",
    });
  }
}
