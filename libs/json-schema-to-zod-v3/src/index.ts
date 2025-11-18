/**
 * JSON Schema to Zod Converter
 *
 * A production-ready library for converting JSON Schema (Draft 7+) to Zod v3 schemas.
 * Supports all major JSON Schema features including types, constraints, and composition.
 *
 * @packageDocumentation
 *
 * @example Basic usage
 * ```typescript
 * import { convertJsonSchemaToZod } from 'json-schema-to-zod';
 *
 * const jsonSchema = {
 *   type: "string",
 *   minLength: 5,
 *   maxLength: 100
 * };
 *
 * const zodSchema = convertJsonSchemaToZod(jsonSchema);
 * const result = zodSchema.parse("hello world");
 * ```
 *
 * @example Object schema
 * ```typescript
 * import { jsonSchemaObjectToZodRawShape } from 'json-schema-to-zod';
 * import { z } from 'zod';
 *
 * const userSchema = {
 *   type: "object",
 *   properties: {
 *     name: { type: "string" },
 *     email: { type: "string" }
 *   },
 *   required: ["name", "email"]
 * };
 *
 * const zodShape = jsonSchemaObjectToZodRawShape(userSchema);
 * const zodUserSchema = z.object(zodShape);
 * ```
 */

import { z } from 'zod';
import { convertJsonSchemaToZod } from './converter';
import { JSONSchemaObject } from './types';

// Re-export utilities
export {
  createUniqueItemsValidator,
  isValidWithSchema,
  deepEqual
} from './utils';

// Re-export security utilities
export {
  validatePattern,
  createSafeRegExp,
  createSafePatternValidator,
  setSecurityConfig,
  getSecurityConfig,
  DEFAULT_SECURITY_CONFIG,
} from './security';

export type {
  PatternValidationResult,
  PatternSecurityConfig,
} from './security';

// Re-export types
export type {
  JSONSchema,
  JSONSchemaObject,
  JSONSchemaType,
  TypeRegistry,
  SchemaHandler,
  RefinementHandler
} from './types';

// Re-export main converter
export { convertJsonSchemaToZod };

/**
 * Converts a JSON Schema object's properties to a Zod object shape
 *
 * This is a convenience function for creating Zod object schemas from JSON Schema.
 * It processes the 'properties' field and respects 'required' to make fields optional/required.
 *
 * @param schema - JSON Schema object with 'properties' field
 * @returns Object suitable for passing to z.object()
 *
 * @example
 * ```typescript
 * const schema = {
 *   type: "object",
 *   properties: {
 *     name: { type: "string", minLength: 1 },
 *     age: { type: "number", minimum: 0 },
 *     email: { type: "string" }
 *   },
 *   required: ["name", "email"]
 * };
 *
 * const shape = jsonSchemaObjectToZodRawShape(schema);
 * const zodSchema = z.object(shape);
 *
 * // Resulting schema:
 * // {
 * //   name: z.string().min(1),           // required
 * //   email: z.string(),                  // required
 * //   age: z.number().min(0).optional()   // optional
 * // }
 * ```
 *
 * @remarks
 * - Fields listed in 'required' will be required in the Zod schema
 * - Fields not in 'required' will have .optional() applied
 * - If 'required' is not specified, all fields are optional
 * - Undefined property values are skipped
 */
export function jsonSchemaObjectToZodRawShape(
  schema: JSONSchemaObject
): Record<string, z.ZodTypeAny> {
  const raw: Record<string, z.ZodTypeAny> = {};

  const requiredArray = Array.isArray(schema.required) ? schema.required : [];
  const requiredFields = new Set(requiredArray);

  // Process each property
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    if (value === undefined) continue;

    // Convert the property schema to Zod
    let zodType = convertJsonSchemaToZod(value);

    // Make field optional if not in required array
    if (requiredArray.length > 0) {
      if (!requiredFields.has(key)) {
        zodType = zodType.optional();
      }
    } else {
      // No required array means all fields are optional
      zodType = zodType.optional();
    }

    raw[key] = zodType;
  }

  return raw;
}

/**
 * Default export for convenience
 */
export default {
  convertJsonSchemaToZod,
  jsonSchemaObjectToZodRawShape,
  createUniqueItemsValidator: () => {
    const { createUniqueItemsValidator: fn } = require('./utils');
    return fn();
  },
  isValidWithSchema: (schema: z.ZodTypeAny, value: any) => {
    const { isValidWithSchema: fn } = require('./utils');
    return fn(schema, value);
  },
};
