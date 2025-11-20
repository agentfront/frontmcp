/**
 * Handlers for special cases and edge conditions
 */

import { z } from 'zod';
import { RefinementHandler, JSONSchemaObject } from '../../types';
import { deepEqual, hasOwnProperty } from '../../utils';

/**
 * Handles complex const values (arrays and objects)
 * Primitive const values are handled in primitive phase
 */
export class ConstComplexHandler implements RefinementHandler {
  /**
   * Applies const constraint for complex types (objects and arrays)
   * Uses deep equality to validate the entire structure matches
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing const
   * @returns Zod schema with const constraint for complex types
   *
   * @example
   * { "const": { "a": 1, "b": [2, 3] } }
   * // Only valid value is exactly { "a": 1, "b": [2, 3] }
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (schema.const === undefined) return zodSchema;

    const constValue = schema.const;

    // Primitives handled in the primitive phase
    if (typeof constValue !== 'object' || constValue === null) {
      return zodSchema;
    }

    return zodSchema.refine((value) => deepEqual(value, constValue), { message: 'Value must equal the const value' });
  }
}

/**
 * Handles complex enum values (arrays and objects)
 * Primitive enum values are handled in the primitive phase
 */
export class EnumComplexHandler implements RefinementHandler {
  /**
   * Applies enum constraint for complex types (objects and arrays)
   * Uses deep equality to check if a value matches any enum option
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing enum
   * @returns Zod schema with enum constraint for complex types
   *
   * @example
   * { "enum": [{ "type": "admin" }, { "type": "user" }] }
   * // Valid: { "type": "admin" } or { "type": "user" }
   * // Invalid: { "type": "guest" }
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (!schema.enum || schema.enum.length === 0) return zodSchema;

    const complexValues = schema.enum.filter((v) => Array.isArray(v) || (typeof v === 'object' && v !== null));

    if (complexValues.length === 0) return zodSchema;

    return zodSchema.refine(
      (value) => {
        if (typeof value !== 'object' || value === null) return true;

        return complexValues.some((enumValue) => deepEqual(value, enumValue));
      },
      { message: 'Value must match one of the enum values' },
    );
  }
}

/**
 * Handles the special case of '__proto__' in required fields
 * This is an edge case that needs special handling for security
 */
export class ProtoRequiredHandler implements RefinementHandler {
  /**
   * Handles __proto__ in the required array
   * This is a security-sensitive edge case that needs special validation
   * Only applies when the type is not explicitly defined
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema with potentially problematic required field
   * @returns Zod schema with proto required validation
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (!schema.required?.includes('__proto__') || schema.type !== undefined) {
      return zodSchema;
    }

    return z
      .any()
      .refine((value) => this.validateRequired(value, schema.required!), { message: 'Missing required properties' });
  }

  /**
   * Validates that all required properties exist on the object
   * Uses hasOwnProperty for security
   *
   * @param value - Value to validate
   * @param required - Array of required property names
   * @returns True if all required properties exist
   */
  private validateRequired(value: any, required: string[]): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return true;
    }

    return required.every((prop) => hasOwnProperty(value, prop));
  }
}

/**
 * Handles the 'default' keyword
 * Applies default values to schemas when the value is undefined
 */
export class DefaultHandler implements RefinementHandler {
  /**
   * Applies default value to schema if validation succeeds for default
   * Only applies default if it passes validation
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing default value
   * @returns Zod schema with default value applied
   *
   * @example
   * { "type": "string", "default": "hello" }
   * // If the value is undefined, "hello" will be used
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    const { default: defaultValue } = schema;

    if (defaultValue === undefined) return zodSchema;

    // Only apply default if it would pass validation
    if (!zodSchema.safeParse(defaultValue).success) {
      return zodSchema;
    }

    return zodSchema.default(defaultValue);
  }
}

/**
 * Handles the 'description' metadata keyword
 * Adds description to the Zod schema for documentation
 */
export class MetadataHandler implements RefinementHandler {
  /**
   * Applies description metadata to Zod schema
   * This is useful for generating documentation and error messages
   *
   * @param zodSchema - Current Zod schema
   * @param schema - JSON Schema containing description
   * @returns Zod schema with description applied
   *
   * @example
   * { "type": "string", "description": "User's email address" }
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny {
    if (schema.description) {
      zodSchema = zodSchema.describe(schema.description);
    }
    return zodSchema;
  }
}
