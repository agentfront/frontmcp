/**
 * Tests for Validator class
 */

import { Validator } from '../validator';
import type { OpenAPIDocument } from '../types';

describe('Validator', () => {
  let validator: Validator;

  beforeEach(() => {
    validator = new Validator();
  });

  describe('validate', () => {
    describe('OpenAPI Version', () => {
      it('should fail when openapi field is missing', async () => {
        const doc = {
          info: { title: 'Test', version: '1.0.0' },
          paths: {},
        } as any;

        const result = await validator.validate(doc);

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'MISSING_OPENAPI_VERSION',
          }),
        );
      });

      it('should fail for unsupported OpenAPI version', async () => {
        const doc = {
          openapi: '2.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {},
        } as any;

        const result = await validator.validate(doc);

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'INVALID_OPENAPI_VERSION',
          }),
        );
      });

      it('should pass for valid OpenAPI 3.0.x versions', async () => {
        const versions = ['3.0.0', '3.0.1', '3.0.2', '3.0.3'];

        for (const version of versions) {
          const doc: OpenAPIDocument = {
            openapi: version as any,
            info: { title: 'Test', version: '1.0.0' },
            paths: {
              '/test': {
                get: {
                  operationId: 'test',
                  responses: { '200': { description: 'OK' } },
                },
              },
            },
          };

          const result = await validator.validate(doc);
          expect(result.errors?.some((e) => e.code === 'INVALID_OPENAPI_VERSION')).toBeFalsy();
        }
      });

      it('should pass for valid OpenAPI 3.1.x versions', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.1.0' as any,
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        };

        const result = await validator.validate(doc);
        expect(result.errors?.some((e) => e.code === 'INVALID_OPENAPI_VERSION')).toBeFalsy();
      });
    });

    describe('Info Object', () => {
      it('should fail when info is missing', async () => {
        const doc = {
          openapi: '3.0.0',
          paths: {},
        } as any;

        const result = await validator.validate(doc);

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'MISSING_INFO',
          }),
        );
      });

      it('should fail when info.title is missing', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { version: '1.0.0' },
          paths: {},
        } as any;

        const result = await validator.validate(doc);

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'MISSING_TITLE',
          }),
        );
      });

      it('should fail when info.version is missing', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test' },
          paths: {},
        } as any;

        const result = await validator.validate(doc);

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'MISSING_VERSION',
          }),
        );
      });
    });

    describe('Paths', () => {
      it('should warn when no paths are defined', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {},
        };

        const result = await validator.validate(doc);

        expect(result.warnings).toContainEqual(
          expect.objectContaining({
            code: 'NO_PATHS',
          }),
        );
      });

      it('should error when path does not start with /', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            'invalid-path': {
              get: {
                operationId: 'test',
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        } as any;

        const result = await validator.validate(doc);

        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'INVALID_PATH_FORMAT',
          }),
        );
      });

      it('should warn when path has no operations', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/empty': {},
          },
        };

        const result = await validator.validate(doc);

        expect(result.warnings).toContainEqual(
          expect.objectContaining({
            code: 'NO_OPERATIONS',
          }),
        );
      });

      it('should not warn for path with $ref', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/ref': { $ref: '#/components/pathItems/test' },
          },
        } as any;

        const result = await validator.validate(doc);

        expect(result.warnings?.some((w) => w.code === 'NO_OPERATIONS')).toBeFalsy();
      });

      it('should skip null/undefined path items', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/valid': {
              get: {
                operationId: 'test',
                responses: { '200': { description: 'OK' } },
              },
            },
            '/null': null,
          },
        } as any;

        const result = await validator.validate(doc);

        // Should not throw and should process the valid path
        expect(result.valid).toBe(true);
      });
    });

    describe('Operations', () => {
      it('should warn when operationId is missing', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/test': {
              get: {
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        };

        const result = await validator.validate(doc);

        expect(result.warnings).toContainEqual(
          expect.objectContaining({
            code: 'NO_OPERATION_ID',
          }),
        );
      });

      it('should error when responses are missing', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/test': {
              get: {
                operationId: 'test',
              },
            },
          },
        } as any;

        const result = await validator.validate(doc);

        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'NO_RESPONSES',
          }),
        );
      });

      it('should error when responses is empty', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                responses: {},
              },
            },
          },
        } as any;

        const result = await validator.validate(doc);

        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'NO_RESPONSES',
          }),
        );
      });

      it('should validate all HTTP methods', async () => {
        const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
        const paths: any = {};

        for (const method of methods) {
          paths[`/${method}`] = {
            [method]: {
              operationId: `${method}Test`,
              responses: { '200': { description: 'OK' } },
            },
          };
        }

        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths,
        };

        const result = await validator.validate(doc);

        expect(result.valid).toBe(true);
      });

      it('should error when path parameter is not defined', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/users/{id}': {
              get: {
                operationId: 'getUser',
                responses: { '200': { description: 'OK' } },
                // Missing parameter definition for 'id'
              },
            },
          },
        };

        const result = await validator.validate(doc);

        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'MISSING_PATH_PARAMETER',
          }),
        );
      });

      it('should pass when all path parameters are defined', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/users/{id}/posts/{postId}': {
              get: {
                operationId: 'getUserPost',
                parameters: [
                  { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                  { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
                ],
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        };

        const result = await validator.validate(doc);

        expect(result.errors?.some((e) => e.code === 'MISSING_PATH_PARAMETER')).toBeFalsy();
      });
    });

    describe('Parameters', () => {
      it('should error when parameter name is missing', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                parameters: [{ in: 'query', schema: { type: 'string' } }],
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        } as any;

        const result = await validator.validate(doc);

        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'MISSING_PARAMETER_NAME',
          }),
        );
      });

      it('should error when parameter "in" is missing', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                parameters: [{ name: 'id', schema: { type: 'string' } }],
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        } as any;

        const result = await validator.validate(doc);

        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'MISSING_PARAMETER_IN',
          }),
        );
      });

      it('should error when parameter "in" is invalid', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                parameters: [{ name: 'id', in: 'body', schema: { type: 'string' } }],
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        } as any;

        const result = await validator.validate(doc);

        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'INVALID_PARAMETER_IN',
          }),
        );
      });

      it('should error when path parameter is not required', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/users/{id}': {
              get: {
                operationId: 'getUser',
                parameters: [{ name: 'id', in: 'path', required: false, schema: { type: 'string' } }],
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        };

        const result = await validator.validate(doc);

        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'PATH_PARAMETER_NOT_REQUIRED',
          }),
        );
      });

      it('should error when parameter schema and content are missing', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                parameters: [{ name: 'id', in: 'query' }],
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        } as any;

        const result = await validator.validate(doc);

        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: 'MISSING_PARAMETER_SCHEMA',
          }),
        );
      });

      it('should pass when parameter has content instead of schema', async () => {
        const doc = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                parameters: [
                  {
                    name: 'filter',
                    in: 'query',
                    content: {
                      'application/json': { schema: { type: 'object' } },
                    },
                  },
                ],
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        } as any;

        const result = await validator.validate(doc);

        expect(result.errors?.some((e) => e.code === 'MISSING_PARAMETER_SCHEMA')).toBeFalsy();
      });
    });

    describe('Servers', () => {
      it('should warn when no servers are defined', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        };

        const result = await validator.validate(doc);

        expect(result.warnings).toContainEqual(
          expect.objectContaining({
            code: 'NO_SERVERS',
          }),
        );
      });

      it('should not warn when servers are defined', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          servers: [{ url: 'https://api.example.com' }],
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        };

        const result = await validator.validate(doc);

        expect(result.warnings?.some((w) => w.code === 'NO_SERVERS')).toBeFalsy();
      });
    });

    describe('Security', () => {
      it('should warn when security is defined but no schemes exist', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          security: [{ apiKey: [] }],
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        };

        const result = await validator.validate(doc);

        expect(result.warnings).toContainEqual(
          expect.objectContaining({
            code: 'NO_SECURITY_SCHEMES',
          }),
        );
      });

      it('should not warn when security schemes are defined', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.0',
          info: { title: 'Test', version: '1.0.0' },
          security: [{ apiKey: [] }],
          components: {
            securitySchemes: {
              apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
            },
          },
          paths: {
            '/test': {
              get: {
                operationId: 'test',
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        };

        const result = await validator.validate(doc);

        expect(result.warnings?.some((w) => w.code === 'NO_SECURITY_SCHEMES')).toBeFalsy();
      });
    });

    describe('Valid Document', () => {
      it('should pass for a complete valid document', async () => {
        const doc: OpenAPIDocument = {
          openapi: '3.0.3',
          info: { title: 'Test API', version: '1.0.0', description: 'Test Description' },
          servers: [{ url: 'https://api.example.com', description: 'Production' }],
          paths: {
            '/users/{id}': {
              get: {
                operationId: 'getUser',
                summary: 'Get user by ID',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                  '200': {
                    description: 'Success',
                    content: {
                      'application/json': {
                        schema: { type: 'object', properties: { id: { type: 'string' } } },
                      },
                    },
                  },
                },
              },
            },
          },
        };

        const result = await validator.validate(doc);

        expect(result.valid).toBe(true);
        expect(result.errors).toBeUndefined();
      });
    });
  });
});
