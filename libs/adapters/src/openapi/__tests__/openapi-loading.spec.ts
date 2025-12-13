/**
 * OpenAPI Adapter loading tests (URL, JSON, file)
 */

import OpenapiAdapter from '../openapi.adapter';
import { basicOpenApiSpec, spyOnConsole, createMockLogger } from './fixtures';

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

describe('OpenapiAdapter - Loading', () => {
  let consoleSpy: ReturnType<typeof spyOnConsole>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = spyOnConsole();
  });

  afterEach(() => {
    consoleSpy.restore();
  });

  describe('Load from JSON', () => {
    it('should load from JSON spec object', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        logger: createMockLogger(),
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledWith(
        basicOpenApiSpec,
        expect.objectContaining({
          baseUrl: 'https://api.example.com',
          validate: true,
          dereference: true,
        }),
      );
      expect(OpenAPIToolGenerator.fromURL).not.toHaveBeenCalled();
    });

    it('should handle complex OpenAPI spec', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const complexSpec = {
        ...basicOpenApiSpec,
        components: {
          schemas: {
            User: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
        },
      };

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: complexSpec,
        logger: createMockLogger(),
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledWith(complexSpec, expect.any(Object));
    });
  });

  describe('Load from URL', () => {
    it('should load from URL', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromURL.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        url: 'https://api.example.com/openapi.json',
        logger: createMockLogger(),
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromURL).toHaveBeenCalledWith(
        'https://api.example.com/openapi.json',
        expect.objectContaining({
          baseUrl: 'https://api.example.com',
          validate: true,
          dereference: true,
        }),
      );
      expect(OpenAPIToolGenerator.fromJSON).not.toHaveBeenCalled();
    });

    it('should pass custom headers for URL loading', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromURL.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        url: 'https://api.example.com/openapi.json',
        logger: createMockLogger(),
        loadOptions: {
          headers: {
            Authorization: 'Bearer spec-token',
          },
          timeout: 60000,
          followRedirects: false,
        },
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromURL).toHaveBeenCalledWith(
        'https://api.example.com/openapi.json',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer spec-token',
          },
          timeout: 60000,
          followRedirects: false,
        }),
      );
    });

    it('should handle URL loading errors', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      OpenAPIToolGenerator.fromURL.mockRejectedValue(new Error('Failed to fetch OpenAPI spec'));

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        url: 'https://api.example.com/openapi.json',
        logger: createMockLogger(),
      });

      await expect(adapter.fetch()).rejects.toThrow('Failed to fetch OpenAPI spec');
    });
  });

  describe('Validation Options', () => {
    it('should validate spec by default', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        logger: createMockLogger(),
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledWith(
        basicOpenApiSpec,
        expect.objectContaining({
          validate: true,
        }),
      );
    });

    it('should skip validation when disabled', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        logger: createMockLogger(),
        loadOptions: {
          validate: false,
        },
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledWith(
        basicOpenApiSpec,
        expect.objectContaining({
          validate: false,
        }),
      );
    });
  });

  describe('Dereferencing', () => {
    it('should dereference by default', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        logger: createMockLogger(),
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledWith(
        basicOpenApiSpec,
        expect.objectContaining({
          dereference: true,
        }),
      );
    });

    it('should preserve $refs when dereferencing is disabled', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        logger: createMockLogger(),
        loadOptions: {
          dereference: false,
        },
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledWith(
        basicOpenApiSpec,
        expect.objectContaining({
          dereference: false,
        }),
      );
    });
  });

  describe('Base URL Handling', () => {
    it('should use provided baseUrl', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://custom.example.com/v2',
        spec: basicOpenApiSpec,
        logger: createMockLogger(),
      });

      await adapter.fetch();

      expect(OpenAPIToolGenerator.fromJSON).toHaveBeenCalledWith(
        basicOpenApiSpec,
        expect.objectContaining({
          baseUrl: 'https://custom.example.com/v2',
        }),
      );
    });
  });
});
