/**
 * OpenAPI Adapter security tests
 */

import OpenapiAdapter from '../openapi.adapter';
import { bearerAuthSpec, multiAuthSpec, mockAuthInfo, spyOnConsole } from './fixtures';
import type { McpOpenAPITool } from 'mcp-from-openapi';

// Mock the OpenAPIToolGenerator and security
jest.mock('mcp-from-openapi');

describe('OpenapiAdapter - Security', () => {
  let consoleSpy: ReturnType<typeof spyOnConsole>;
  let mockSecurityResolver: any;
  let mockCreateSecurityContext: any;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = spyOnConsole();

    // Setup mocks
    const mcpFromOpenapi = require('mcp-from-openapi');

    mockSecurityResolver = {
      resolve: jest.fn().mockResolvedValue({
        headers: { Authorization: 'Bearer mock-token' },
        query: {},
        cookies: {},
      }),
    };

    mockCreateSecurityContext = jest.fn((context) => context);

    mcpFromOpenapi.SecurityResolver = jest.fn(() => mockSecurityResolver);
    mcpFromOpenapi.createSecurityContext = mockCreateSecurityContext;
  });

  afterEach(() => {
    consoleSpy.restore();
  });

  describe('Auth Provider Mapper', () => {
    it('should use authProviderMapper for multi-auth', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool: McpOpenAPITool = {
        name: 'github_getRepos',
        description: 'Get repos',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        mapper: [
          {
            inputKey: 'githubAuth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: {
              scheme: 'GitHubAuth',
              type: 'http',
              httpScheme: 'bearer',
            },
          },
        ],
        metadata: {
          path: '/github/repos',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: multiAuthSpec,
        authProviderMapper: {
          GitHubAuth: (authInfo) => authInfo.user?.githubToken,
          SlackAuth: (authInfo) => authInfo.user?.slackToken,
        },
      });

      await adapter.fetch();

      // Should log LOW security risk
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Security Risk Score: LOW')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Valid Configuration: YES')
      );
    });

    it('should fail with missing auth provider mapping', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool: McpOpenAPITool = {
        name: 'github_getRepos',
        description: 'Get repos',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'githubAuth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: {
              scheme: 'GitHubAuth',
              type: 'http',
              httpScheme: 'bearer',
            },
          },
        ],
        metadata: {
          path: '/github/repos',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: multiAuthSpec,
        authProviderMapper: {
          SlackAuth: (authInfo) => authInfo.user?.slackToken,
          // GitHubAuth is missing!
        },
      });

      await expect(adapter.fetch()).rejects.toThrow(/Missing auth provider mappings.*GitHubAuth/);
    });
  });

  describe('Security Resolver', () => {
    it('should use custom securityResolver', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool: McpOpenAPITool = {
        name: 'getProtected',
        description: 'Get protected',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'bearerAuth',
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
      };

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const customResolver = jest.fn((tool, authInfo) => ({
        jwt: authInfo.token,
      }));

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        securityResolver: customResolver,
      });

      await adapter.fetch();

      // Should log LOW security risk (custom resolver)
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Security Risk Score: LOW')
      );
    });
  });

  describe('Static Auth', () => {
    it('should use staticAuth configuration', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool: McpOpenAPITool = {
        name: 'getProtected',
        description: 'Get protected',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'bearerAuth',
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
      };

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        staticAuth: {
          jwt: 'static-jwt-token',
        },
      });

      await adapter.fetch();

      // Should log MEDIUM security risk (static auth)
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Security Risk Score: MEDIUM')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Using staticAuth')
      );
    });
  });

  describe('Default Auth Behavior', () => {
    it('should use default ctx.authInfo.token when no auth config provided', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool: McpOpenAPITool = {
        name: 'getProtected',
        description: 'Get protected',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'bearerAuth',
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
      };

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        // No auth configuration
      });

      await adapter.fetch();

      // Should log MEDIUM security risk (default behavior)
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Security Risk Score: MEDIUM')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('No auth configuration provided')
      );
    });
  });

  describe('includeSecurityInInput', () => {
    it('should show HIGH risk when includeSecurityInInput is enabled', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool: McpOpenAPITool = {
        name: 'getProtected',
        description: 'Get protected',
        inputSchema: {
          type: 'object',
          properties: {
            BearerAuth: { type: 'string' },
          },
          required: ['BearerAuth'],
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
        ],
        metadata: {
          path: '/protected',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        generateOptions: {
          includeSecurityInInput: true,
        },
      });

      await adapter.fetch();

      // Should log HIGH security risk
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Security Risk Score: HIGH')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY WARNING')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('includeSecurityInInput is enabled')
      );
    });
  });

  describe('Additional Headers', () => {
    it('should support additionalHeaders option', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        additionalHeaders: {
          'X-API-Key': 'test-key',
          'X-Custom-Header': 'custom-value',
        },
      });

      await adapter.fetch();

      expect(adapter.options.additionalHeaders).toEqual({
        'X-API-Key': 'test-key',
        'X-Custom-Header': 'custom-value',
      });
    });
  });

  describe('Custom Mappers', () => {
    it('should support headersMapper', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const headersMapper = jest.fn((authInfo, headers) => {
        headers.set('X-Tenant-ID', authInfo.user?.tenantId || 'default');
        return headers;
      });

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        headersMapper,
      });

      await adapter.fetch();

      expect(adapter.options.headersMapper).toBe(headersMapper);
    });

    it('should support bodyMapper', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const bodyMapper = jest.fn((authInfo, body) => {
        return {
          ...body,
          userId: authInfo.user?.id,
        };
      });

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        bodyMapper,
      });

      await adapter.fetch();

      expect(adapter.options.bodyMapper).toBe(bodyMapper);
    });
  });
});
