/// <reference types="jest" />
/**
 * Test fixtures and mocks for OpenAPI adapter tests
 */

import type { OpenAPIV3 } from 'openapi-types';
/**
 * Basic OpenAPI spec without security
 */
export const basicOpenApiSpec: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'Test API',
    version: '1.0.0',
  },
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        summary: 'Get user by ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
        summary: 'Create a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                },
                required: ['name', 'email'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    email: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * OpenAPI spec with Bearer authentication
 */
export const bearerAuthSpec: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'Authenticated API',
    version: '1.0.0',
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/protected': {
      get: {
        operationId: 'getProtected',
        summary: 'Get protected resource',
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * OpenAPI spec with multiple security schemes
 */
export const multiAuthSpec: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'Multi-Auth API',
    version: '1.0.0',
  },
  components: {
    securitySchemes: {
      GitHubAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'GitHub OAuth token',
      },
      SlackAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Slack OAuth token',
      },
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    },
  },
  paths: {
    '/github/repos': {
      get: {
        operationId: 'github_getRepos',
        summary: 'Get GitHub repos',
        security: [{ GitHubAuth: [] }],
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/slack/messages': {
      post: {
        operationId: 'slack_postMessage',
        summary: 'Post Slack message',
        security: [{ SlackAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  channel: { type: 'string' },
                  text: { type: 'string' },
                },
                required: ['channel', 'text'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Success',
          },
        },
      },
    },
    '/admin/settings': {
      get: {
        operationId: 'admin_getSettings',
        summary: 'Get admin settings',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'Success',
          },
        },
      },
    },
  },
};

/**
 * Mock AuthInfo for testing
 */
export const mockAuthInfo = {
  token: 'mock-jwt-token',
  user: {
    id: 'user-123',
    email: 'test@example.com',
    githubToken: 'github-token-123',
    slackToken: 'slack-token-456',
    apiKey: 'api-key-789',
  },
};

/**
 * Mock context for tool execution
 */
export const mockContext = {
  authInfo: mockAuthInfo,
};

/**
 * Mock fetch responses
 */
export const mockFetchSuccess = (data: unknown) => {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  } as Response);
};

export const mockFetchError = (status: number, message: string) => {
  return Promise.resolve({
    ok: false,
    status,
    statusText: message,
    headers: new Headers({ 'content-type': 'text/plain' }),
    text: () => Promise.resolve(message),
  } as Response);
};

/**
 * Spy on console methods for testing logs
 */
export const spyOnConsole = () => {
  const consoleSpy = {
    log: jest.spyOn(console, 'log').mockImplementation(),
    error: jest.spyOn(console, 'error').mockImplementation(),
    warn: jest.spyOn(console, 'warn').mockImplementation(),
  };

  return {
    ...consoleSpy,
    restore: () => {
      consoleSpy.log.mockRestore();
      consoleSpy.error.mockRestore();
      consoleSpy.warn.mockRestore();
    },
  };
};

/**
 * Mock logger for testing - creates a fresh mock for each test
 * Always use this factory function instead of a singleton to prevent test pollution
 */
export const createMockLogger = () => ({
  verbose: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
});

export const mockLogger = createMockLogger();
