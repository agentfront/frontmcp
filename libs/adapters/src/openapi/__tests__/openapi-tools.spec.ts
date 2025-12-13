/**
 * OpenAPI Tool creation tests
 */

import { createOpenApiTool } from '../openapi.tool';
import type { McpOpenAPITool } from 'mcp-from-openapi';
import { createMockLogger } from './fixtures';

// Mock mcp-from-openapi
jest.mock('mcp-from-openapi', () => ({
  SecurityResolver: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue({
      headers: { Authorization: 'Bearer mock-token' },
      query: {},
      cookies: {},
    }),
  })),
  createSecurityContext: jest.fn((context) => context),
}));

describe('OpenapiAdapter - Tool Creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Tool Creation', () => {
    it('should create a tool with GET method', () => {
      const mockOpenApiTool: McpOpenAPITool = {
        name: 'getUser',
        description: 'Get user by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        mapper: [
          {
            inputKey: 'id',
            type: 'path',
            key: 'id',
            required: true,
          },
        ],
        metadata: {
          path: '/users/{id}',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockLogger = createMockLogger();
      const tool = createOpenApiTool(
        mockOpenApiTool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
      expect(typeof tool).toBe('function');
    });

    it('should create a tool with POST method and body', () => {
      const mockOpenApiTool: McpOpenAPITool = {
        name: 'createUser',
        description: 'Create user',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
          },
          required: ['name', 'email'],
        },
        mapper: [
          {
            inputKey: 'name',
            type: 'body',
            key: 'name',
            required: true,
          },
          {
            inputKey: 'email',
            type: 'body',
            key: 'email',
            required: true,
          },
        ],
        metadata: {
          path: '/users',
          method: 'post',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockLogger = createMockLogger();
      const tool = createOpenApiTool(
        mockOpenApiTool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
      expect(typeof tool).toBe('function');
    });

    it('should create a tool with query parameters', () => {
      const mockOpenApiTool: McpOpenAPITool = {
        name: 'searchUsers',
        description: 'Search users',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
        },
        mapper: [
          {
            inputKey: 'query',
            type: 'query',
            key: 'q',
            required: true,
          },
          {
            inputKey: 'limit',
            type: 'query',
            key: 'limit',
            required: false,
          },
        ],
        metadata: {
          path: '/users/search',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockLogger = createMockLogger();
      const tool = createOpenApiTool(
        mockOpenApiTool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
    });

    it('should create a tool with header parameters', () => {
      const mockOpenApiTool: McpOpenAPITool = {
        name: 'getWithCustomHeader',
        description: 'Get with custom header',
        inputSchema: {
          type: 'object',
          properties: {
            customHeader: { type: 'string' },
          },
        },
        mapper: [
          {
            inputKey: 'customHeader',
            type: 'header',
            key: 'X-Custom-Header',
            required: true,
          },
        ],
        metadata: {
          path: '/custom',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockLogger = createMockLogger();
      const tool = createOpenApiTool(
        mockOpenApiTool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
    });

    it('should create a tool with security requirements', () => {
      const mockOpenApiTool: McpOpenAPITool = {
        name: 'getProtected',
        description: 'Get protected resource',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        mapper: [
          {
            inputKey: 'auth',
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

      const mockLogger = createMockLogger();
      const tool = createOpenApiTool(
        mockOpenApiTool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
    });

    it('should create a tool with additional headers configured', () => {
      const mockOpenApiTool: McpOpenAPITool = {
        name: 'getUser',
        description: 'Get user',
        inputSchema: { type: 'object', properties: {} },
        mapper: [],
        metadata: {
          path: '/users/me',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockLogger = createMockLogger();
      const tool = createOpenApiTool(
        mockOpenApiTool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
          additionalHeaders: {
            'X-API-Key': 'test-key',
            'X-Client-ID': 'client-123',
          },
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
    });

    it('should create a tool with custom mappers', () => {
      const mockOpenApiTool: McpOpenAPITool = {
        name: 'createUser',
        description: 'Create user',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        mapper: [
          {
            inputKey: 'name',
            type: 'body',
            key: 'name',
            required: true,
          },
        ],
        metadata: {
          path: '/users',
          method: 'post',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const headersMapper = jest.fn((authInfo, headers) => {
        headers.set('X-Tenant-ID', authInfo.user?.id || 'default');
        return headers;
      });

      const bodyMapper = jest.fn((authInfo, body) => ({
        ...body,
        createdBy: authInfo.user?.email,
      }));

      const mockLogger = createMockLogger();
      const tool = createOpenApiTool(
        mockOpenApiTool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
          headersMapper,
          bodyMapper,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
    });

    it('should handle complex JSON schemas', () => {
      const mockOpenApiTool: McpOpenAPITool = {
        name: 'complexOperation',
        description: 'Complex operation',
        inputSchema: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                age: { type: 'number' },
                address: {
                  type: 'object',
                  properties: {
                    street: { type: 'string' },
                    city: { type: 'string' },
                  },
                },
              },
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        mapper: [
          {
            inputKey: 'user',
            type: 'body',
            key: 'user',
            required: true,
          },
          {
            inputKey: 'tags',
            type: 'body',
            key: 'tags',
            required: false,
          },
        ],
        metadata: {
          path: '/complex',
          method: 'post',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockLogger = createMockLogger();
      const tool = createOpenApiTool(
        mockOpenApiTool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
    });

    it('should handle tools without input schema', () => {
      const mockOpenApiTool: McpOpenAPITool = {
        name: 'simpleGet',
        description: 'Simple GET',
        inputSchema: null as any,
        mapper: [],
        metadata: {
          path: '/simple',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const mockLogger = createMockLogger();
      const tool = createOpenApiTool(
        mockOpenApiTool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
    });
  });
});
