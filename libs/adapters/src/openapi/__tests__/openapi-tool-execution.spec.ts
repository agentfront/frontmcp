/**
 * Tests for OpenAPI tool execution
 * Tests the internal execute function including HTTP requests, mappers, and error handling
 */

import { createOpenApiTool } from '../openapi.tool';
import type { McpOpenAPITool } from 'mcp-from-openapi';
import { createMockLogger, basicOpenApiSpec } from './fixtures';
import { FrontMcpToolTokens } from '@frontmcp/sdk';

// Mock mcp-from-openapi
jest.mock('mcp-from-openapi', () => ({
  SecurityResolver: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue({
      headers: {},
      query: {},
      cookies: {},
    }),
  })),
  createSecurityContext: jest.fn((context) => context),
}));

// Mock the buildRequest and other utils
jest.mock('../openapi.utils', () => ({
  buildRequest: jest.fn((tool, input, security, baseUrl) => ({
    url: `${baseUrl}${tool.metadata.path}`,
    headers: new Map([['content-type', 'application/json']]),
    body: input,
  })),
  applyAdditionalHeaders: jest.fn(),
  parseResponse: jest.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
}));

// Mock the security resolver
jest.mock('../openapi.security', () => ({
  resolveToolSecurity: jest.fn().mockResolvedValue({}),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Create a mock tool for testing
function createMockTool(overrides: Partial<McpOpenAPITool> = {}): McpOpenAPITool {
  return {
    name: 'test_tool',
    description: 'Test tool',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
    },
    mapper: [],
    metadata: {
      method: 'get',
      path: '/test',
      servers: [{ url: 'https://api.example.com' }],
    },
    ...overrides,
  } as McpOpenAPITool;
}

// Mock tool context
function createMockToolContext() {
  return {
    context: {
      authInfo: { user: { id: 'user-1', tenantId: 'tenant-1' } },
      sessionId: 'session-1',
      traceId: 'trace-1',
    },
    get: jest.fn(),
    fail: jest.fn(),
    mark: jest.fn(),
  };
}

describe('createOpenApiTool - Tool Execution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    // Default successful response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ id: 1, name: 'Test' }),
    });
  });

  describe('Basic Execution', () => {
    it('should create a callable tool function', () => {
      const mockLogger = createMockLogger();
      const tool = createOpenApiTool(
        createMockTool(),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
      expect(typeof tool).toBe('function');
    });

    it('should execute tool and call fetch', async () => {
      const mockLogger = createMockLogger();
      const mockTool = createMockTool();
      const tool = createOpenApiTool(
        mockTool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      // Get the executor function
      const executor = tool();
      const toolCtx = createMockToolContext();

      await executor({ id: '123' }, toolCtx);

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Headers Mapper', () => {
    it('should apply headersMapper', async () => {
      const mockLogger = createMockLogger();
      const headersMapper = jest.fn((ctx, headers) => {
        const result = new Map(headers);
        result.set('X-Custom-Header', 'custom-value');
        return result;
      });

      const tool = createOpenApiTool(
        createMockTool(),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
          headersMapper,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();
      await executor({ id: '123' }, toolCtx);

      expect(headersMapper).toHaveBeenCalled();
    });

    it('should handle headersMapper error', async () => {
      const mockLogger = createMockLogger();
      const headersMapper = jest.fn(() => {
        throw new Error('Headers mapper failed');
      });

      const tool = createOpenApiTool(
        createMockTool(),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
          headersMapper,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      await expect(executor({ id: '123' }, toolCtx)).rejects.toThrow(
        "headersMapper failed for tool 'test_tool': Headers mapper failed",
      );
    });

    it('should handle non-Error thrown from headersMapper', async () => {
      const mockLogger = createMockLogger();
      const headersMapper = jest.fn(() => {
        throw 'string error';
      });

      const tool = createOpenApiTool(
        createMockTool(),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
          headersMapper,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      await expect(executor({ id: '123' }, toolCtx)).rejects.toThrow('string error');
    });
  });

  describe('Body Mapper', () => {
    it('should apply bodyMapper for POST requests', async () => {
      const mockLogger = createMockLogger();
      const bodyMapper = jest.fn((ctx, body) => ({
        ...body,
        createdBy: ctx.authInfo?.user?.id,
      }));

      // Need to mock buildRequest to return a body
      const { buildRequest } = require('../openapi.utils');
      buildRequest.mockReturnValue({
        url: 'https://api.example.com/test',
        headers: new Map(),
        body: { name: 'Test' },
      });

      const tool = createOpenApiTool(
        createMockTool({ metadata: { method: 'post', path: '/test', servers: [] } }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
          bodyMapper,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();
      await executor({ name: 'Test' }, toolCtx);

      expect(bodyMapper).toHaveBeenCalled();
    });

    it('should handle bodyMapper error', async () => {
      const mockLogger = createMockLogger();
      const bodyMapper = jest.fn(() => {
        throw new Error('Body mapper failed');
      });

      const { buildRequest } = require('../openapi.utils');
      buildRequest.mockReturnValue({
        url: 'https://api.example.com/test',
        headers: new Map(),
        body: { name: 'Test' },
      });

      const tool = createOpenApiTool(
        createMockTool({ metadata: { method: 'post', path: '/test', servers: [] } }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
          bodyMapper,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      await expect(executor({ name: 'Test' }, toolCtx)).rejects.toThrow(
        "bodyMapper failed for tool 'test_tool': Body mapper failed",
      );
    });
  });

  describe('Request Body Handling', () => {
    it('should serialize body as JSON', async () => {
      const mockLogger = createMockLogger();
      const { buildRequest } = require('../openapi.utils');
      buildRequest.mockReturnValue({
        url: 'https://api.example.com/test',
        headers: new Map(),
        body: { data: 'test' },
      });

      const tool = createOpenApiTool(
        createMockTool({ metadata: { method: 'post', path: '/test', servers: [] } }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();
      await executor({ data: 'test' }, toolCtx);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.any(String),
        }),
      );
    });

    it('should handle circular reference in body', async () => {
      const mockLogger = createMockLogger();
      const circularObj: any = { a: 1 };
      circularObj.self = circularObj;

      const { buildRequest } = require('../openapi.utils');
      buildRequest.mockReturnValue({
        url: 'https://api.example.com/test',
        headers: new Map(),
        body: circularObj,
      });

      const tool = createOpenApiTool(
        createMockTool({ metadata: { method: 'post', path: '/test', servers: [] } }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      await expect(executor({ a: 1 }, toolCtx)).rejects.toThrow('Failed to serialize request body');
    });

    it('should reject body exceeding size limit', async () => {
      const mockLogger = createMockLogger();
      const largeBody = { data: 'x'.repeat(1000) };

      const { buildRequest } = require('../openapi.utils');
      buildRequest.mockReturnValue({
        url: 'https://api.example.com/test',
        headers: new Map(),
        body: largeBody,
      });

      const tool = createOpenApiTool(
        createMockTool({ metadata: { method: 'post', path: '/test', servers: [] } }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
          maxRequestSize: 100, // Very small limit for testing
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      await expect(executor({ data: 'x'.repeat(1000) }, toolCtx)).rejects.toThrow('exceeds maximum allowed');
    });
  });

  describe('Request Timeout', () => {
    // Note: The actual timeout test is covered by the AbortError test below
    // since JavaScript AbortController behavior can't be easily tested with mocks

    it('should handle AbortError from fetch', async () => {
      const mockLogger = createMockLogger();

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const tool = createOpenApiTool(
        createMockTool(),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      await expect(executor({ id: '123' }, toolCtx)).rejects.toThrow('Request timeout');
    });

    it('should re-throw non-AbortError from fetch', async () => {
      const mockLogger = createMockLogger();

      mockFetch.mockRejectedValue(new Error('Network error'));

      const tool = createOpenApiTool(
        createMockTool(),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      await expect(executor({ id: '123' }, toolCtx)).rejects.toThrow('Network error');
    });
  });

  describe('Input Transforms', () => {
    it('should inject transformed values', async () => {
      const mockLogger = createMockLogger();
      const { buildRequest } = require('../openapi.utils');

      // Track what buildRequest receives
      let receivedInput: any;
      buildRequest.mockImplementation((tool: any, input: any) => {
        receivedInput = input;
        return {
          url: 'https://api.example.com/test',
          headers: new Map(),
          body: null,
        };
      });

      const tool = createOpenApiTool(
        createMockTool({
          metadata: {
            method: 'get',
            path: '/test',
            servers: [],
            adapter: {
              inputTransforms: [
                {
                  inputKey: 'injectedValue',
                  inject: () => 'injected-data',
                },
              ],
            },
          } as any,
        }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();
      await executor({ id: '123' }, toolCtx);

      expect(receivedInput).toHaveProperty('injectedValue', 'injected-data');
    });

    it('should handle transform error', async () => {
      const mockLogger = createMockLogger();

      const tool = createOpenApiTool(
        createMockTool({
          metadata: {
            method: 'get',
            path: '/test',
            servers: [],
            adapter: {
              inputTransforms: [
                {
                  inputKey: 'failingValue',
                  inject: () => {
                    throw new Error('Transform failed');
                  },
                },
              ],
            },
          } as any,
        }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      await expect(executor({ id: '123' }, toolCtx)).rejects.toThrow(
        "Input transform for 'failingValue' failed: Transform failed",
      );
    });

    it('should reject reserved inputKey __proto__', async () => {
      const mockLogger = createMockLogger();

      const tool = createOpenApiTool(
        createMockTool({
          metadata: {
            method: 'get',
            path: '/test',
            servers: [],
            adapter: {
              inputTransforms: [
                {
                  inputKey: '__proto__',
                  inject: () => 'malicious',
                },
              ],
            },
          } as any,
        }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      await expect(executor({ id: '123' }, toolCtx)).rejects.toThrow('reserved keys');
    });

    it('should reject non-object input', async () => {
      const mockLogger = createMockLogger();

      const tool = createOpenApiTool(
        createMockTool({
          metadata: {
            method: 'get',
            path: '/test',
            servers: [],
            adapter: {
              inputTransforms: [
                {
                  inputKey: 'test',
                  inject: () => 'value',
                },
              ],
            },
          } as any,
        }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      // Pass non-object input
      await expect(executor('not an object' as any, toolCtx)).rejects.toThrow('Invalid input type: expected object');
    });

    it('should reject null input', async () => {
      const mockLogger = createMockLogger();

      const tool = createOpenApiTool(
        createMockTool({
          metadata: {
            method: 'get',
            path: '/test',
            servers: [],
            adapter: {
              inputTransforms: [
                {
                  inputKey: 'test',
                  inject: () => 'value',
                },
              ],
            },
          } as any,
        }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();

      await expect(executor(null as any, toolCtx)).rejects.toThrow('expected object, got null');
    });

    it('should handle async transform injection', async () => {
      const mockLogger = createMockLogger();
      const { buildRequest } = require('../openapi.utils');

      let receivedInput: any;
      buildRequest.mockImplementation((tool: any, input: any) => {
        receivedInput = input;
        return {
          url: 'https://api.example.com/test',
          headers: new Map(),
          body: null,
        };
      });

      const tool = createOpenApiTool(
        createMockTool({
          metadata: {
            method: 'get',
            path: '/test',
            servers: [],
            adapter: {
              inputTransforms: [
                {
                  inputKey: 'asyncValue',
                  inject: async () => {
                    await new Promise((r) => setTimeout(r, 10));
                    return 'async-result';
                  },
                },
              ],
            },
          } as any,
        }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();
      await executor({ id: '123' }, toolCtx);

      expect(receivedInput).toHaveProperty('asyncValue', 'async-result');
    });

    it('should not inject undefined values', async () => {
      const mockLogger = createMockLogger();
      const { buildRequest } = require('../openapi.utils');

      let receivedInput: any;
      buildRequest.mockImplementation((tool: any, input: any) => {
        receivedInput = input;
        return {
          url: 'https://api.example.com/test',
          headers: new Map(),
          body: null,
        };
      });

      const tool = createOpenApiTool(
        createMockTool({
          metadata: {
            method: 'get',
            path: '/test',
            servers: [],
            adapter: {
              inputTransforms: [
                {
                  inputKey: 'undefinedValue',
                  inject: () => undefined,
                },
              ],
            },
          } as any,
        }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();
      await executor({ id: '123' }, toolCtx);

      expect(receivedInput).not.toHaveProperty('undefinedValue');
    });
  });

  describe('Content-Type Header', () => {
    it('should set content-type for body if not already set', async () => {
      const mockLogger = createMockLogger();
      const { buildRequest } = require('../openapi.utils');
      buildRequest.mockReturnValue({
        url: 'https://api.example.com/test',
        headers: new Map(), // No content-type set
        body: { data: 'test' },
      });

      const tool = createOpenApiTool(
        createMockTool({ metadata: { method: 'post', path: '/test', servers: [] } }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();
      await executor({ data: 'test' }, toolCtx);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers.get('content-type')).toBe('application/json');
    });

    it('should not override existing content-type', async () => {
      const mockLogger = createMockLogger();
      const { buildRequest } = require('../openapi.utils');
      buildRequest.mockReturnValue({
        url: 'https://api.example.com/test',
        headers: new Map([['content-type', 'text/plain']]), // Already set
        body: { data: 'test' },
      });

      const tool = createOpenApiTool(
        createMockTool({ metadata: { method: 'post', path: '/test', servers: [] } }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      const executor = tool();
      const toolCtx = createMockToolContext();
      await executor({ data: 'test' }, toolCtx);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers.get('content-type')).toBe('text/plain');
    });
  });

  describe('Schema Conversion', () => {
    it('should handle invalid JSON schema gracefully', () => {
      const mockLogger = createMockLogger();

      const tool = createOpenApiTool(
        createMockTool({
          inputSchema: null as any, // Invalid schema
        }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('No valid JSON schema'));
    });

    it('should handle unconvertible schema', () => {
      const mockLogger = createMockLogger();

      // Schema that might fail conversion
      const tool = createOpenApiTool(
        createMockTool({
          inputSchema: {
            type: 'object',
            properties: {
              recursive: { $ref: '#/definitions/nonexistent' },
            },
          },
        }),
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: basicOpenApiSpec,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(tool).toBeDefined();
      // Should still create tool even with schema conversion failure
    });
  });
});
