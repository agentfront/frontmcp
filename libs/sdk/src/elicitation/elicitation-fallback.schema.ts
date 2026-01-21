/**
 * Elicitation Fallback JSON Schema
 *
 * Defines the JSON Schema for elicitation fallback responses.
 * This schema is used to extend tool output schemas when elicitation is enabled,
 * allowing tools to return either their normal output OR an elicitation pending response.
 *
 * The fallback response instructs the LLM to collect user input and call
 * sendElicitationResult to continue the original tool execution.
 */

/**
 * JSON Schema for the elicitation fallback response type.
 * This is used in oneOf union with tool output schemas.
 */
export const ELICITATION_FALLBACK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    elicitationPending: {
      type: 'object',
      description: 'Indicates this tool requires user input before it can complete',
      properties: {
        elicitId: {
          type: 'string',
          description: 'Unique identifier for this elicitation request. Pass to sendElicitationResult.',
        },
        message: {
          type: 'string',
          description: 'Question or prompt to display to the user',
        },
        instructions: {
          type: 'string',
          description: 'Instructions for the LLM on how to handle the elicitation request',
        },
        schema: {
          type: 'object',
          description: 'JSON Schema describing the expected user response format',
        },
      },
      required: ['elicitId', 'message'],
    },
  },
  required: ['elicitationPending'],
  description: 'Elicitation fallback response - tool requires user input to continue',
};

/**
 * Type representing the elicitation fallback response structure.
 * Used for type-checking at compile time.
 */
export interface ElicitationFallbackResponse {
  elicitationPending: {
    /** Unique identifier for this elicitation request */
    elicitId: string;
    /** Question or prompt to display to the user */
    message: string;
    /** Instructions for the LLM on handling the request */
    instructions?: string;
    /** JSON Schema for expected response */
    schema?: Record<string, unknown>;
  };
}
