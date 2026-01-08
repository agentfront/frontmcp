/**
 * Integration tests for OpenAPI security that use the REAL SecurityResolver
 *
 * These tests verify the end-to-end security flow WITHOUT mocking SecurityResolver.
 * They ensure that staticAuth, authProviderMapper, and default auth correctly
 * generate the Authorization headers in HTTP requests.
 *
 * For isolated unit tests of createSecurityContextFromAuth (with mocked SecurityResolver),
 * see openapi-security-unit.spec.ts
 */
import { SecurityResolver, createSecurityContext, type McpOpenAPITool } from 'mcp-from-openapi';
import type { FrontMcpContext } from '@frontmcp/sdk';
import { resolveToolSecurity } from '../openapi.security';
import { buildRequest } from '../openapi.utils';

describe('OpenAPI Security Integration (Real SecurityResolver)', () => {
  // Helper to create a mock FrontMcpContext
  const createMockContext = (authInfo: Record<string, unknown> = {}): FrontMcpContext =>
    ({
      authInfo,
      requestId: 'test-request-id',
      sessionId: 'test-session-id',
      scopeId: 'test-scope',
    } as FrontMcpContext);

  // Tool with bearer auth security requirement
  const createBearerAuthTool = (): McpOpenAPITool => ({
    name: 'getProtected',
    description: 'Get protected resource',
    inputSchema: { type: 'object', properties: {} },
    mapper: [
      {
        inputKey: 'BearerAuth',
        type: 'header',
        key: 'Authorization',
        required: true,
        security: {
          scheme: 'BearerAuth',
          type: 'http',
          httpScheme: 'bearer',
        },
      },
    ],
    metadata: {
      path: '/protected',
      method: 'get',
      servers: [{ url: 'https://api.example.com' }],
    },
  });

  // Tool with API key security requirement
  const createApiKeyTool = (): McpOpenAPITool => ({
    name: 'getWithApiKey',
    description: 'Get with API key',
    inputSchema: { type: 'object', properties: {} },
    mapper: [
      {
        inputKey: 'ApiKeyAuth',
        type: 'header',
        key: 'X-API-Key',
        required: true,
        security: {
          scheme: 'ApiKeyAuth',
          type: 'apiKey',
          apiKeyName: 'X-API-Key',
          apiKeyIn: 'header',
        },
      },
    ],
    metadata: {
      path: '/api/data',
      method: 'get',
      servers: [{ url: 'https://api.example.com' }],
    },
  });

  // Tool with basic auth security requirement
  const createBasicAuthTool = (): McpOpenAPITool => ({
    name: 'getWithBasicAuth',
    description: 'Get with basic auth',
    inputSchema: { type: 'object', properties: {} },
    mapper: [
      {
        inputKey: 'BasicAuth',
        type: 'header',
        key: 'Authorization',
        required: true,
        security: {
          scheme: 'BasicAuth',
          type: 'http',
          httpScheme: 'basic',
        },
      },
    ],
    metadata: {
      path: '/basic-protected',
      method: 'get',
      servers: [{ url: 'https://api.example.com' }],
    },
  });

  describe('staticAuth with jwt', () => {
    it('should generate Authorization Bearer header from staticAuth.jwt', async () => {
      const tool = createBearerAuthTool();
      const ctx = createMockContext({});

      const security = await resolveToolSecurity(tool, ctx, {
        staticAuth: { jwt: 'my-test-token' },
      });

      expect(security.headers).toBeDefined();
      expect(security.headers['Authorization']).toBe('Bearer my-test-token');
    });

    it('should include Authorization header in HTTP request via buildRequest', async () => {
      const tool = createBearerAuthTool();
      const ctx = createMockContext({});

      const security = await resolveToolSecurity(tool, ctx, {
        staticAuth: { jwt: 'my-test-token' },
      });

      const { headers } = buildRequest(tool, {}, security, 'https://api.example.com');

      expect(headers.get('Authorization')).toBe('Bearer my-test-token');
    });

    it('should handle tokens with special characters', async () => {
      const tool = createBearerAuthTool();
      const ctx = createMockContext({});

      // JWT tokens often contain dots and underscores
      const complexToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

      const security = await resolveToolSecurity(tool, ctx, {
        staticAuth: { jwt: complexToken },
      });

      expect(security.headers['Authorization']).toBe(`Bearer ${complexToken}`);
    });
  });

  describe('staticAuth with apiKey', () => {
    it('should generate X-API-Key header from staticAuth.apiKey', async () => {
      const tool = createApiKeyTool();
      const ctx = createMockContext({});

      const security = await resolveToolSecurity(tool, ctx, {
        staticAuth: { apiKey: 'my-api-key-123' },
      });

      expect(security.headers).toBeDefined();
      expect(security.headers['X-API-Key']).toBe('my-api-key-123');
    });

    it('should include API key header in buildRequest output', async () => {
      const tool = createApiKeyTool();
      const ctx = createMockContext({});

      const security = await resolveToolSecurity(tool, ctx, {
        staticAuth: { apiKey: 'my-api-key-123' },
      });

      const { headers } = buildRequest(tool, {}, security, 'https://api.example.com');

      expect(headers.get('X-API-Key')).toBe('my-api-key-123');
    });
  });

  describe('staticAuth with basic auth', () => {
    it('should generate Authorization Basic header from staticAuth.basic', async () => {
      const tool = createBasicAuthTool();
      const ctx = createMockContext({});

      // Base64 encoded "user:password"
      const basicCredentials = 'dXNlcjpwYXNzd29yZA==';

      const security = await resolveToolSecurity(tool, ctx, {
        staticAuth: { basic: basicCredentials },
      });

      expect(security.headers).toBeDefined();
      expect(security.headers['Authorization']).toBe(`Basic ${basicCredentials}`);
    });
  });

  describe('authProviderMapper', () => {
    it('should generate Authorization header from authProviderMapper', async () => {
      const tool = createBearerAuthTool();
      const ctx = createMockContext({
        user: { token: 'user-jwt-token-from-context' },
      });

      const security = await resolveToolSecurity(tool, ctx, {
        authProviderMapper: {
          BearerAuth: (context) => (context.authInfo as { user?: { token?: string } })?.user?.token,
        },
      });

      expect(security.headers['Authorization']).toBe('Bearer user-jwt-token-from-context');
    });

    it('should generate API key header from authProviderMapper', async () => {
      const tool = createApiKeyTool();
      const ctx = createMockContext({
        user: { apiKey: 'user-api-key' },
      });

      const security = await resolveToolSecurity(tool, ctx, {
        authProviderMapper: {
          ApiKeyAuth: (context) => (context.authInfo as { user?: { apiKey?: string } })?.user?.apiKey,
        },
      });

      expect(security.headers['X-API-Key']).toBe('user-api-key');
    });
  });

  describe('default ctx.authInfo.token', () => {
    it('should use ctx.authInfo.token when no auth config provided', async () => {
      const tool = createBearerAuthTool();
      const ctx = createMockContext({ token: 'default-token-from-context' });

      const security = await resolveToolSecurity(tool, ctx, {});

      expect(security.headers['Authorization']).toBe('Bearer default-token-from-context');
    });

    it('should include default token in buildRequest headers', async () => {
      const tool = createBearerAuthTool();
      const ctx = createMockContext({ token: 'default-token-from-context' });

      const security = await resolveToolSecurity(tool, ctx, {});
      const { headers } = buildRequest(tool, {}, security, 'https://api.example.com');

      expect(headers.get('Authorization')).toBe('Bearer default-token-from-context');
    });
  });

  describe('buildRequest integration', () => {
    it('should preserve all headers including Authorization in final request config', async () => {
      const tool = createBearerAuthTool();
      const ctx = createMockContext({});

      const security = await resolveToolSecurity(tool, ctx, {
        staticAuth: { jwt: 'my-token' },
      });

      const { url, headers, body } = buildRequest(tool, {}, security, 'https://api.example.com');

      // Verify URL is correct
      expect(url).toBe('https://api.example.com/protected');

      // Verify Authorization header is present
      expect(headers.get('Authorization')).toBe('Bearer my-token');

      // Verify Accept header is set (default behavior)
      expect(headers.get('accept')).toBe('application/json');

      // Verify body is undefined for GET request
      expect(body).toBeUndefined();
    });

    it('should handle multiple query params alongside Authorization header', async () => {
      const toolWithParams: McpOpenAPITool = {
        name: 'searchItems',
        description: 'Search items',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
        },
        mapper: [
          {
            inputKey: 'BearerAuth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: {
              scheme: 'BearerAuth',
              type: 'http',
              httpScheme: 'bearer',
            },
          },
          {
            inputKey: 'query',
            type: 'query',
            key: 'q',
            required: false,
          },
          {
            inputKey: 'limit',
            type: 'query',
            key: 'limit',
            required: false,
          },
        ],
        metadata: {
          path: '/search',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const ctx = createMockContext({});
      const security = await resolveToolSecurity(toolWithParams, ctx, {
        staticAuth: { jwt: 'search-token' },
      });

      const { url, headers } = buildRequest(
        toolWithParams,
        { query: 'test', limit: 10 },
        security,
        'https://api.example.com',
      );

      // Verify both Authorization and query params are handled
      expect(headers.get('Authorization')).toBe('Bearer search-token');
      expect(url).toContain('q=test');
      expect(url).toContain('limit=10');
    });
  });

  describe('custom securityResolver', () => {
    it('should use custom securityResolver when provided', async () => {
      const tool = createBearerAuthTool();
      const ctx = createMockContext({});

      const customResolver = jest.fn().mockResolvedValue({ jwt: 'custom-resolver-token' });

      const security = await resolveToolSecurity(tool, ctx, {
        securityResolver: customResolver,
      });

      expect(customResolver).toHaveBeenCalledWith(tool, ctx);
      expect(security.headers['Authorization']).toBe('Bearer custom-resolver-token');
    });

    it('should prioritize securityResolver over staticAuth', async () => {
      const tool = createBearerAuthTool();
      const ctx = createMockContext({});

      const customResolver = jest.fn().mockResolvedValue({ jwt: 'resolver-wins' });

      const security = await resolveToolSecurity(tool, ctx, {
        securityResolver: customResolver,
        staticAuth: { jwt: 'static-should-not-be-used' },
      });

      expect(security.headers['Authorization']).toBe('Bearer resolver-wins');
    });
  });
});
