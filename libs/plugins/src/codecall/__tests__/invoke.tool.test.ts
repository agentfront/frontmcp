// file: libs/plugins/src/codecall/__tests__/invoke.tool.test.ts

import InvokeTool from '../tools/invoke.tool';
import { isBlockedSelfReference } from '../security/self-reference-guard';
import type { InvokeToolOutput } from '../tools/invoke.schema';

// Helper to create a mock MCP CallToolResult
function createMockMcpResult(data: unknown, isError = false) {
  if (isError) {
    return {
      content: [{ type: 'text', text: data as string }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    isError: false,
  };
}

// Mock the SDK - the mock class accepts any args to match ToolContext constructor
jest.mock('@frontmcp/sdk', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Tool: (config: any) => (target: any) => target,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Provider: (config: any) => (target: any) => target,
  ProviderScope: { GLOBAL: 'global', REQUEST: 'request' },
  ToolContext: class MockToolContext {
    scope = {
      tools: {
        getTools: jest.fn(() => []),
      },
      runFlow: jest.fn(() => Promise.resolve(null)),
    };
    authInfo = undefined;
    logger = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    constructor(_args?: any) {
      // Mock constructor accepts optional args
    }
  },
}));

// Mock json-schema-to-zod-v3
jest.mock('json-schema-to-zod-v3', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  convertJsonSchemaToZod: jest.fn((schema: any) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parse: jest.fn((input: any) => input),
  })),
}));

// Helper to assert error result type
function assertErrorResult(result: InvokeToolOutput): asserts result is Extract<InvokeToolOutput, { status: 'error' }> {
  expect(result.status).toBe('error');
}

describe('InvokeTool', () => {
  describe('Security: Self-Reference Blocking', () => {
    it('should block invocation of codecall:execute', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'codecall:execute',
        input: { script: 'return 1' },
      });

      assertErrorResult(result);
      expect(result.error.type).toBe('permission_denied');
      expect(result.error.message).toContain('cannot be invoked directly');
    });

    it('should block invocation of codecall:search', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'codecall:search',
        input: { query: 'users' },
      });

      assertErrorResult(result);
      expect(result.error.type).toBe('permission_denied');
    });

    it('should block invocation of codecall:describe', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'codecall:describe',
        input: { toolNames: ['users:list'] },
      });

      assertErrorResult(result);
      expect(result.error.type).toBe('permission_denied');
    });

    it('should block invocation of codecall:invoke (self)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'codecall:invoke',
        input: { tool: 'users:list', input: {} },
      });

      assertErrorResult(result);
      expect(result.error.type).toBe('permission_denied');
    });

    it('should block any codecall: prefixed tool', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'codecall:custom-tool',
        input: {},
      });

      assertErrorResult(result);
      expect(result.error.type).toBe('permission_denied');
    });

    it('should block CODECALL: prefix case-insensitively', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'CODECALL:Execute',
        input: {},
      });

      assertErrorResult(result);
      expect(result.error.type).toBe('permission_denied');
    });
  });

  describe('Tool Not Found', () => {
    it('should return error when tool does not exist', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();
      tool.scope = {
        tools: {
          getTools: jest.fn(() => []),
        },
      };

      const result = await tool.execute({
        tool: 'nonexistent:tool',
        input: {},
      });

      assertErrorResult(result);
      expect(result.error.type).toBe('tool_not_found');
      expect(result.error.message).toContain('not found');
      expect(result.error.message).toContain('nonexistent:tool');
    });

    it('should suggest using codecall:search when tool not found', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();
      tool.scope = {
        tools: {
          getTools: jest.fn(() => []),
        },
      };

      const result = await tool.execute({
        tool: 'unknown:tool',
        input: {},
      });

      assertErrorResult(result);
      expect(result.error.message).toContain('codecall:search');
    });
  });

  describe('Input Validation', () => {
    const mockTool = {
      name: 'users:create',
      fullName: 'users:create',
      rawInputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name', 'email'],
      },
    };

    it('should validate input against tool schema', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();
      const mockResult = { id: '123', name: 'Test' };
      tool.scope = {
        tools: {
          getTools: jest.fn(() => [mockTool]),
        },
        runFlow: jest.fn(() => Promise.resolve(createMockMcpResult(mockResult))),
      };

      // Mock successful validation
      const { convertJsonSchemaToZod } = require('json-schema-to-zod-v3');
      convertJsonSchemaToZod.mockReturnValue({
        parse: jest.fn((input) => input),
      });

      const result = await tool.execute({
        tool: 'users:create',
        input: { name: 'Test User', email: 'test@example.com' },
      });

      expect(result.status).toBe('success');
    });

    it('should return validation error for invalid input', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();
      tool.scope = {
        tools: {
          getTools: jest.fn(() => [mockTool]),
        },
      };

      // Mock validation failure
      const { convertJsonSchemaToZod } = require('json-schema-to-zod-v3');
      const { ZodError } = jest.requireActual('zod');
      convertJsonSchemaToZod.mockReturnValue({
        parse: jest.fn(() => {
          const error = new ZodError([
            {
              code: 'invalid_type',
              expected: 'string',
              received: 'undefined',
              path: ['email'],
              message: 'Required',
            },
          ]);
          throw error;
        }),
      });

      const result = await tool.execute({
        tool: 'users:create',
        input: { name: 'Test User' }, // Missing email
      });

      assertErrorResult(result);
      expect(result.error.type).toBe('validation_error');
      expect(result.error.message).toContain('validation failed');
    });
  });

  describe('Successful Invocation', () => {
    it('should return success with tool result', async () => {
      const mockResult = { id: '123', name: 'Test User', email: 'test@example.com' };
      const mockTool = {
        name: 'users:create',
        fullName: 'users:create',
        rawInputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();
      tool.scope = {
        tools: {
          getTools: jest.fn(() => [mockTool]),
        },
        runFlow: jest.fn(() => Promise.resolve(createMockMcpResult(mockResult))),
      };

      // Mock successful validation
      const { convertJsonSchemaToZod } = require('json-schema-to-zod-v3');
      convertJsonSchemaToZod.mockReturnValue({
        parse: jest.fn((input: unknown) => input),
      });

      const result = await tool.execute({
        tool: 'users:create',
        input: { name: 'Test User' },
      });

      expect(result.status).toBe('success');
      expect(result.result).toEqual(mockResult);
    });

    it('should find tool by fullName', async () => {
      const mockTool = {
        name: 'create',
        fullName: 'users:create',
        rawInputSchema: {},
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();
      tool.scope = {
        tools: {
          getTools: jest.fn(() => [mockTool]),
        },
        runFlow: jest.fn(() => Promise.resolve(createMockMcpResult({}))),
      };

      const { convertJsonSchemaToZod } = require('json-schema-to-zod-v3');
      convertJsonSchemaToZod.mockReturnValue({
        parse: jest.fn((input: unknown) => input),
      });

      const result = await tool.execute({
        tool: 'users:create',
        input: {},
      });

      expect(result.status).toBe('success');
    });
  });

  describe('Error Handling', () => {
    it('should return execution error when tool throws', async () => {
      const mockTool = {
        name: 'users:delete',
        fullName: 'users:delete',
        rawInputSchema: {},
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();
      tool.scope = {
        tools: {
          getTools: jest.fn(() => [mockTool]),
        },
        runFlow: jest.fn(() => Promise.reject(new Error('Database connection failed'))),
      };

      const { convertJsonSchemaToZod } = require('json-schema-to-zod-v3');
      convertJsonSchemaToZod.mockReturnValue({
        parse: jest.fn((input: unknown) => input),
      });

      const result = await tool.execute({
        tool: 'users:delete',
        input: { id: '123' },
      });

      assertErrorResult(result);
      expect(result.error.type).toBe('execution_error');
    });

    it('should sanitize error messages to prevent information leakage', async () => {
      const mockTool = {
        name: 'users:delete',
        fullName: 'users:delete',
        rawInputSchema: {},
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();
      tool.scope = {
        tools: {
          getTools: jest.fn(() => [mockTool]),
        },
        runFlow: jest.fn(() =>
          Promise.reject(new Error('Error at /Users/david/project/src/db.ts:42:10 - Database password: secret123')),
        ),
      };

      const { convertJsonSchemaToZod } = require('json-schema-to-zod-v3');
      convertJsonSchemaToZod.mockReturnValue({
        parse: jest.fn((input: unknown) => input),
      });

      const result = await tool.execute({
        tool: 'users:delete',
        input: { id: '123' },
      });

      assertErrorResult(result);
      // Error message should NOT contain sensitive information
      expect(result.error.message).not.toContain('/Users/david');
      expect(result.error.message).not.toContain('secret123');
      expect(result.error.message).not.toContain(':42:10');
    });

    it('should handle non-Error throws gracefully', async () => {
      const mockTool = {
        name: 'users:strange',
        fullName: 'users:strange',
        rawInputSchema: {},
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();
      tool.scope = {
        tools: {
          getTools: jest.fn(() => [mockTool]),
        },
        runFlow: jest.fn(() => Promise.reject('string error')), // eslint-disable-line @typescript-eslint/prefer-promise-reject-errors
      };

      const { convertJsonSchemaToZod } = require('json-schema-to-zod-v3');
      convertJsonSchemaToZod.mockReturnValue({
        parse: jest.fn((input: unknown) => input),
      });

      const result = await tool.execute({
        tool: 'users:strange',
        input: {},
      });

      assertErrorResult(result);
      expect(result.error.type).toBe('execution_error');
    });
  });

  describe('Tool allows no schema (passthrough)', () => {
    it('should allow invocation when tool has no input schema', async () => {
      const mockResult = { status: 'healthy' };
      const mockTool = {
        name: 'health:check',
        fullName: 'health:check',
        rawInputSchema: undefined, // No schema defined
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = new (InvokeTool as any)();
      tool.scope = {
        tools: {
          getTools: jest.fn(() => [mockTool]),
        },
        runFlow: jest.fn(() => Promise.resolve(createMockMcpResult(mockResult))),
      };

      const result = await tool.execute({
        tool: 'health:check',
        input: {},
      });

      expect(result.status).toBe('success');
      expect(result.result).toEqual({ status: 'healthy' });
    });
  });
});

describe('Integration: Self-Reference Guard', () => {
  it('should use the same guard as execute.tool.ts', () => {
    // Verify the guard works correctly
    expect(isBlockedSelfReference('codecall:execute')).toBe(true);
    expect(isBlockedSelfReference('codecall:invoke')).toBe(true);
    expect(isBlockedSelfReference('codecall:search')).toBe(true);
    expect(isBlockedSelfReference('codecall:describe')).toBe(true);

    // Non-codecall tools should be allowed
    expect(isBlockedSelfReference('users:list')).toBe(false);
    expect(isBlockedSelfReference('billing:invoice')).toBe(false);
  });
});
