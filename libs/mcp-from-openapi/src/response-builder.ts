import type { JSONSchema } from 'zod/v4/core';

/** JSON Schema type from Zod v4 */
type JsonSchema = JSONSchema.JSONSchema;
import type { ResponseObject, GenerateOptions, ResponsesObject } from './types';
import { isReferenceObject, toJsonSchema } from './types';

/**
 * Builds output schemas from OpenAPI response definitions
 */
export class ResponseBuilder {
  private preferredStatusCodes: number[];
  private includeAllResponses: boolean;

  constructor(options: GenerateOptions = {}) {
    this.preferredStatusCodes = options.preferredStatusCodes ?? [200, 201, 204, 202, 203, 206];
    this.includeAllResponses = options.includeAllResponses ?? true;
  }

  /**
   * Build output schema from responses
   */
  build(responses?: ResponsesObject): JsonSchema | undefined {
    if (!responses || Object.keys(responses).length === 0) {
      return undefined;
    }

    const schemas = this.extractResponseSchemas(responses);

    if (schemas.length === 0) {
      return undefined;
    }

    if (schemas.length === 1) {
      return schemas[0].schema;
    }

    if (this.includeAllResponses) {
      // Return union of all response schemas
      return {
        oneOf: schemas.map((s) => s.schema),
        description: 'Response can be one of multiple status codes',
      };
    } else {
      // Return only the preferred status code
      const preferred = this.selectPreferredSchema(schemas);
      return preferred.schema;
    }
  }

  /**
   * Extract schemas from all responses
   */
  private extractResponseSchemas(responses: ResponsesObject): ResponseSchema[] {
    const schemas: ResponseSchema[] = [];

    for (const [statusCode, response] of Object.entries(responses)) {
      // Skip if it's a reference object
      if (isReferenceObject(response)) continue;

      // Skip 'default' for now, we'll handle it separately
      if (statusCode === 'default') continue;

      const code = parseInt(statusCode, 10);
      if (isNaN(code)) continue;

      const schema = this.extractResponseSchema(response, code);
      if (schema) {
        schemas.push(schema);
      }
    }

    // Handle default response if no other schemas found
    if (schemas.length === 0 && responses['default']) {
      const defaultResponse = responses['default'];
      if (!isReferenceObject(defaultResponse)) {
        const schema = this.extractResponseSchema(defaultResponse, 0);
        if (schema) {
          schemas.push(schema);
        }
      }
    }

    return schemas;
  }

  /**
   * Extract schema from a single response
   */
  private extractResponseSchema(response: ResponseObject, statusCode: number): ResponseSchema | null {
    if (!response.content) {
      // Response with no content (e.g., 204 No Content)
      return {
        statusCode,
        schema: {
          type: 'null',
          description: response.description,
          'x-status-code': statusCode,
        } as JsonSchema,
      };
    }

    const contentType = this.selectContentType(response.content);
    const mediaType = response.content[contentType];

    if (!mediaType?.schema) {
      return null;
    }

    const schema: JsonSchema & { 'x-status-code'?: number } = {
      ...toJsonSchema(mediaType.schema),
      'x-status-code': statusCode,
    };

    // Add description if not already present
    if (!schema.description && response.description) {
      schema.description = response.description;
    }

    // Add content type metadata
    (schema as any)['x-content-type'] = contentType;

    return { statusCode, schema };
  }

  /**
   * Select the most appropriate content type
   */
  private selectContentType(content: Record<string, any>): string {
    // Preference order for responses
    const preferences = [
      'application/json',
      'application/hal+json',
      'application/problem+json',
      'application/xml',
      'text/plain',
      'text/html',
    ];

    for (const pref of preferences) {
      if (content[pref]) return pref;
    }

    // Fallback to first available
    return Object.keys(content)[0];
  }

  /**
   * Select the preferred schema based on status code preferences
   */
  private selectPreferredSchema(schemas: ResponseSchema[]): ResponseSchema {
    // First, try to find exact match in preferred list
    for (const preferredCode of this.preferredStatusCodes) {
      const found = schemas.find((s) => s.statusCode === preferredCode);
      if (found) return found;
    }

    // Next, try to find any 2xx response
    const success = schemas.find((s) => s.statusCode >= 200 && s.statusCode < 300);
    if (success) return success;

    // Next, try to find any 3xx response
    const redirect = schemas.find((s) => s.statusCode >= 300 && s.statusCode < 400);
    if (redirect) return redirect;

    // Fallback to first available
    return schemas[0];
  }
}

/**
 * Internal response schema structure
 */
interface ResponseSchema {
  statusCode: number;
  schema: JsonSchema;
}
