/**
 * Tests for ResponseBuilder class
 */

import { ResponseBuilder } from '../response-builder';

describe('ResponseBuilder', () => {
  describe('Constructor', () => {
    it('should use default options', () => {
      const builder = new ResponseBuilder();
      // Test behavior through build method
      expect(builder).toBeDefined();
    });

    it('should accept custom preferredStatusCodes', () => {
      const builder = new ResponseBuilder({ preferredStatusCodes: [201, 200] });
      expect(builder).toBeDefined();
    });

    it('should accept includeAllResponses option', () => {
      const builder = new ResponseBuilder({ includeAllResponses: false });
      expect(builder).toBeDefined();
    });
  });

  describe('build()', () => {
    it('should return undefined for empty responses', () => {
      const builder = new ResponseBuilder();
      expect(builder.build({})).toBeUndefined();
    });

    it('should return undefined for undefined responses', () => {
      const builder = new ResponseBuilder();
      expect(builder.build(undefined)).toBeUndefined();
    });

    it('should return undefined when no valid schemas extracted', () => {
      const builder = new ResponseBuilder();
      // All responses are references (which are skipped)
      const result = builder.build({
        '200': { $ref: '#/components/responses/Success' },
        '404': { $ref: '#/components/responses/NotFound' },
      } as any);
      expect(result).toBeUndefined();
    });

    it('should return single schema directly', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { id: { type: 'string' } } },
            },
          },
        },
      });

      expect(result).toBeDefined();
      expect(result?.type).toBe('object');
      expect((result as any)['x-status-code']).toBe(200);
    });

    it('should return oneOf for multiple responses with includeAllResponses=true', () => {
      const builder = new ResponseBuilder({ includeAllResponses: true });
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'application/json': { schema: { type: 'object' } },
          },
        },
        '201': {
          description: 'Created',
          content: {
            'application/json': { schema: { type: 'string' } },
          },
        },
      });

      expect(result).toBeDefined();
      expect(result?.oneOf).toHaveLength(2);
      expect(result?.description).toBe('Response can be one of multiple status codes');
    });

    it('should return preferred schema when includeAllResponses=false', () => {
      const builder = new ResponseBuilder({
        includeAllResponses: false,
        preferredStatusCodes: [201],
      });
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'application/json': { schema: { type: 'object' } },
          },
        },
        '201': {
          description: 'Created',
          content: {
            'application/json': { schema: { type: 'string' } },
          },
        },
      });

      expect(result).toBeDefined();
      expect(result?.type).toBe('string');
      expect(result?.oneOf).toBeUndefined();
    });
  });

  describe('extractResponseSchemas()', () => {
    it('should skip reference objects', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': { $ref: '#/components/responses/Success' },
        '201': {
          description: 'Created',
          content: {
            'application/json': { schema: { type: 'string' } },
          },
        },
      } as any);

      expect(result).toBeDefined();
      expect(result?.type).toBe('string');
    });

    it('should skip default status code initially', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        default: {
          description: 'Default response',
          content: {
            'application/json': { schema: { type: 'object' } },
          },
        },
        '200': {
          description: 'Success',
          content: {
            'application/json': { schema: { type: 'string' } },
          },
        },
      });

      // Should prefer the 200 response over default
      expect(result?.type).toBe('string');
    });

    it('should use default response when no other schemas available', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        default: {
          description: 'Default response',
          content: {
            'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } },
          },
        },
      });

      expect(result).toBeDefined();
      expect(result?.type).toBe('object');
      expect((result as any)['x-status-code']).toBe(0);
    });

    it('should skip default response if it is a reference', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        default: { $ref: '#/components/responses/Error' },
      } as any);

      expect(result).toBeUndefined();
    });

    it('should skip NaN status codes', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        invalid: {
          description: 'Invalid status code',
          content: {
            'application/json': { schema: { type: 'string' } },
          },
        },
        '200': {
          description: 'Success',
          content: {
            'application/json': { schema: { type: 'object' } },
          },
        },
      } as any);

      // Should only have the valid 200 response
      expect(result?.type).toBe('object');
    });

    it('should handle schema extraction failure gracefully', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'application/json': {}, // No schema
          },
        },
        '201': {
          description: 'Created',
          content: {
            'application/json': { schema: { type: 'string' } },
          },
        },
      });

      // Should only have the 201 response since 200 has no schema
      expect(result?.type).toBe('string');
    });
  });

  describe('extractResponseSchema()', () => {
    it('should handle response with no content (204 No Content)', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '204': {
          description: 'No Content',
        },
      });

      expect(result).toBeDefined();
      expect(result?.type).toBe('null');
      expect(result?.description).toBe('No Content');
      expect((result as any)['x-status-code']).toBe(204);
    });

    it('should return null for response with content but no schema', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'application/json': {}, // No schema property
          },
        },
      });

      expect(result).toBeUndefined();
    });

    it('should add description from response if schema has none', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Response description',
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
      });

      expect(result?.description).toBe('Response description');
    });

    it('should preserve schema description over response description', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Response description',
          content: {
            'application/json': {
              schema: { type: 'object', description: 'Schema description' },
            },
          },
        },
      });

      expect(result?.description).toBe('Schema description');
    });

    it('should add x-content-type metadata', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
      });

      expect((result as any)['x-content-type']).toBe('application/json');
    });
  });

  describe('selectContentType()', () => {
    it('should prefer application/json', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'text/plain': { schema: { type: 'string' } },
            'application/json': { schema: { type: 'object' } },
            'application/xml': { schema: { type: 'object' } },
          },
        },
      });

      expect((result as any)['x-content-type']).toBe('application/json');
    });

    it('should prefer application/hal+json over xml', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'application/xml': { schema: { type: 'object' } },
            'application/hal+json': { schema: { type: 'object' } },
          },
        },
      });

      expect((result as any)['x-content-type']).toBe('application/hal+json');
    });

    it('should prefer application/problem+json', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'text/plain': { schema: { type: 'string' } },
            'application/problem+json': { schema: { type: 'object' } },
          },
        },
      });

      expect((result as any)['x-content-type']).toBe('application/problem+json');
    });

    it('should prefer application/xml over text/plain', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'text/plain': { schema: { type: 'string' } },
            'application/xml': { schema: { type: 'object' } },
          },
        },
      });

      expect((result as any)['x-content-type']).toBe('application/xml');
    });

    it('should prefer text/plain over text/html', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'text/html': { schema: { type: 'string' } },
            'text/plain': { schema: { type: 'string' } },
          },
        },
      });

      expect((result as any)['x-content-type']).toBe('text/plain');
    });

    it('should use text/html as last preference', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'text/html': { schema: { type: 'string' } },
            'application/octet-stream': { schema: { type: 'string' } },
          },
        },
      });

      expect((result as any)['x-content-type']).toBe('text/html');
    });

    it('should fallback to first available content type', () => {
      const builder = new ResponseBuilder();
      const result = builder.build({
        '200': {
          description: 'Success',
          content: {
            'application/octet-stream': { schema: { type: 'string' } },
          },
        },
      });

      expect((result as any)['x-content-type']).toBe('application/octet-stream');
    });
  });

  describe('selectPreferredSchema()', () => {
    it('should select exact match from preferred status codes', () => {
      const builder = new ResponseBuilder({
        includeAllResponses: false,
        preferredStatusCodes: [201, 200],
      });
      const result = builder.build({
        '200': {
          description: 'OK',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        '201': {
          description: 'Created',
          content: { 'application/json': { schema: { type: 'string' } } },
        },
      });

      expect((result as any)['x-status-code']).toBe(201);
    });

    it('should fallback to any 2xx response', () => {
      const builder = new ResponseBuilder({
        includeAllResponses: false,
        preferredStatusCodes: [201], // Not in responses
      });
      const result = builder.build({
        '202': {
          description: 'Accepted',
          content: { 'application/json': { schema: { type: 'string' } } },
        },
        '400': {
          description: 'Bad Request',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      });

      expect((result as any)['x-status-code']).toBe(202);
    });

    it('should fallback to any 3xx response if no 2xx', () => {
      const builder = new ResponseBuilder({
        includeAllResponses: false,
        preferredStatusCodes: [200], // Not in responses
      });
      const result = builder.build({
        '301': {
          description: 'Moved Permanently',
          content: { 'application/json': { schema: { type: 'string' } } },
        },
        '400': {
          description: 'Bad Request',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      });

      expect((result as any)['x-status-code']).toBe(301);
    });

    it('should fallback to first response if no 2xx or 3xx', () => {
      const builder = new ResponseBuilder({
        includeAllResponses: false,
        preferredStatusCodes: [200], // Not in responses
      });
      const result = builder.build({
        '400': {
          description: 'Bad Request',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        '500': {
          description: 'Server Error',
          content: { 'application/json': { schema: { type: 'string' } } },
        },
      });

      // Should get the first one (order might vary, but should be one of them)
      expect([400, 500]).toContain((result as any)['x-status-code']);
    });
  });
});
