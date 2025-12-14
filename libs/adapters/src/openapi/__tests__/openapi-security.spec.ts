/**
 * OpenAPI Adapter security tests
 */

import OpenapiAdapter from '../openapi.adapter';
import { bearerAuthSpec, multiAuthSpec, mockAuthInfo, spyOnConsole, createMockLogger } from './fixtures';
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

      const mockLogger = createMockLogger();
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: multiAuthSpec,
        logger: mockLogger,
        authProviderMapper: {
          GitHubAuth: (authInfo) => authInfo.user?.githubToken,
          SlackAuth: (authInfo) => authInfo.user?.slackToken,
        },
      });

      await adapter.fetch();

      // Should log LOW security risk
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Security Risk Score: LOW'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Valid Configuration: YES'));
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
        logger: createMockLogger(),
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

      const mockLogger = createMockLogger();
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        logger: mockLogger,
        securityResolver: customResolver,
      });

      await adapter.fetch();

      // Should log LOW security risk (custom resolver)
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Security Risk Score: LOW'));
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

      const mockLogger = createMockLogger();
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        logger: mockLogger,
        staticAuth: {
          jwt: 'static-jwt-token',
        },
      });

      await adapter.fetch();

      // Should log MEDIUM security risk (static auth)
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Security Risk Score: MEDIUM'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Using staticAuth'));
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

      const mockLogger = createMockLogger();
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        logger: mockLogger,
        // No auth configuration
      });

      await adapter.fetch();

      // Should log MEDIUM security risk (default behavior)
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Security Risk Score: MEDIUM'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No auth configuration provided'));
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

      const mockLogger = createMockLogger();
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: bearerAuthSpec,
        logger: mockLogger,
        generateOptions: {
          includeSecurityInInput: true,
        },
      });

      await adapter.fetch();

      // Should log HIGH security risk
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Security Risk Score: HIGH'));
      // SECURITY WARNING is logged via warn method
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('SECURITY WARNING'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('includeSecurityInInput is enabled'));
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
        logger: createMockLogger(),
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
        logger: createMockLogger(),
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
        logger: createMockLogger(),
        bodyMapper,
      });

      await adapter.fetch();

      expect(adapter.options.bodyMapper).toBe(bodyMapper);
    });
  });

  describe('securitySchemesInInput', () => {
    it('should filter security schemes - keep only specified schemes in input', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool: McpOpenAPITool = {
        name: 'multiAuthTool',
        description: 'Tool with multiple auth',
        inputSchema: {
          type: 'object',
          properties: {
            GitHubAuth: { type: 'string' },
            ApiKeyAuth: { type: 'string' },
          },
          required: ['GitHubAuth', 'ApiKeyAuth'],
        },
        mapper: [
          {
            inputKey: 'GitHubAuth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: { scheme: 'GitHubAuth', type: 'http', httpScheme: 'bearer' },
          },
          {
            inputKey: 'ApiKeyAuth',
            type: 'header',
            key: 'X-API-Key',
            required: true,
            security: { scheme: 'ApiKeyAuth', type: 'apiKey', apiKeyIn: 'header', apiKeyName: 'X-API-Key' },
          },
        ],
        metadata: {
          path: '/multi-auth',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const mockLogger = createMockLogger();
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: multiAuthSpec,
        logger: mockLogger,
        // Only ApiKeyAuth should be in input
        securitySchemesInInput: ['ApiKeyAuth'],
        // GitHubAuth comes from context
        authProviderMapper: {
          GitHubAuth: (authInfo) => authInfo.user?.githubToken,
        },
      });

      const result = await adapter.fetch();

      // Should have generated tool with filtered input schema
      expect(result.tools).toHaveLength(1);

      // Generator should have been called with includeSecurityInInput: true
      expect(mockGenerator.generateTools).toHaveBeenCalledWith(
        expect.objectContaining({
          includeSecurityInInput: true,
        }),
      );

      // Should log info about per-scheme control
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Per-scheme security control enabled'));
    });

    it('should validate only non-input schemes have mappings', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool: McpOpenAPITool = {
        name: 'multiAuthTool',
        description: 'Tool with multiple auth',
        inputSchema: {
          type: 'object',
          properties: {
            GitHubAuth: { type: 'string' },
            SlackAuth: { type: 'string' },
          },
          required: ['GitHubAuth', 'SlackAuth'],
        },
        mapper: [
          {
            inputKey: 'GitHubAuth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: { scheme: 'GitHubAuth', type: 'http', httpScheme: 'bearer' },
          },
          {
            inputKey: 'SlackAuth',
            type: 'header',
            key: 'X-Slack-Token',
            required: true,
            security: { scheme: 'SlackAuth', type: 'http', httpScheme: 'bearer' },
          },
        ],
        metadata: {
          path: '/multi-auth',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const mockLogger = createMockLogger();
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: multiAuthSpec,
        logger: mockLogger,
        // GitHubAuth in input (user provides)
        securitySchemesInInput: ['GitHubAuth'],
        // SlackAuth from context - but NO mapping provided -> should fail
        // No authProviderMapper
      });

      // Should throw because SlackAuth has no mapping
      await expect(adapter.fetch()).rejects.toThrow(/Missing auth provider mappings.*SlackAuth/);
    });

    it('should pass validation when all non-input schemes have mappings', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool: McpOpenAPITool = {
        name: 'multiAuthTool',
        description: 'Tool with multiple auth',
        inputSchema: {
          type: 'object',
          properties: {
            GitHubAuth: { type: 'string' },
            SlackAuth: { type: 'string' },
          },
          required: ['GitHubAuth', 'SlackAuth'],
        },
        mapper: [
          {
            inputKey: 'GitHubAuth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: { scheme: 'GitHubAuth', type: 'http', httpScheme: 'bearer' },
          },
          {
            inputKey: 'SlackAuth',
            type: 'header',
            key: 'X-Slack-Token',
            required: true,
            security: { scheme: 'SlackAuth', type: 'http', httpScheme: 'bearer' },
          },
        ],
        metadata: {
          path: '/multi-auth',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const mockLogger = createMockLogger();
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: multiAuthSpec,
        logger: mockLogger,
        // GitHubAuth in input (user provides)
        securitySchemesInInput: ['GitHubAuth'],
        // SlackAuth from context - mapping provided
        authProviderMapper: {
          SlackAuth: (authInfo) => authInfo.user?.slackToken,
        },
      });

      // Should not throw
      const result = await adapter.fetch();
      expect(result.tools).toHaveLength(1);

      // Security risk should be MEDIUM (per-scheme control)
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Security Risk Score: MEDIUM'));
    });
  });
});
