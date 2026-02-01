/**
 * OpenAPI spec utility functions tests
 */

import type { OpenAPIV3 } from 'openapi-types';
import { forceJwtSecurity, removeSecurityFromOperations } from '../openapi.spec-utils';

describe('OpenAPI Spec Utils', () => {
  // Helper to create a minimal valid OpenAPI spec
  function createMinimalSpec(paths?: OpenAPIV3.PathsObject): OpenAPIV3.Document {
    return {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: paths ?? {},
    };
  }

  // Helper to create a spec with operations
  function createSpecWithOperations(): OpenAPIV3.Document {
    return createMinimalSpec({
      '/users': {
        get: {
          operationId: 'getUsers',
          responses: { '200': { description: 'Success' } },
        },
        post: {
          operationId: 'createUser',
          responses: { '200': { description: 'Success' } },
        },
      },
      '/users/{id}': {
        get: {
          operationId: 'getUser',
          responses: { '200': { description: 'Success' } },
        },
        delete: {
          operationId: 'deleteUser',
          responses: { '200': { description: 'Success' } },
        },
      },
    });
  }

  describe('forceJwtSecurity', () => {
    it('should add Bearer auth scheme by default', () => {
      const spec = createSpecWithOperations();

      const result = forceJwtSecurity(spec);

      expect(result.components?.securitySchemes?.BearerAuth).toEqual({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT Bearer token authentication',
      });
    });

    it('should add apiKey auth scheme with header location', () => {
      const spec = createSpecWithOperations();

      const result = forceJwtSecurity(spec, {
        schemeName: 'ApiKeyAuth',
        schemeType: 'apiKey',
        apiKeyIn: 'header',
        apiKeyName: 'X-API-Key',
      });

      expect(result.components?.securitySchemes?.ApiKeyAuth).toEqual({
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API Key authentication via header',
      });
    });

    it('should add apiKey auth scheme with query location', () => {
      const spec = createSpecWithOperations();

      const result = forceJwtSecurity(spec, {
        schemeName: 'ApiKeyAuth',
        schemeType: 'apiKey',
        apiKeyIn: 'query',
        apiKeyName: 'api_key',
      });

      expect(result.components?.securitySchemes?.ApiKeyAuth).toEqual({
        type: 'apiKey',
        in: 'query',
        name: 'api_key',
        description: 'API Key authentication via query',
      });
    });

    it('should add apiKey auth scheme with cookie location', () => {
      const spec = createSpecWithOperations();

      const result = forceJwtSecurity(spec, {
        schemeName: 'ApiKeyAuth',
        schemeType: 'apiKey',
        apiKeyIn: 'cookie',
        apiKeyName: 'session_id',
      });

      expect(result.components?.securitySchemes?.ApiKeyAuth).toEqual({
        type: 'apiKey',
        in: 'cookie',
        name: 'session_id',
        description: 'API Key authentication via cookie',
      });
    });

    it('should add Basic auth scheme', () => {
      const spec = createSpecWithOperations();

      const result = forceJwtSecurity(spec, {
        schemeName: 'BasicAuth',
        schemeType: 'basic',
      });

      expect(result.components?.securitySchemes?.BasicAuth).toEqual({
        type: 'http',
        scheme: 'basic',
        description: 'HTTP Basic authentication',
      });
    });

    it('should use custom scheme name', () => {
      const spec = createSpecWithOperations();

      const result = forceJwtSecurity(spec, {
        schemeName: 'CustomJWTAuth',
      });

      expect(result.components?.securitySchemes?.CustomJWTAuth).toBeDefined();
      expect(result.components?.securitySchemes?.BearerAuth).toBeUndefined();
    });

    it('should use custom description', () => {
      const spec = createSpecWithOperations();

      const result = forceJwtSecurity(spec, {
        description: 'Custom authentication description',
      });

      expect(result.components?.securitySchemes?.BearerAuth).toMatchObject({
        description: 'Custom authentication description',
      });
    });

    it('should apply security only to specified operations', () => {
      const spec = createSpecWithOperations();

      const result = forceJwtSecurity(spec, {
        operations: ['createUser', 'deleteUser'],
      });

      // These operations should have security
      const createUser = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.post as OpenAPIV3.OperationObject;
      const deleteUser = (result.paths?.['/users/{id}'] as OpenAPIV3.PathItemObject)
        ?.delete as OpenAPIV3.OperationObject;
      expect(createUser.security).toContainEqual({ BearerAuth: [] });
      expect(deleteUser.security).toContainEqual({ BearerAuth: [] });

      // These operations should NOT have security
      const getUsers = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      const getUser = (result.paths?.['/users/{id}'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      expect(getUsers.security).toBeUndefined();
      expect(getUser.security).toBeUndefined();
    });

    it('should skip operations not in filter', () => {
      const spec = createSpecWithOperations();

      const result = forceJwtSecurity(spec, {
        operations: ['nonExistent'],
      });

      // No operations should have security added
      const getUsers = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      expect(getUsers.security).toBeUndefined();
    });

    it('should not mutate the original spec', () => {
      const spec = createSpecWithOperations();
      const originalSpecString = JSON.stringify(spec);

      forceJwtSecurity(spec);

      expect(JSON.stringify(spec)).toBe(originalSpecString);
    });

    it('should initialize components.securitySchemes if components is missing', () => {
      const spec: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {},
      };

      const result = forceJwtSecurity(spec);

      expect(result.components).toBeDefined();
      expect(result.components?.securitySchemes).toBeDefined();
    });

    it('should initialize securitySchemes if only components exists', () => {
      const spec: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {},
        },
      };

      const result = forceJwtSecurity(spec);

      expect(result.components?.securitySchemes).toBeDefined();
      expect(result.components?.securitySchemes?.BearerAuth).toBeDefined();
    });

    it('should handle spec with no paths', () => {
      const spec: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {},
      };

      const result = forceJwtSecurity(spec);

      expect(result.components?.securitySchemes?.BearerAuth).toBeDefined();
    });

    it('should handle spec with undefined paths', () => {
      const spec: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: undefined as unknown as OpenAPIV3.PathsObject,
      };

      const result = forceJwtSecurity(spec);

      expect(result.components?.securitySchemes?.BearerAuth).toBeDefined();
    });

    it('should add security requirement to operation without existing security', () => {
      const spec = createSpecWithOperations();

      const result = forceJwtSecurity(spec);

      const getUsers = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      expect(getUsers.security).toEqual([{ BearerAuth: [] }]);
    });

    it('should not duplicate security requirement if already exists', () => {
      const spec = createMinimalSpec({
        '/users': {
          get: {
            operationId: 'getUsers',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Success' } },
          },
        },
      });
      spec.components = {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      };

      const result = forceJwtSecurity(spec);

      const getUsers = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      // Should not have duplicate security requirements
      expect(getUsers.security?.filter((s) => 'BearerAuth' in s).length).toBe(1);
    });

    it('should throw error for unsupported scheme type', () => {
      const spec = createSpecWithOperations();

      expect(() => {
        forceJwtSecurity(spec, {
          schemeType: 'unsupported' as any,
        });
      }).toThrow('Unsupported scheme type: unsupported');
    });

    it('should handle null path item gracefully', () => {
      const spec = createMinimalSpec({
        '/users': null as any,
        '/valid': {
          get: {
            operationId: 'validOp',
            responses: { '200': { description: 'Success' } },
          },
        },
      });

      const result = forceJwtSecurity(spec);

      const validOp = (result.paths?.['/valid'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      expect(validOp.security).toContainEqual({ BearerAuth: [] });
    });

    it('should handle operations without operationId when filter is specified', () => {
      const spec = createMinimalSpec({
        '/users': {
          get: {
            // No operationId
            responses: { '200': { description: 'Success' } },
          },
        },
      });

      const result = forceJwtSecurity(spec, {
        operations: ['someOperationId'],
      });

      const getOp = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      // Should not have security because it has no operationId
      expect(getOp.security).toBeUndefined();
    });

    it('should apply security to all HTTP methods', () => {
      const spec = createMinimalSpec({
        '/resource': {
          get: { operationId: 'getOp', responses: { '200': { description: 'OK' } } },
          put: { operationId: 'putOp', responses: { '200': { description: 'OK' } } },
          post: { operationId: 'postOp', responses: { '200': { description: 'OK' } } },
          delete: { operationId: 'deleteOp', responses: { '200': { description: 'OK' } } },
          options: { operationId: 'optionsOp', responses: { '200': { description: 'OK' } } },
          head: { operationId: 'headOp', responses: { '200': { description: 'OK' } } },
          patch: { operationId: 'patchOp', responses: { '200': { description: 'OK' } } },
          trace: { operationId: 'traceOp', responses: { '200': { description: 'OK' } } },
        },
      });

      const result = forceJwtSecurity(spec);

      const pathItem = result.paths?.['/resource'] as OpenAPIV3.PathItemObject;
      const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

      for (const method of methods) {
        const op = pathItem[method] as OpenAPIV3.OperationObject;
        expect(op.security).toContainEqual({ BearerAuth: [] });
      }
    });
  });

  describe('removeSecurityFromOperations', () => {
    it('should remove security from all operations when no filter specified', () => {
      const spec = createMinimalSpec({
        '/users': {
          get: {
            operationId: 'getUsers',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Success' } },
          },
          post: {
            operationId: 'createUser',
            security: [{ ApiKeyAuth: [] }],
            responses: { '200': { description: 'Success' } },
          },
        },
      });

      const result = removeSecurityFromOperations(spec);

      const getUsers = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      const createUser = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.post as OpenAPIV3.OperationObject;

      expect(getUsers.security).toEqual([]);
      expect(createUser.security).toEqual([]);
    });

    it('should remove security from specific operations only', () => {
      const spec = createMinimalSpec({
        '/users': {
          get: {
            operationId: 'getUsers',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Success' } },
          },
          post: {
            operationId: 'createUser',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Success' } },
          },
        },
      });

      const result = removeSecurityFromOperations(spec, ['getUsers']);

      const getUsers = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      const createUser = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.post as OpenAPIV3.OperationObject;

      expect(getUsers.security).toEqual([]);
      expect(createUser.security).toEqual([{ BearerAuth: [] }]);
    });

    it('should skip operations not in filter', () => {
      const spec = createMinimalSpec({
        '/users': {
          get: {
            operationId: 'getUsers',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Success' } },
          },
        },
      });

      const result = removeSecurityFromOperations(spec, ['nonExistent']);

      const getUsers = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      expect(getUsers.security).toEqual([{ BearerAuth: [] }]);
    });

    it('should not mutate the original spec', () => {
      const spec = createMinimalSpec({
        '/users': {
          get: {
            operationId: 'getUsers',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Success' } },
          },
        },
      });
      const originalSpecString = JSON.stringify(spec);

      removeSecurityFromOperations(spec);

      expect(JSON.stringify(spec)).toBe(originalSpecString);
    });

    it('should handle spec with no paths', () => {
      const spec: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {},
      };

      const result = removeSecurityFromOperations(spec);

      expect(result.paths).toEqual({});
    });

    it('should handle spec with undefined paths', () => {
      const spec: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: undefined as unknown as OpenAPIV3.PathsObject,
      };

      const result = removeSecurityFromOperations(spec);

      expect(result.paths).toBeUndefined();
    });

    it('should handle null path item gracefully', () => {
      const spec = createMinimalSpec({
        '/null': null as any,
        '/valid': {
          get: {
            operationId: 'validOp',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Success' } },
          },
        },
      });

      const result = removeSecurityFromOperations(spec);

      const validOp = (result.paths?.['/valid'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      expect(validOp.security).toEqual([]);
    });

    it('should handle operations without operationId when filter is specified', () => {
      const spec = createMinimalSpec({
        '/users': {
          get: {
            // No operationId
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Success' } },
          },
        },
      });

      const result = removeSecurityFromOperations(spec, ['someOperationId']);

      const getOp = (result.paths?.['/users'] as OpenAPIV3.PathItemObject)?.get as OpenAPIV3.OperationObject;
      // Should still have security because it doesn't match the filter (no operationId)
      expect(getOp.security).toEqual([{ BearerAuth: [] }]);
    });

    it('should remove security from all HTTP methods', () => {
      const spec = createMinimalSpec({
        '/resource': {
          get: { operationId: 'getOp', security: [{ Auth: [] }], responses: { '200': { description: 'OK' } } },
          put: { operationId: 'putOp', security: [{ Auth: [] }], responses: { '200': { description: 'OK' } } },
          post: { operationId: 'postOp', security: [{ Auth: [] }], responses: { '200': { description: 'OK' } } },
          delete: { operationId: 'deleteOp', security: [{ Auth: [] }], responses: { '200': { description: 'OK' } } },
          options: { operationId: 'optionsOp', security: [{ Auth: [] }], responses: { '200': { description: 'OK' } } },
          head: { operationId: 'headOp', security: [{ Auth: [] }], responses: { '200': { description: 'OK' } } },
          patch: { operationId: 'patchOp', security: [{ Auth: [] }], responses: { '200': { description: 'OK' } } },
          trace: { operationId: 'traceOp', security: [{ Auth: [] }], responses: { '200': { description: 'OK' } } },
        },
      });

      const result = removeSecurityFromOperations(spec);

      const pathItem = result.paths?.['/resource'] as OpenAPIV3.PathItemObject;
      const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

      for (const method of methods) {
        const op = pathItem[method] as OpenAPIV3.OperationObject;
        expect(op.security).toEqual([]);
      }
    });
  });
});
