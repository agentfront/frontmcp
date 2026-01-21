/**
 * Elicitation Content Validation Helper
 *
 * Validates elicitation result content against the stored JSON Schema.
 * Uses zod-from-json-schema for JSON Schema to Zod conversion.
 *
 * @module elicitation/helpers/validate-elicitation-content
 */

import { convertJsonSchemaToZod } from 'zod-from-json-schema';

/**
 * Validation result interface.
 */
export interface ElicitationValidationResult {
  /** Whether validation succeeded */
  success: boolean;
  /** Validation errors (if any) */
  errors?: Array<{
    path: string[];
    message: string;
  }>;
}

/**
 * Validate elicitation content against a JSON Schema.
 *
 * This function converts the JSON Schema to a Zod schema and validates
 * the content against it.
 *
 * @param content - The content to validate
 * @param jsonSchema - The JSON Schema to validate against
 * @returns Validation result with success flag and optional errors
 *
 * @example
 * ```typescript
 * const result = validateElicitationContent(
 *   { name: 'John', age: '30' }, // age should be number
 *   {
 *     type: 'object',
 *     properties: {
 *       name: { type: 'string' },
 *       age: { type: 'number' }
 *     },
 *     required: ['name', 'age']
 *   }
 * );
 *
 * if (!result.success) {
 *   console.log(result.errors);
 *   // [{ path: ['age'], message: 'Expected number, received string' }]
 * }
 * ```
 */
export function validateElicitationContent(
  content: unknown,
  jsonSchema: Record<string, unknown>,
): ElicitationValidationResult {
  try {
    const zodSchema = convertJsonSchemaToZod(jsonSchema);
    const parseResult = zodSchema.safeParse(content);

    if (parseResult.success) {
      return { success: true };
    }

    // Convert Zod errors to our format
    const errors = parseResult.error.issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
    }));

    return { success: false, errors };
  } catch (err) {
    // Schema conversion or parsing failed
    return {
      success: false,
      errors: [
        {
          path: [],
          message: `Schema validation error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}
