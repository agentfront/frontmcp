/**
 * Unit tests for OpenAPI security functions
 *
 * These tests mock SecurityResolver to test createSecurityContextFromAuth
 * in isolation. For end-to-end security flow tests (including actual
 * Authorization header generation), see openapi-security-integration.spec.ts
 */

import {
  createSecurityContextFromAuth,
  validateSecurityConfiguration,
  extractSecuritySchemes,
  resolveToolSecurity,
} from '../openapi.security';
import type { McpOpenAPITool } from 'mcp-from-openapi';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { FrontMcpContext } from '@frontmcp/sdk';

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

describe('OpenapiAdapter - Security Unit Tests', () => {
  const mockAuthInfo: AuthInfo = {
    token: 'test-token',
    clientId: 'test-client',
    scopes: [],
  };

  // Helper to create a mock FrontMcpContext with given authInfo
  const createMockContext = (authInfo: Partial<AuthInfo>): FrontMcpContext => {
    return {
      authInfo,
      requestId: 'test-request-id',
      sessionId: 'test-session-id',
      scopeId: 'test-scope',
    } as FrontMcpContext;
  };

  const createMockTool = (scheme: string): McpOpenAPITool => ({
    name: 'testTool',
    description: 'Test tool',
    inputSchema: { type: 'object', properties: {} },
    mapper: [
      {
        inputKey: 'auth',
        type: 'header',
        key: 'Authorization',
        required: true,
        security: {
          scheme,
          type: 'http',
          httpScheme: 'bearer',
        },
      },
    ],
    metadata: {
      path: '/test',
      method: 'get',
      servers: [{ url: 'https://api.example.com' }],
    },
  });

  describe('createSecurityContextFromAuth - authProviderMapper validation', () => {
    it('should throw error when authProviderMapper returns a number', async () => {
      const tool = createMockTool('BearerAuth');

      await expect(
        createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
          authProviderMapper: {
            BearerAuth: () => 12345 as any, // Returns number instead of string
          },
        }),
      ).rejects.toThrow(/authProviderMapper\['BearerAuth'\] must return a string or undefined.*returned: number/);
    });

    it('should throw error when authProviderMapper returns an object', async () => {
      const tool = createMockTool('BearerAuth');

      await expect(
        createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
          authProviderMapper: {
            BearerAuth: () => ({ token: 'abc' } as any), // Returns object instead of string
          },
        }),
      ).rejects.toThrow(/authProviderMapper\['BearerAuth'\] must return a string or undefined.*returned: object/);
    });

    it('should throw error when authProviderMapper returns an array', async () => {
      const tool = createMockTool('BearerAuth');

      await expect(
        createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
          authProviderMapper: {
            BearerAuth: () => ['token1', 'token2'] as any, // Returns array instead of string
          },
        }),
      ).rejects.toThrow(/authProviderMapper\['BearerAuth'\] must return a string or undefined.*returned: object/);
    });

    it('should throw error when authProviderMapper returns a boolean', async () => {
      const tool = createMockTool('BearerAuth');

      await expect(
        createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
          authProviderMapper: {
            BearerAuth: () => true as any, // Returns boolean instead of string
          },
        }),
      ).rejects.toThrow(/authProviderMapper\['BearerAuth'\] must return a string or undefined.*returned: boolean/);
    });

    it('should throw descriptive error when authProviderMapper throws an exception', async () => {
      const tool = createMockTool('BearerAuth');

      await expect(
        createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
          authProviderMapper: {
            BearerAuth: () => {
              throw new Error('Custom auth extraction failed');
            },
          },
        }),
      ).rejects.toThrow(/authProviderMapper\['BearerAuth'\] threw an error: Custom auth extraction failed/);
    });

    it('should wrap non-Error throws from authProviderMapper', async () => {
      const tool = createMockTool('BearerAuth');

      await expect(
        createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
          authProviderMapper: {
            BearerAuth: () => {
              throw 'string error'; // Throwing a non-Error
            },
          },
        }),
      ).rejects.toThrow(/authProviderMapper\['BearerAuth'\] threw an error: string error/);
    });

    it('should accept valid string return from authProviderMapper', async () => {
      const tool = createMockTool('BearerAuth');

      const result = await createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
        authProviderMapper: {
          BearerAuth: () => 'valid-token-string',
        },
      });

      expect(result.jwt).toBe('valid-token-string');
    });

    it('should accept undefined return from authProviderMapper and fall back to authInfo.token', async () => {
      const tool = createMockTool('BearerAuth');

      // Should not throw - undefined is allowed
      const result = await createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
        authProviderMapper: {
          BearerAuth: () => undefined,
        },
      });

      // Falls back to authInfo.token when mapper returns undefined
      expect(result.jwt).toBe('test-token');
    });

    it('should accept null return from authProviderMapper and fall back to authInfo.token', async () => {
      const tool = createMockTool('BearerAuth');

      // Should not throw - null is allowed
      const result = await createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
        authProviderMapper: {
          BearerAuth: () => null as any,
        },
      });

      // Falls back to authInfo.token when mapper returns null
      expect(result.jwt).toBe('test-token');
    });

    it('should fall back to authInfo.token when mapper returns undefined', async () => {
      const tool = createMockTool('BearerAuth');

      const result = await createSecurityContextFromAuth(
        tool,
        createMockContext({ ...mockAuthInfo, token: 'fallback-token' }),
        {
          authProviderMapper: {
            BearerAuth: () => undefined,
          },
        },
      );

      expect(result.jwt).toBe('fallback-token');
    });

    it('should use first matching token from multiple mappers', async () => {
      const tool: McpOpenAPITool = {
        name: 'testTool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'auth1',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: { scheme: 'Scheme1', type: 'http', httpScheme: 'bearer' },
          },
          {
            inputKey: 'auth2',
            type: 'header',
            key: 'X-API-Key',
            required: true,
            security: { scheme: 'Scheme2', type: 'apiKey' },
          },
        ],
        metadata: {
          path: '/test',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const result = await createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
        authProviderMapper: {
          Scheme1: () => 'token-from-scheme1',
          Scheme2: () => 'token-from-scheme2',
        },
      });

      // First token wins
      expect(result.jwt).toBe('token-from-scheme1');
    });
  });

  describe('createSecurityContextFromAuth - priority order', () => {
    it('should use custom securityResolver when provided (highest priority)', async () => {
      const tool = createMockTool('BearerAuth');
      const customResolver = jest.fn().mockResolvedValue({ jwt: 'custom-token' });
      const ctx = createMockContext(mockAuthInfo);

      const result = await createSecurityContextFromAuth(tool, ctx, {
        securityResolver: customResolver,
        authProviderMapper: { BearerAuth: () => 'mapper-token' },
        staticAuth: { jwt: 'static-token' },
      });

      expect(customResolver).toHaveBeenCalledWith(tool, ctx);
      expect(result).toEqual({ jwt: 'custom-token' });
    });

    it('should use staticAuth when no securityResolver and no authProviderMapper', async () => {
      const { createSecurityContext } = require('mcp-from-openapi');
      const tool = createMockTool('BearerAuth');

      await createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
        staticAuth: { jwt: 'static-token' },
      });

      expect(createSecurityContext).toHaveBeenCalledWith({ jwt: 'static-token' });
    });

    it('should use default authInfo.token when no configuration provided', async () => {
      const { createSecurityContext } = require('mcp-from-openapi');
      const tool = createMockTool('BearerAuth');

      await createSecurityContextFromAuth(tool, createMockContext({ ...mockAuthInfo, token: 'default-token' }), {});

      expect(createSecurityContext).toHaveBeenCalledWith({ jwt: 'default-token' });
    });
  });

  describe('createSecurityContextFromAuth - empty string token rejection', () => {
    it('should throw error when authProviderMapper returns empty string', async () => {
      const tool = createMockTool('BearerAuth');

      await expect(
        createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
          authProviderMapper: {
            BearerAuth: () => '', // Returns empty string
          },
        }),
      ).rejects.toThrow(/authProviderMapper\['BearerAuth'\] returned empty string/);
    });

    it('should include helpful message about returning undefined instead', async () => {
      const tool = createMockTool('BearerAuth');

      await expect(
        createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
          authProviderMapper: {
            BearerAuth: () => '',
          },
        }),
      ).rejects.toThrow(/Return undefined\/null if no token is available/);
    });
  });

  describe('createSecurityContextFromAuth - auth type routing', () => {
    it('should route apiKey scheme to context.apiKey field', async () => {
      const tool: McpOpenAPITool = {
        name: 'testTool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'apiKey',
            type: 'header',
            key: 'X-API-Key',
            required: true,
            security: { scheme: 'ApiKeyAuth', type: 'apiKey' },
          },
        ],
        metadata: {
          path: '/test',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const result = await createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
        authProviderMapper: {
          ApiKeyAuth: () => 'my-api-key',
        },
      });

      expect(result.apiKey).toBe('my-api-key');
      expect(result.jwt).toBeUndefined();
    });

    it('should route http basic scheme to context.basic field', async () => {
      const tool: McpOpenAPITool = {
        name: 'testTool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'auth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: { scheme: 'BasicAuth', type: 'http', httpScheme: 'basic' },
          },
        ],
        metadata: {
          path: '/test',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const result = await createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
        authProviderMapper: {
          BasicAuth: () => 'dXNlcjpwYXNz', // base64 encoded user:pass
        },
      });

      expect(result.basic).toBe('dXNlcjpwYXNz');
      expect(result.jwt).toBeUndefined();
    });

    it('should route oauth2 scheme to context.oauth2Token field', async () => {
      const tool: McpOpenAPITool = {
        name: 'testTool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'auth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: { scheme: 'OAuth2Auth', type: 'oauth2' },
          },
        ],
        metadata: {
          path: '/test',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const result = await createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
        authProviderMapper: {
          OAuth2Auth: () => 'oauth2-access-token',
        },
      });

      expect(result.oauth2Token).toBe('oauth2-access-token');
      expect(result.jwt).toBeUndefined();
    });

    it('should route http bearer scheme to context.jwt field', async () => {
      const tool = createMockTool('BearerAuth'); // Uses http bearer by default

      const result = await createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
        authProviderMapper: {
          BearerAuth: () => 'bearer-jwt-token',
        },
      });

      expect(result.jwt).toBe('bearer-jwt-token');
    });

    it('should handle multiple auth types routing each to correct field', async () => {
      const tool: McpOpenAPITool = {
        name: 'testTool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'jwt',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: { scheme: 'BearerAuth', type: 'http', httpScheme: 'bearer' },
          },
          {
            inputKey: 'apiKey',
            type: 'header',
            key: 'X-API-Key',
            required: true,
            security: { scheme: 'ApiKeyAuth', type: 'apiKey' },
          },
        ],
        metadata: {
          path: '/test',
          method: 'get',
          servers: [{ url: 'https://api.example.com' }],
        },
      };

      const result = await createSecurityContextFromAuth(tool, createMockContext(mockAuthInfo), {
        authProviderMapper: {
          BearerAuth: () => 'my-jwt',
          ApiKeyAuth: () => 'my-api-key',
        },
      });

      expect(result.jwt).toBe('my-jwt');
      expect(result.apiKey).toBe('my-api-key');
    });
  });

  describe('createSecurityContextFromAuth - authInfo.token type validation', () => {
    it('should throw error when authInfo.token is not a string', async () => {
      const tool = createMockTool('BearerAuth');
      const invalidAuthInfo = {
        ...mockAuthInfo,
        token: { nested: 'object' } as any, // Invalid token type
      };

      await expect(
        createSecurityContextFromAuth(tool, createMockContext(invalidAuthInfo), {
          authProviderMapper: {
            BearerAuth: () => undefined, // Returns undefined to trigger fallback
          },
        }),
      ).rejects.toThrow(/authInfo\.token must be a string.*got: object/);
    });

    it('should throw error when authInfo.token is a number', async () => {
      const tool = createMockTool('BearerAuth');
      const invalidAuthInfo = {
        ...mockAuthInfo,
        token: 12345 as any, // Invalid token type
      };

      await expect(
        createSecurityContextFromAuth(tool, createMockContext(invalidAuthInfo), {
          authProviderMapper: {
            BearerAuth: () => undefined,
          },
        }),
      ).rejects.toThrow(/authInfo\.token must be a string.*got: number/);
    });

    it('should accept valid string authInfo.token', async () => {
      const tool = createMockTool('BearerAuth');

      const result = await createSecurityContextFromAuth(
        tool,
        createMockContext({ ...mockAuthInfo, token: 'valid-fallback-token' }),
        {
          authProviderMapper: {
            BearerAuth: () => undefined, // Returns undefined to trigger fallback
          },
        },
      );

      expect(result.jwt).toBe('valid-fallback-token');
    });
  });
});

describe('validateSecurityConfiguration', () => {
  const createMockToolWithSecurity = (scheme: string): McpOpenAPITool => ({
    name: 'testTool',
    description: 'Test tool',
    inputSchema: { type: 'object', properties: {} },
    mapper: [
      {
        inputKey: 'auth',
        type: 'header',
        key: 'Authorization',
        required: true,
        security: {
          scheme,
          type: 'http',
          httpScheme: 'bearer',
        },
      },
    ],
    metadata: {
      path: '/test',
      method: 'get',
      servers: [{ url: 'https://api.example.com' }],
    },
  });

  describe('includeSecurityInInput handling', () => {
    it('should return HIGH risk when includeSecurityInInput is true', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        generateOptions: { includeSecurityInInput: true },
      });

      expect(result.securityRiskScore).toBe('high');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(expect.stringContaining('includeSecurityInInput is enabled'));
    });

    it('should skip mapping validation when includeSecurityInInput is true', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        generateOptions: { includeSecurityInInput: true },
        // No authProviderMapper provided - would normally be invalid
      });

      // Should be valid despite missing mapping
      expect(result.valid).toBe(true);
      expect(result.missingMappings).toHaveLength(0);
    });
  });

  describe('securityResolver handling', () => {
    it('should return LOW risk when securityResolver is provided', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];
      const customResolver = jest.fn().mockResolvedValue({});

      const result = validateSecurityConfiguration(tools, {
        securityResolver: customResolver,
      });

      expect(result.securityRiskScore).toBe('low');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(expect.stringContaining('Using custom securityResolver'));
    });

    it('should skip mapping validation when securityResolver is provided', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];
      const customResolver = jest.fn().mockResolvedValue({});

      const result = validateSecurityConfiguration(tools, {
        securityResolver: customResolver,
        // No authProviderMapper provided
      });

      expect(result.valid).toBe(true);
      expect(result.missingMappings).toHaveLength(0);
    });
  });

  describe('staticAuth handling', () => {
    it('should return MEDIUM risk when staticAuth is provided', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        staticAuth: { jwt: 'static-token' },
      });

      expect(result.securityRiskScore).toBe('medium');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(expect.stringContaining('Using staticAuth with hardcoded credentials'));
    });

    it('should skip mapping validation when staticAuth is provided', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        staticAuth: { jwt: 'static-token' },
        // No authProviderMapper provided
      });

      expect(result.valid).toBe(true);
      expect(result.missingMappings).toHaveLength(0);
    });

    it('should not use staticAuth when it is an empty object', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        staticAuth: {}, // Empty - should be ignored
        authProviderMapper: { BearerAuth: () => 'token' },
      });

      // Should fall through to authProviderMapper
      expect(result.securityRiskScore).toBe('low');
    });
  });

  describe('authProviderMapper handling', () => {
    it('should return LOW risk with authProviderMapper', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        authProviderMapper: { BearerAuth: () => 'token' },
      });

      expect(result.securityRiskScore).toBe('low');
      expect(result.valid).toBe(true);
    });

    it('should detect missing auth provider mappings', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        authProviderMapper: { OtherAuth: () => 'token' }, // Wrong scheme
      });

      expect(result.valid).toBe(false);
      expect(result.missingMappings).toContain('BearerAuth');
    });
  });

  describe('securitySchemesInInput handling', () => {
    it('should return MEDIUM risk when schemes are provided via input', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        securitySchemesInInput: ['BearerAuth'],
      });

      expect(result.securityRiskScore).toBe('medium');
      expect(result.valid).toBe(true);
    });
  });

  describe('priority order', () => {
    it('should check includeSecurityInInput before securityResolver', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        generateOptions: { includeSecurityInInput: true },
        securityResolver: jest.fn(),
        staticAuth: { jwt: 'token' },
      });

      // includeSecurityInInput takes precedence
      expect(result.securityRiskScore).toBe('high');
    });

    it('should check securityResolver before staticAuth', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        securityResolver: jest.fn(),
        staticAuth: { jwt: 'token' },
      });

      // securityResolver takes precedence
      expect(result.securityRiskScore).toBe('low');
      expect(result.warnings).toContainEqual(expect.stringContaining('Using custom securityResolver'));
    });

    it('should check staticAuth before authProviderMapper', () => {
      const tools = [createMockToolWithSecurity('BearerAuth')];

      const result = validateSecurityConfiguration(tools, {
        staticAuth: { jwt: 'token' },
        authProviderMapper: { BearerAuth: () => 'mapper-token' },
      });

      // staticAuth takes precedence
      expect(result.securityRiskScore).toBe('medium');
      expect(result.warnings).toContainEqual(expect.stringContaining('Using staticAuth'));
    });
  });
});

describe('extractSecuritySchemes', () => {
  it('should extract security schemes from tools', () => {
    const tools: McpOpenAPITool[] = [
      {
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'auth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: { scheme: 'BearerAuth', type: 'http' },
          },
        ],
        metadata: { path: '/test', method: 'get', servers: [] },
      },
      {
        name: 'tool2',
        description: 'Tool 2',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'apiKey',
            type: 'header',
            key: 'X-API-Key',
            required: true,
            security: { scheme: 'ApiKeyAuth', type: 'apiKey' },
          },
        ],
        metadata: { path: '/test2', method: 'post', servers: [] },
      },
    ];

    const schemes = extractSecuritySchemes(tools);

    expect(schemes.has('BearerAuth')).toBe(true);
    expect(schemes.has('ApiKeyAuth')).toBe(true);
    expect(schemes.size).toBe(2);
  });

  it('should handle tools without security mappers', () => {
    const tools: McpOpenAPITool[] = [
      {
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'param',
            type: 'query',
            key: 'param',
            required: false,
          },
        ],
        metadata: { path: '/test', method: 'get', servers: [] },
      },
    ];

    const schemes = extractSecuritySchemes(tools);

    expect(schemes.size).toBe(0);
  });

  it('should deduplicate schemes from multiple tools', () => {
    const tools: McpOpenAPITool[] = [
      {
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'auth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: { scheme: 'BearerAuth', type: 'http' },
          },
        ],
        metadata: { path: '/test', method: 'get', servers: [] },
      },
      {
        name: 'tool2',
        description: 'Tool 2',
        inputSchema: { type: 'object', properties: {} },
        mapper: [
          {
            inputKey: 'auth',
            type: 'header',
            key: 'Authorization',
            required: true,
            security: { scheme: 'BearerAuth', type: 'http' }, // Same scheme
          },
        ],
        metadata: { path: '/test2', method: 'post', servers: [] },
      },
    ];

    const schemes = extractSecuritySchemes(tools);

    expect(schemes.size).toBe(1);
    expect(schemes.has('BearerAuth')).toBe(true);
  });
});

describe('resolveToolSecurity', () => {
  const mockAuthInfo: AuthInfo = {
    token: 'test-token',
    clientId: 'test-client',
    scopes: [],
  };

  const createMockContext = (authInfo: Partial<AuthInfo>): FrontMcpContext => {
    return {
      authInfo,
      requestId: 'test-request-id',
      sessionId: 'test-session-id',
      scopeId: 'test-scope',
    } as FrontMcpContext;
  };

  const createMockToolWithRequiredSecurity = (scheme: string): McpOpenAPITool => ({
    name: 'testTool',
    description: 'Test tool',
    inputSchema: { type: 'object', properties: {} },
    mapper: [
      {
        inputKey: 'auth',
        type: 'header',
        key: 'Authorization',
        required: true,
        security: { scheme, type: 'http', httpScheme: 'bearer' },
      },
    ],
    metadata: {
      path: '/test',
      method: 'get',
      servers: [{ url: 'https://api.example.com' }],
    },
  });

  const createMockToolWithOptionalSecurity = (scheme: string): McpOpenAPITool => ({
    name: 'testTool',
    description: 'Test tool',
    inputSchema: { type: 'object', properties: {} },
    mapper: [
      {
        inputKey: 'auth',
        type: 'header',
        key: 'Authorization',
        required: false, // Optional security
        security: { scheme, type: 'http', httpScheme: 'bearer' },
      },
    ],
    metadata: {
      path: '/test',
      method: 'get',
      servers: [{ url: 'https://api.example.com' }],
    },
  });

  it('should resolve security successfully with authProviderMapper', async () => {
    const tool = createMockToolWithRequiredSecurity('BearerAuth');
    const ctx = createMockContext(mockAuthInfo);

    const result = await resolveToolSecurity(tool, ctx, {
      authProviderMapper: { BearerAuth: () => 'valid-token' },
    });

    expect(result).toBeDefined();
  });

  it('should throw error when required security has no auth configured', async () => {
    const tool = createMockToolWithRequiredSecurity('BearerAuth');
    const ctx = createMockContext({}); // No token

    await expect(
      resolveToolSecurity(tool, ctx, {}), // No auth config
    ).rejects.toThrow(/Authentication required for tool/);
  });

  it('should include scheme names in error message', async () => {
    const tool = createMockToolWithRequiredSecurity('BearerAuth');
    const ctx = createMockContext({}); // No token

    await expect(resolveToolSecurity(tool, ctx, {})).rejects.toThrow(/BearerAuth/);
  });

  it('should suggest solutions in error message', async () => {
    const tool = createMockToolWithRequiredSecurity('BearerAuth');
    const ctx = createMockContext({});

    await expect(resolveToolSecurity(tool, ctx, {})).rejects.toThrow(/authProviderMapper/);
  });

  it('should not throw for optional security without auth', async () => {
    const tool = createMockToolWithOptionalSecurity('BearerAuth');
    const ctx = createMockContext({});

    // Should not throw - security is optional
    const result = await resolveToolSecurity(tool, ctx, {});
    expect(result).toBeDefined();
  });

  it('should resolve using staticAuth', async () => {
    const tool = createMockToolWithRequiredSecurity('BearerAuth');
    const ctx = createMockContext({});

    const result = await resolveToolSecurity(tool, ctx, {
      staticAuth: { jwt: 'static-token' },
    });

    expect(result).toBeDefined();
  });

  it('should resolve using securityResolver', async () => {
    const tool = createMockToolWithRequiredSecurity('BearerAuth');
    const ctx = createMockContext({});
    const customResolver = jest.fn().mockResolvedValue({ jwt: 'custom-token' });

    const result = await resolveToolSecurity(tool, ctx, {
      securityResolver: customResolver,
    });

    expect(result).toBeDefined();
    expect(customResolver).toHaveBeenCalledWith(tool, ctx);
  });

  it('should handle tool with no security mappers', async () => {
    const tool: McpOpenAPITool = {
      name: 'testTool',
      description: 'Test tool',
      inputSchema: { type: 'object', properties: {} },
      mapper: [
        {
          inputKey: 'param',
          type: 'query',
          key: 'param',
          required: false,
          // No security
        },
      ],
      metadata: { path: '/test', method: 'get', servers: [] },
    };
    const ctx = createMockContext({});

    // Should not throw - no security required
    const result = await resolveToolSecurity(tool, ctx, {});
    expect(result).toBeDefined();
  });

  it('should handle multiple required security schemes', async () => {
    const tool: McpOpenAPITool = {
      name: 'testTool',
      description: 'Test tool',
      inputSchema: { type: 'object', properties: {} },
      mapper: [
        {
          inputKey: 'auth1',
          type: 'header',
          key: 'Authorization',
          required: true,
          security: { scheme: 'BearerAuth', type: 'http', httpScheme: 'bearer' },
        },
        {
          inputKey: 'auth2',
          type: 'header',
          key: 'X-API-Key',
          required: true,
          security: { scheme: 'ApiKeyAuth', type: 'apiKey' },
        },
      ],
      metadata: { path: '/test', method: 'get', servers: [] },
    };
    const ctx = createMockContext({});

    await expect(resolveToolSecurity(tool, ctx, {})).rejects.toThrow(/BearerAuth.*ApiKeyAuth|ApiKeyAuth.*BearerAuth/);
  });

  it('should pass through with apiKey auth', async () => {
    const tool = createMockToolWithRequiredSecurity('ApiKeyAuth');
    const ctx = createMockContext({});

    const result = await resolveToolSecurity(tool, ctx, {
      authProviderMapper: { ApiKeyAuth: () => 'api-key-value' },
    });

    expect(result).toBeDefined();
  });

  it('should pass through with basic auth', async () => {
    const tool: McpOpenAPITool = {
      name: 'testTool',
      description: 'Test tool',
      inputSchema: { type: 'object', properties: {} },
      mapper: [
        {
          inputKey: 'auth',
          type: 'header',
          key: 'Authorization',
          required: true,
          security: { scheme: 'BasicAuth', type: 'http', httpScheme: 'basic' },
        },
      ],
      metadata: { path: '/test', method: 'get', servers: [] },
    };
    const ctx = createMockContext({});

    const result = await resolveToolSecurity(tool, ctx, {
      authProviderMapper: { BasicAuth: () => 'dXNlcjpwYXNz' },
    });

    expect(result).toBeDefined();
  });

  it('should pass through with oauth2 token', async () => {
    const tool: McpOpenAPITool = {
      name: 'testTool',
      description: 'Test tool',
      inputSchema: { type: 'object', properties: {} },
      mapper: [
        {
          inputKey: 'auth',
          type: 'header',
          key: 'Authorization',
          required: true,
          security: { scheme: 'OAuth2Auth', type: 'oauth2' },
        },
      ],
      metadata: { path: '/test', method: 'get', servers: [] },
    };
    const ctx = createMockContext({});

    const result = await resolveToolSecurity(tool, ctx, {
      authProviderMapper: { OAuth2Auth: () => 'oauth2-token' },
    });

    expect(result).toBeDefined();
  });
});
