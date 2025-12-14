import { buildRequest, parseResponse, validateBaseUrl } from '../openapi.utils';
import type { McpOpenAPITool } from 'mcp-from-openapi';

// Helper to create a basic tool for testing
function createTestTool(overrides: Partial<McpOpenAPITool> = {}): McpOpenAPITool {
  return {
    name: 'testTool',
    description: 'Test tool',
    inputSchema: { type: 'object', properties: {} },
    mapper: [],
    metadata: {
      path: '/test',
      method: 'get',
      servers: [{ url: 'https://api.example.com' }],
    },
    ...overrides,
  };
}

describe('OpenapiAdapter - Edge Cases', () => {
  describe('buildRequest - Type Coercion', () => {
    it('should coerce numeric values to strings in query params', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'count', key: 'count', type: 'query', required: true }],
      });

      const result = buildRequest(
        tool,
        { count: 42 },
        { headers: {}, query: {}, cookies: {} },
        'https://api.example.com',
      );
      expect(result.url).toBe('https://api.example.com/test?count=42');
    });

    it('should coerce boolean values to strings in query params', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'active', key: 'active', type: 'query', required: true }],
      });

      const result = buildRequest(
        tool,
        { active: true },
        { headers: {}, query: {}, cookies: {} },
        'https://api.example.com',
      );
      expect(result.url).toBe('https://api.example.com/test?active=true');
    });

    it('should coerce zero to string in path params', () => {
      const tool = createTestTool({
        metadata: { path: '/items/{id}', method: 'get', servers: [{ url: 'https://api.example.com' }] },
        mapper: [{ inputKey: 'id', key: 'id', type: 'path', required: true }],
      });

      const result = buildRequest(tool, { id: 0 }, { headers: {}, query: {}, cookies: {} }, 'https://api.example.com');
      expect(result.url).toBe('https://api.example.com/items/0');
    });

    it('should coerce negative numbers to strings', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'offset', key: 'offset', type: 'query', required: true }],
      });

      const result = buildRequest(
        tool,
        { offset: -10 },
        { headers: {}, query: {}, cookies: {} },
        'https://api.example.com',
      );
      expect(result.url).toBe('https://api.example.com/test?offset=-10');
    });

    it('should coerce float numbers to strings', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'price', key: 'price', type: 'query', required: true }],
      });

      const result = buildRequest(
        tool,
        { price: 19.99 },
        { headers: {}, query: {}, cookies: {} },
        'https://api.example.com',
      );
      expect(result.url).toBe('https://api.example.com/test?price=19.99');
    });
  });

  describe('buildRequest - Header Injection Prevention', () => {
    it('should throw error for CRLF injection in header values', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'custom', key: 'X-Custom', type: 'header', required: true }],
      });

      const maliciousValue = 'value\r\nSet-Cookie: admin=true';
      expect(() => {
        buildRequest(
          tool,
          { custom: maliciousValue },
          { headers: {}, query: {}, cookies: {} },
          'https://api.example.com',
        );
      }).toThrow(/contains control characters/);
    });

    it('should throw error for newline in header values', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'custom', key: 'X-Custom', type: 'header', required: true }],
      });

      const maliciousValue = 'value\nInjected-Header: bad';
      expect(() => {
        buildRequest(
          tool,
          { custom: maliciousValue },
          { headers: {}, query: {}, cookies: {} },
          'https://api.example.com',
        );
      }).toThrow(/contains control characters/);
    });

    it('should accept valid header values', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'custom', key: 'X-Custom', type: 'header', required: true }],
      });

      const result = buildRequest(
        tool,
        { custom: 'valid-value-123' },
        { headers: {}, query: {}, cookies: {} },
        'https://api.example.com',
      );
      expect(result.headers.get('X-Custom')).toBe('valid-value-123');
    });
  });

  describe('buildRequest - Base URL Normalization', () => {
    it('should handle base URL with trailing slash', () => {
      const tool = createTestTool({
        metadata: { path: '/users', method: 'get', servers: [] },
      });

      const result = buildRequest(tool, {}, { headers: {}, query: {}, cookies: {} }, 'https://api.example.com/v1/');
      expect(result.url).toBe('https://api.example.com/v1/users');
    });

    it('should handle base URL with multiple trailing slashes', () => {
      const tool = createTestTool({
        metadata: { path: '/users', method: 'get', servers: [] },
      });

      const result = buildRequest(tool, {}, { headers: {}, query: {}, cookies: {} }, 'https://api.example.com/v1///');
      expect(result.url).toBe('https://api.example.com/v1/users');
    });

    it('should handle base URL with port number', () => {
      const tool = createTestTool({
        metadata: { path: '/users', method: 'get', servers: [] },
      });

      const result = buildRequest(tool, {}, { headers: {}, query: {}, cookies: {} }, 'https://api.example.com:8080');
      expect(result.url).toBe('https://api.example.com:8080/users');
    });
  });

  describe('buildRequest - Array Handling', () => {
    it('should handle empty arrays in query params', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'tags', key: 'tags', type: 'query', required: false }],
      });

      const result = buildRequest(
        tool,
        { tags: [] },
        { headers: {}, query: {}, cookies: {} },
        'https://api.example.com',
      );
      // Empty array becomes empty string
      expect(result.url).toBe('https://api.example.com/test?tags=');
    });

    it('should throw error for arrays in header params', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'custom', key: 'X-Custom', type: 'header', required: true }],
      });

      expect(() => {
        buildRequest(tool, { custom: ['a', 'b'] }, { headers: {}, query: {}, cookies: {} }, 'https://api.example.com');
      }).toThrow(/cannot be an array/);
    });

    it('should throw error for arrays in cookie params', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'session', key: 'session', type: 'cookie', required: true }],
      });

      expect(() => {
        buildRequest(tool, { session: ['a', 'b'] }, { headers: {}, query: {}, cookies: {} }, 'https://api.example.com');
      }).toThrow(/cannot be an array/);
    });
  });

  describe('buildRequest - Path Parameters', () => {
    it('should replace all occurrences of duplicate path parameters', () => {
      const tool: McpOpenAPITool = {
        name: 'compareUsers',
        description: 'Compare users',
        inputSchema: { type: 'object', properties: {} },
        mapper: [{ inputKey: 'id', key: 'id', type: 'path', required: true }],
        metadata: {
          path: '/users/{id}/compare/{id}',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const input = { id: '123' };
      const security = { headers: {}, query: {}, cookies: {} };

      const result = buildRequest(tool, input, security, 'https://api.example.com');

      expect(result.url).toBe('https://api.example.com/users/123/compare/123');
    });

    it('should properly encode special characters in path parameters', () => {
      const tool: McpOpenAPITool = {
        name: 'getUser',
        description: 'Get user',
        inputSchema: { type: 'object', properties: {} },
        mapper: [{ inputKey: 'name', key: 'name', type: 'path', required: true }],
        metadata: {
          path: '/users/{name}',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const input = { name: 'John Doe/Admin' };
      const security = { headers: {}, query: {}, cookies: {} };

      const result = buildRequest(tool, input, security, 'https://api.example.com');

      expect(result.url).toBe('https://api.example.com/users/John%20Doe%2FAdmin');
    });
  });

  describe('buildRequest - Query Parameters', () => {
    it('should handle array values in query parameters', () => {
      const tool: McpOpenAPITool = {
        name: 'searchUsers',
        description: 'Search users',
        inputSchema: { type: 'object', properties: {} },
        mapper: [{ inputKey: 'tags', key: 'tags', type: 'query', required: false }],
        metadata: {
          path: '/users',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const input = { tags: ['admin', 'user', 'guest'] };
      const security = { headers: {}, query: {}, cookies: {} };

      const result = buildRequest(tool, input, security, 'https://api.example.com');

      expect(result.url).toBe('https://api.example.com/users?tags=admin%2Cuser%2Cguest');
    });

    it('should throw error for object values in path parameters', () => {
      const tool: McpOpenAPITool = {
        name: 'getUser',
        description: 'Get user',
        inputSchema: { type: 'object', properties: {} },
        mapper: [{ inputKey: 'id', key: 'id', type: 'path', required: true }],
        metadata: {
          path: '/users/{id}',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const input = { id: { nested: 'value' } };
      const security = { headers: {}, query: {}, cookies: {} };

      expect(() => {
        buildRequest(tool, input, security, 'https://api.example.com');
      }).toThrow(/path parameter.*cannot be an object/);
    });
  });

  describe('buildRequest - Cookie Parameters', () => {
    it('should properly merge multiple cookies', () => {
      const tool: McpOpenAPITool = {
        name: 'getData',
        description: 'Get data',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          { inputKey: 'session', key: 'session_id', type: 'cookie', required: true },
          { inputKey: 'csrf', key: 'csrf_token', type: 'cookie', required: true },
        ],
        metadata: {
          path: '/data',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const input = { session: 'abc123', csrf: 'xyz789' };
      const security = { headers: {}, query: {}, cookies: {} };

      const result = buildRequest(tool, input, security, 'https://api.example.com');

      expect(result.headers.get('Cookie')).toBe('session_id=abc123; csrf_token=xyz789');
    });

    it('should throw error for invalid cookie names', () => {
      const tool: McpOpenAPITool = {
        name: 'getData',
        description: 'Get data',
        inputSchema: { type: 'object', properties: {} },
        mapper: [{ inputKey: 'data', key: 'invalid name', type: 'cookie', required: true }],
        metadata: {
          path: '/data',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const input = { data: 'value' };
      const security = { headers: {}, query: {}, cookies: {} };

      expect(() => {
        buildRequest(tool, input, security, 'https://api.example.com');
      }).toThrow(/Invalid cookie name/);
    });
  });

  describe('validateBaseUrl', () => {
    it('should accept valid HTTP URLs', () => {
      const result = validateBaseUrl('http://api.example.com');
      expect(result.href).toBe('http://api.example.com/');
    });

    it('should accept valid HTTPS URLs', () => {
      const result = validateBaseUrl('https://api.example.com/v1');
      expect(result.href).toBe('https://api.example.com/v1');
    });

    it('should reject invalid URLs', () => {
      expect(() => validateBaseUrl('not-a-url')).toThrow(/Invalid base URL/);
    });

    it('should reject unsupported protocols', () => {
      expect(() => validateBaseUrl('ftp://files.example.com')).toThrow(/Unsupported protocol/);
    });
  });

  describe('parseResponse - Response Size', () => {
    it('should throw error when response exceeds size limit', async () => {
      const largeText = 'x'.repeat(1000);
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve(largeText),
      } as Response;

      await expect(parseResponse(response, { maxResponseSize: 100 })).rejects.toThrow(/Response size.*exceeds maximum/);
    });

    it('should accept responses within size limit', async () => {
      const text = 'Hello World';
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve(text),
      } as Response;

      const result = await parseResponse(response, { maxResponseSize: 1000 });
      expect(result.data).toBe(text);
    });
  });

  describe('parseResponse - Content-Type Case Sensitivity', () => {
    it('should handle uppercase Content-Type', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'APPLICATION/JSON' }),
        text: () => Promise.resolve('{"key": "value"}'),
      } as Response;

      const result = await parseResponse(response);
      expect(result.data).toEqual({ key: 'value' });
    });

    it('should handle mixed case Content-Type', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'Application/Json; charset=utf-8' }),
        text: () => Promise.resolve('{"key": "value"}'),
      } as Response;

      const result = await parseResponse(response);
      expect(result.data).toEqual({ key: 'value' });
    });
  });

  describe('parseResponse - Error Messages', () => {
    it('should not expose response body or statusText in error messages', async () => {
      const sensitiveBody = '{"error": "Secret API key invalid: sk_live_123456"}';
      const response = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized: Invalid API key abc123', // statusText could contain sensitive info
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(sensitiveBody),
      } as Response;

      // Error should only contain status code, not statusText (which could leak secrets)
      await expect(parseResponse(response)).rejects.toThrow(/API request failed: 401/);

      try {
        await parseResponse(response);
      } catch (err) {
        const errorMessage = (err as Error).message;
        // Ensure error message doesn't contain the sensitive body
        expect(errorMessage).not.toContain('sk_live_123456');
        // Ensure error message doesn't contain sensitive statusText
        expect(errorMessage).not.toContain('abc123');
        expect(errorMessage).not.toContain('Unauthorized');
      }
    });
  });

  describe('parseResponse - Content-Length Header', () => {
    it('should reject response when Content-Length exceeds limit', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'content-length': '100000000', // 100MB
        }),
        text: () => Promise.resolve('{"data": "test"}'),
      } as Response;

      await expect(parseResponse(response, { maxResponseSize: 1000 })).rejects.toThrow(
        /Response size.*exceeds maximum/,
      );
    });

    it('should accept response when Content-Length is within limit', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'content-length': '100',
        }),
        text: () => Promise.resolve('{"data": "test"}'),
      } as Response;

      const result = await parseResponse(response, { maxResponseSize: 1000 });
      expect(result.data).toEqual({ data: 'test' });
    });
  });

  describe('parseResponse - Various HTTP Status Codes', () => {
    it('should throw error for 400 Bad Request', async () => {
      const response = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"error": "Invalid input"}'),
      } as Response;

      await expect(parseResponse(response)).rejects.toThrow(/API request failed: 400/);
    });

    it('should throw error for 403 Forbidden', async () => {
      const response = {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"error": "Access denied"}'),
      } as Response;

      await expect(parseResponse(response)).rejects.toThrow(/API request failed: 403/);
    });

    it('should throw error for 429 Rate Limited', async () => {
      const response = {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"error": "Rate limit exceeded"}'),
      } as Response;

      await expect(parseResponse(response)).rejects.toThrow(/API request failed: 429/);
    });

    it('should throw error for 502 Bad Gateway', async () => {
      const response = {
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: () => Promise.resolve('<html>Bad Gateway</html>'),
      } as Response;

      await expect(parseResponse(response)).rejects.toThrow(/API request failed: 502/);
    });

    it('should throw error for 503 Service Unavailable', async () => {
      const response = {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('Service is down'),
      } as Response;

      await expect(parseResponse(response)).rejects.toThrow(/API request failed: 503/);
    });
  });

  describe('parseResponse - Empty Response Handling', () => {
    it('should handle empty response body', async () => {
      const response = {
        ok: true,
        status: 204,
        headers: new Headers({}),
        text: () => Promise.resolve(''),
      } as Response;

      const result = await parseResponse(response);
      expect(result.data).toBe('');
    });

    it('should handle JSON response with empty object', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      } as Response;

      const result = await parseResponse(response);
      expect(result.data).toEqual({});
    });

    it('should handle JSON response with empty array', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('[]'),
      } as Response;

      const result = await parseResponse(response);
      expect(result.data).toEqual([]);
    });
  });

  describe('validateBaseUrl - Extended', () => {
    it('should handle localhost URLs', () => {
      const result = validateBaseUrl('http://localhost:3000');
      expect(result.href).toBe('http://localhost:3000/');
    });

    it('should handle 127.0.0.1 URLs', () => {
      const result = validateBaseUrl('http://127.0.0.1:8080/api');
      expect(result.href).toBe('http://127.0.0.1:8080/api');
    });

    it('should handle URLs with path segments', () => {
      const result = validateBaseUrl('https://api.example.com/v1/api');
      expect(result.href).toBe('https://api.example.com/v1/api');
    });

    it('should reject file:// protocol', () => {
      expect(() => validateBaseUrl('file:///etc/passwd')).toThrow(/Unsupported protocol/);
    });

    it('should reject javascript: protocol', () => {
      expect(() => validateBaseUrl('javascript:alert(1)')).toThrow(/Unsupported protocol|Invalid base URL/);
    });

    it('should reject data: protocol', () => {
      expect(() => validateBaseUrl('data:text/html,<script>alert(1)</script>')).toThrow(/Unsupported protocol/);
    });
  });

  describe('parseResponse - Content-Length Integer Overflow Protection', () => {
    it('should reject extremely large Content-Length values', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'content-length': '9999999999999999999999999999', // Very large number
        }),
        text: () => Promise.resolve('{"data": "test"}'),
      } as Response;

      // Large Content-Length should trigger rejection before reading body
      await expect(parseResponse(response, { maxResponseSize: 1000 })).rejects.toThrow(
        /Response size.*exceeds maximum/,
      );
    });

    it('should handle NaN Content-Length gracefully', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'content-length': 'not-a-number',
        }),
        text: () => Promise.resolve('{"data": "test"}'),
      } as Response;

      // Should not throw on NaN - should fall through to actual size check
      const result = await parseResponse(response, { maxResponseSize: 1000 });
      expect(result.data).toEqual({ data: 'test' });
    });

    it('should check actual byte size even when Content-Length is missing', async () => {
      const largeText = 'x'.repeat(2000);
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve(largeText),
      } as Response;

      await expect(parseResponse(response, { maxResponseSize: 1000 })).rejects.toThrow(
        /Response size.*exceeds maximum/,
      );
    });
  });

  describe('buildRequest - Header Injection Extended Control Characters', () => {
    it('should throw error for null byte in header values', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'custom', key: 'X-Custom', type: 'header', required: true }],
      });

      const maliciousValue = 'value\x00injected';
      expect(() => {
        buildRequest(
          tool,
          { custom: maliciousValue },
          { headers: {}, query: {}, cookies: {} },
          'https://api.example.com',
        );
      }).toThrow(/contains control characters/);
    });

    it('should throw error for form feed in header values', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'custom', key: 'X-Custom', type: 'header', required: true }],
      });

      const maliciousValue = 'value\finjected';
      expect(() => {
        buildRequest(
          tool,
          { custom: maliciousValue },
          { headers: {}, query: {}, cookies: {} },
          'https://api.example.com',
        );
      }).toThrow(/contains control characters/);
    });

    it('should throw error for vertical tab in header values', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'custom', key: 'X-Custom', type: 'header', required: true }],
      });

      const maliciousValue = 'value\vinjected';
      expect(() => {
        buildRequest(
          tool,
          { custom: maliciousValue },
          { headers: {}, query: {}, cookies: {} },
          'https://api.example.com',
        );
      }).toThrow(/contains control characters/);
    });
  });

  describe('buildRequest - Unknown Mapper Type Handling', () => {
    it('should throw error for unknown mapper type', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'data', key: 'data', type: 'unknown_type' as any, required: true }],
      });

      expect(() => {
        buildRequest(tool, { data: 'value' }, { headers: {}, query: {}, cookies: {} }, 'https://api.example.com');
      }).toThrow(/Unknown mapper type 'unknown_type'/);
    });

    it('should throw error for empty mapper type', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'data', key: 'data', type: '' as any, required: true }],
      });

      expect(() => {
        buildRequest(tool, { data: 'value' }, { headers: {}, query: {}, cookies: {} }, 'https://api.example.com');
      }).toThrow(/Unknown mapper type/);
    });
  });

  describe('buildRequest - Query Parameter Collision Detection', () => {
    it('should throw error when user input collides with security query param', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'api_key', key: 'api_key', type: 'query', required: true }],
      });

      // Security provides the same query param
      const security = { headers: {}, query: { api_key: 'security-key' }, cookies: {} };

      expect(() => {
        buildRequest(tool, { api_key: 'user-key' }, security, 'https://api.example.com');
      }).toThrow(/Query parameter collision.*'api_key'/);
    });

    it('should include tool name in collision error message', () => {
      const tool = createTestTool({
        name: 'getUser',
        mapper: [{ inputKey: 'token', key: 'token', type: 'query', required: true }],
      });

      const security = { headers: {}, query: { token: 'security-token' }, cookies: {} };

      expect(() => {
        buildRequest(tool, { token: 'user-token' }, security, 'https://api.example.com');
      }).toThrow(/operation 'getUser'/);
    });

    it('should not throw when query params do not collide', () => {
      const tool = createTestTool({
        mapper: [{ inputKey: 'filter', key: 'filter', type: 'query', required: true }],
      });

      const security = { headers: {}, query: { api_key: 'security-key' }, cookies: {} };

      const result = buildRequest(tool, { filter: 'active' }, security, 'https://api.example.com');
      expect(result.url).toContain('filter=active');
      expect(result.url).toContain('api_key=security-key');
    });
  });

  describe('buildRequest - Server URL from OpenAPI Spec Validation (SSRF)', () => {
    it('should reject file:// protocol in OpenAPI spec server URL', () => {
      const tool: McpOpenAPITool = {
        name: 'maliciousTool',
        description: 'Malicious tool',
        inputSchema: { type: 'object', properties: {} },
        mapper: [],
        metadata: {
          path: '/etc/passwd',
          method: 'get',
          servers: [{ url: 'file:///' }], // SSRF attempt
        },
      };

      expect(() => {
        buildRequest(tool, {}, { headers: {}, query: {}, cookies: {} }, 'https://api.example.com');
      }).toThrow(/Unsupported protocol/);
    });

    it('should use validated server URL from OpenAPI spec over baseUrl', () => {
      const tool: McpOpenAPITool = {
        name: 'testTool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
        mapper: [],
        metadata: {
          path: '/users',
          method: 'get',
          servers: [{ url: 'https://specific-api.example.com' }],
        },
      };

      const result = buildRequest(tool, {}, { headers: {}, query: {}, cookies: {} }, 'https://default-api.example.com');
      expect(result.url).toBe('https://specific-api.example.com/users');
    });

    it('should fall back to baseUrl when no servers specified', () => {
      const tool: McpOpenAPITool = {
        name: 'testTool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
        mapper: [],
        metadata: {
          path: '/users',
          method: 'get',
          servers: [], // Empty servers array
        },
      };

      const result = buildRequest(tool, {}, { headers: {}, query: {}, cookies: {} }, 'https://default-api.example.com');
      expect(result.url).toBe('https://default-api.example.com/users');
    });
  });
});
