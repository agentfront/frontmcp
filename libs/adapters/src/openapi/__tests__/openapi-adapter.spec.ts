/**
 * Basic OpenAPI Adapter tests
 */

import OpenapiAdapter from '../openapi.adapter';
import { basicOpenApiSpec, spyOnConsole } from './fixtures';

// Mock the OpenAPIToolGenerator
jest.mock('mcp-from-openapi', () => ({
  OpenAPIToolGenerator: {
    fromURL: jest.fn(),
    fromJSON: jest.fn(),
  },
  SecurityResolver: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue({
      headers: {},
      query: {},
      cookies: {},
    }),
  })),
  createSecurityContext: jest.fn((context) => context),
}));

describe('OpenapiAdapter - Basic Functionality', () => {
  let consoleSpy: ReturnType<typeof spyOnConsole>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = spyOnConsole();
  });

  afterEach(() => {
    consoleSpy.restore();
  });

  describe('Constructor', () => {
    it('should create adapter with required options', () => {
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
      });

      expect(adapter).toBeDefined();
      expect(adapter.options.name).toBe('test-api');
      expect(adapter.options.baseUrl).toBe('https://api.example.com');
    });

    it('should accept URL option', () => {
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        url: 'https://api.example.com/openapi.json',
      });

      expect(adapter).toBeDefined();
      expect('url' in adapter.options).toBe(true);
    });

    it('should accept additional headers', () => {
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        additionalHeaders: {
          'X-Custom-Header': 'value',
        },
      });

      expect(adapter.options.additionalHeaders).toEqual({
        'X-Custom-Header': 'value',
      });
    });

    it('should accept custom mappers', () => {
      const headersMapper = jest.fn((authInfo, headers) => headers);
      const bodyMapper = jest.fn((authInfo, body) => body);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        headersMapper,
        bodyMapper,
      });

      expect(adapter.options.headersMapper).toBe(headersMapper);
      expect(adapter.options.bodyMapper).toBe(bodyMapper);
    });
  });

  describe('Lazy Loading', () => {
    it('should not initialize generator in constructor', () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
      });

      // Generator should not be called in constructor
      expect(OpenAPIToolGenerator.fromJSON).not.toHaveBeenCalled();
      expect(OpenAPIToolGenerator.fromURL).not.toHaveBeenCalled();
    });

    it('should initialize generator on first fetch', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      // Mock generator
      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
      });

      // First fetch - should initialize
      await adapter.fetch();
      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledTimes(1);

      // Second fetch - should reuse generator
      await adapter.fetch();
      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledTimes(1);
    });
  });

  describe('Generate Options', () => {
    it('should pass generate options to tool generator', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        generateOptions: {
          includeDeprecated: true,
          includeSecurityInInput: true,
          preferredStatusCodes: [200, 201],
        },
      });

      await adapter.fetch();

      expect(mockGenerator.generateTools).toHaveBeenCalledWith(
        expect.objectContaining({
          includeDeprecated: true,
          includeSecurityInInput: true,
          preferredStatusCodes: [200, 201],
        })
      );
    });

    it('should use default generate options', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
      });

      await adapter.fetch();

      expect(mockGenerator.generateTools).toHaveBeenCalledWith(
        expect.objectContaining({
          preferredStatusCodes: [200, 201, 202, 204],
          includeDeprecated: false,
          includeAllResponses: true,
          includeSecurityInInput: false,
        })
      );
    });
  });

  describe('Load Options', () => {
    it('should pass load options to generator (fromJSON)', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        loadOptions: {
          validate: false,
          dereference: false,
        },
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledWith(
        basicOpenApiSpec,
        expect.objectContaining({
          baseUrl: 'https://api.example.com',
          validate: false,
          dereference: false,
        })
      );
    });

    it('should use default load options', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledWith(
        basicOpenApiSpec,
        expect.objectContaining({
          validate: true,
          dereference: true,
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw error if neither url nor spec is provided', async () => {
      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
      } as any);

      await expect(adapter.fetch()).rejects.toThrow(
        'Either url or spec must be provided in OpenApiAdapterOptions'
      );
    });
  });
});
