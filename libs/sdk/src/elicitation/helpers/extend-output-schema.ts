/**
 * Output Schema Extension Utility
 *
 * Extends tool output schemas to include the elicitation fallback response type.
 * This allows tools to return either their normal output OR an elicitation pending
 * response when the client doesn't support the standard elicitation protocol.
 */

import { ELICITATION_FALLBACK_JSON_SCHEMA } from '../elicitation-fallback.schema';

/**
 * Extend a tool's output schema to include the elicitation fallback response type.
 *
 * When elicitation is enabled, tools may return an elicitation pending response
 * instead of their normal output. This function wraps the original schema in a
 * `oneOf` union to allow either response type.
 *
 * @param originalSchema - The tool's original output schema (may be undefined)
 * @returns Extended schema that allows either the original output or elicitation fallback
 *
 * @example
 * // Original schema:
 * { type: 'object', properties: { result: { type: 'string' } } }
 *
 * // Extended schema:
 * {
 *   oneOf: [
 *     { type: 'object', properties: { result: { type: 'string' } } },
 *     { type: 'object', properties: { elicitationPending: { ... } }, required: ['elicitationPending'] }
 *   ]
 * }
 */
export function extendOutputSchemaForElicitation(
  originalSchema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  // If no original schema, the elicitation fallback becomes the only typed option
  // In this case, we return an anyOf with an empty object schema (allows any object)
  // and the elicitation fallback schema. Using anyOf instead of oneOf because both
  // schemas can match objects, and oneOf requires exactly one match.
  if (!originalSchema) {
    return {
      anyOf: [{ type: 'object', additionalProperties: true }, ELICITATION_FALLBACK_JSON_SCHEMA],
    };
  }

  // If original schema already has oneOf, add elicitation to it
  if (Array.isArray(originalSchema['oneOf'])) {
    const existingOneOf = originalSchema['oneOf'] as Record<string, unknown>[];
    // Check if elicitation fallback is already in the oneOf
    const hasElicitationFallback = existingOneOf.some(
      (schema) =>
        schema['properties'] &&
        typeof schema['properties'] === 'object' &&
        'elicitationPending' in (schema['properties'] as object),
    );

    if (hasElicitationFallback) {
      // Already has elicitation fallback, return as-is
      return originalSchema;
    }

    // Add elicitation fallback to existing oneOf
    return {
      ...originalSchema,
      oneOf: [...existingOneOf, ELICITATION_FALLBACK_JSON_SCHEMA],
    };
  }

  // Wrap in oneOf: either original output OR elicitation fallback
  return {
    oneOf: [originalSchema, ELICITATION_FALLBACK_JSON_SCHEMA],
  };
}
