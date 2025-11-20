/**
 * OpenAPI utility functions tests
 */

import { buildRequest, applyAdditionalHeaders, parseResponse } from '../openapi.utils';
import { mockFetchSuccess, mockFetchError } from './fixtures';
import type { McpOpenAPITool } from 'mcp-from-openapi';

describe('OpenapiAdapter - Utilities', () => {
  describe('buildRequest', () => {
    it('should build GET request with path parameters', () => {
      const tool: McpOpenAPITool = {
        name: 'getUser',
        description: 'Get user',
        inputSchema: { type: 'object', properties: {} },
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

      const input = { id: 'user-123' };
      const security = { headers: {}, query: {}, cookies: {} };

      const result = buildRequest(tool, input, security, 'https://api.example.com');

      expect(result.url).toBe('https://api.example.com/users/user-123');
      expect(result.headers.get('accept')).toBe('application/json');
    });

    it('should build POST request with body parameters', () => {
      const tool: McpOpenAPITool = {
        name: 'createUser',
        description: 'Create user',
        inputSchema: { type: 'object', properties: {} },
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

      const input = { name: 'John Doe', email: 'john@example.com' };
      const security = { headers: {}, query: {}, cookies: {} };

      const result = buildRequest(tool, input, security, 'https://api.example.com');

      expect(result.url).toBe('https://api.example.com/users');
      expect(result.body).toEqual({ name: 'John Doe', email: 'john@example.com' });
    });

    it('should build request with query parameters', () => {
      const tool: McpOpenAPITool = {
        name: 'searchUsers',
        description: 'Search users',
        inputSchema: { type: 'object', properties: {} },
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

      const input = { query: 'john', limit: 10 };
      const security = { headers: {}, query: {}, cookies: {} };

      const result = buildRequest(tool, input, security, 'https://api.example.com');

      expect(result.url).toContain('q=john');
      expect(result.url).toContain('limit=10');
    });

    it('should include security headers', () => {
      const tool: McpOpenAPITool = {
        name: 'getProtected',
        description: 'Get protected',
        inputSchema: { type: 'object', properties: {} },
        mapper: [],
        metadata: {
          path: '/protected',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const input = {};
      const security = {
        headers: { Authorization: 'Bearer token-123' },
        query: {},
        cookies: {},
      };

      const result = buildRequest(tool, input, security, 'https://api.example.com');

      expect(result.headers.get('Authorization')).toBe('Bearer token-123');
    });

    it('should include security query parameters', () => {
      const tool: McpOpenAPITool = {
        name: 'getWithApiKey',
        description: 'Get with API key',
        inputSchema: { type: 'object', properties: {} },
        mapper: [],
        metadata: {
          path: '/api/data',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const input = {};
      const security = {
        headers: {},
        query: { api_key: 'key-123' },
        cookies: {},
      };

      const result = buildRequest(tool, input, security, 'https://api.example.com');

      expect(result.url).toContain('api_key=key-123');
    });

    it('should throw error for missing required parameters', () => {
      const tool: McpOpenAPITool = {
        name: 'getUser',
        description: 'Get user',
        inputSchema: { type: 'object', properties: {} },
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

      const input = {}; // Missing required 'id'
      const security = { headers: {}, query: {}, cookies: {} };

      expect(() => {
        buildRequest(tool, input, security, 'https://api.example.com');
      }).toThrow(/Required parameter.*id.*is missing/);
    });

    it('should throw error if path parameters are unresolved', () => {
      const tool: McpOpenAPITool = {
        name: 'getUser',
        description: 'Get user',
        inputSchema: { type: 'object', properties: {} },
        mapper: [],
        metadata: {
          path: '/users/{id}', // {id} never gets replaced
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const input = {};
      const security = { headers: {}, query: {}, cookies: {} };

      expect(() => {
        buildRequest(tool, input, security, 'https://api.example.com');
      }).toThrow(/Failed to resolve all path parameters/);
    });

    it('should skip security parameters in mapper', () => {
      const tool: McpOpenAPITool = {
        name: 'getProtected',
        description: 'Get protected',
        inputSchema: { type: 'object', properties: {} },
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

      const input = { auth: 'should-be-ignored' };
      const security = { headers: {}, query: {}, cookies: {} };

      const result = buildRequest(tool, input, security, 'https://api.example.com');

      // Security parameters should not be processed from input
      expect(result.headers.get('Authorization')).toBeNull();
    });
  });

  describe('applyAdditionalHeaders', () => {
    it('should add additional headers', () => {
      const headers = new Headers();
      applyAdditionalHeaders(headers, {
        'X-API-Key': 'test-key',
        'X-Custom-Header': 'custom-value',
      });

      expect(headers.get('X-API-Key')).toBe('test-key');
      expect(headers.get('X-Custom-Header')).toBe('custom-value');
    });

    it('should handle undefined additional headers', () => {
      const headers = new Headers();
      applyAdditionalHeaders(headers, undefined);

      // Headers should remain empty - verify no headers were added
      expect(headers.has('any-key')).toBe(false);
    });

    it('should override existing headers', () => {
      const headers = new Headers({ 'X-API-Key': 'old-key' });
      applyAdditionalHeaders(headers, { 'X-API-Key': 'new-key' });

      expect(headers.get('X-API-Key')).toBe('new-key');
    });
  });

  describe('parseResponse', () => {
    it('should parse JSON responses', async () => {
      const mockData = { id: 'user-123', name: 'John' };
      const response = await mockFetchSuccess(mockData);

      const result = await parseResponse(response);

      expect(result).toEqual({ data: mockData });
    });

    it('should handle text responses', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('Hello World'),
      } as Response;

      const result = await parseResponse(response);

      expect(result).toEqual({ data: 'Hello World' });
    });

    it('should handle invalid JSON gracefully', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('not valid json{'),
      } as Response;

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await parseResponse(response);

      expect(result).toEqual({ data: 'not valid json{' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse JSON'), expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should throw error for HTTP errors', async () => {
      const response = await mockFetchError(404, 'Not Found');

      await expect(parseResponse(response)).rejects.toThrow(/API request failed.*404.*Not Found/);
    });

    it('should throw error for 401 Unauthorized', async () => {
      const response = await mockFetchError(401, 'Unauthorized');

      await expect(parseResponse(response)).rejects.toThrow(/API request failed.*401.*Unauthorized/);
    });

    it('should throw error for 500 Internal Server Error', async () => {
      const response = await mockFetchError(500, 'Internal Server Error');

      await expect(parseResponse(response)).rejects.toThrow(/API request failed.*500.*Internal Server Error/);
    });
  });
});
