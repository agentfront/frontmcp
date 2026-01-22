/**
 * DirectMcpServerImpl tests
 */

import { DirectMcpServerImpl } from '../direct-server';
import { FlowControl } from '../../common';
import { InternalMcpError } from '../../errors';
import type { Scope } from '../../scope/scope.instance';

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => ({
  randomUUID: jest.fn(() => 'mock-uuid-1234'),
  randomBytes: jest.fn(() => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
  bytesToHex: jest.fn(() => 'mock-hex'),
}));

/** Minimal Scope interface required by DirectMcpServerImpl */
type MockScope = Pick<Scope, 'runFlowForOutput' | 'transportService'>;

describe('DirectMcpServerImpl', () => {
  // Mock Scope with type-safe partial
  const createMockScope = (): MockScope => ({
    runFlowForOutput: jest.fn(),
    transportService: {
      destroy: jest.fn().mockResolvedValue(undefined),
    } as unknown as Scope['transportService'],
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with scope', () => {
      const mockScope = createMockScope();
      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);

      expect(server).toBeDefined();
      expect(server.ready).resolves.toBeUndefined();
    });
  });

  describe('listTools', () => {
    it('should call runFlowForOutput with correct flow name', async () => {
      const mockScope = createMockScope();
      const expectedResult = { tools: [{ name: 'test-tool' }] };
      mockScope.runFlowForOutput.mockResolvedValue(expectedResult);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      const result = await server.listTools();

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'tools:list-tools',
        expect.objectContaining({
          request: { method: 'tools/list', params: {} },
        }),
      );
      expect(result).toEqual(expectedResult);
    });

    it('should pass auth context to flow', async () => {
      const mockScope = createMockScope();
      mockScope.runFlowForOutput.mockResolvedValue({ tools: [] });

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      await server.listTools({
        authContext: {
          token: 'test-token',
          user: { sub: 'user-123' },
          sessionId: 'session-123',
        },
      });

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'tools:list-tools',
        expect.objectContaining({
          ctx: expect.objectContaining({
            authInfo: expect.objectContaining({
              token: 'test-token',
              sessionId: 'session-123',
            }),
          }),
        }),
      );
    });
  });

  describe('callTool', () => {
    it('should call runFlowForOutput with tool name and args', async () => {
      const mockScope = createMockScope();
      const expectedResult = { content: [{ type: 'text', text: 'Hello' }] };
      mockScope.runFlowForOutput.mockResolvedValue(expectedResult);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      const result = await server.callTool('test-tool', { arg1: 'value1' });

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'tools:call-tool',
        expect.objectContaining({
          request: {
            method: 'tools/call',
            params: { name: 'test-tool', arguments: { arg1: 'value1' } },
          },
        }),
      );
      expect(result).toEqual(expectedResult);
    });

    it('should use empty args when not provided', async () => {
      const mockScope = createMockScope();
      mockScope.runFlowForOutput.mockResolvedValue({ content: [] });

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      await server.callTool('test-tool');

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'tools:call-tool',
        expect.objectContaining({
          request: {
            method: 'tools/call',
            params: { name: 'test-tool', arguments: {} },
          },
        }),
      );
    });
  });

  describe('listResources', () => {
    it('should call runFlowForOutput with correct flow name', async () => {
      const mockScope = createMockScope();
      const expectedResult = { resources: [{ uri: 'file://test.txt' }] };
      mockScope.runFlowForOutput.mockResolvedValue(expectedResult);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      const result = await server.listResources();

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'resources:list-resources',
        expect.objectContaining({
          request: { method: 'resources/list', params: {} },
        }),
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('listResourceTemplates', () => {
    it('should call runFlowForOutput with correct flow name', async () => {
      const mockScope = createMockScope();
      const expectedResult = { resourceTemplates: [{ uriTemplate: 'file://{path}' }] };
      mockScope.runFlowForOutput.mockResolvedValue(expectedResult);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      const result = await server.listResourceTemplates();

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'resources:list-resource-templates',
        expect.objectContaining({
          request: { method: 'resources/templates/list', params: {} },
        }),
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('readResource', () => {
    it('should call runFlowForOutput with uri', async () => {
      const mockScope = createMockScope();
      const expectedResult = { contents: [{ uri: 'file://test.txt', text: 'content' }] };
      mockScope.runFlowForOutput.mockResolvedValue(expectedResult);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      const result = await server.readResource('file://test.txt');

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'resources:read-resource',
        expect.objectContaining({
          request: { method: 'resources/read', params: { uri: 'file://test.txt' } },
        }),
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('listPrompts', () => {
    it('should call runFlowForOutput with correct flow name', async () => {
      const mockScope = createMockScope();
      const expectedResult = { prompts: [{ name: 'test-prompt' }] };
      mockScope.runFlowForOutput.mockResolvedValue(expectedResult);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      const result = await server.listPrompts();

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'prompts:list-prompts',
        expect.objectContaining({
          request: { method: 'prompts/list', params: {} },
        }),
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getPrompt', () => {
    it('should call runFlowForOutput with prompt name and args', async () => {
      const mockScope = createMockScope();
      const expectedResult = { messages: [{ role: 'user', content: 'Hello' }] };
      mockScope.runFlowForOutput.mockResolvedValue(expectedResult);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      const result = await server.getPrompt('test-prompt', { arg1: 'value1' });

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'prompts:get-prompt',
        expect.objectContaining({
          request: {
            method: 'prompts/get',
            params: { name: 'test-prompt', arguments: { arg1: 'value1' } },
          },
        }),
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('FlowControl handling', () => {
    it('should return output when FlowControl type is respond', async () => {
      const mockScope = createMockScope();
      const flowControl = new FlowControl('respond', { tools: [] });
      mockScope.runFlowForOutput.mockRejectedValue(flowControl);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      const result = await server.listTools();

      expect(result).toEqual({ tools: [] });
    });

    it('should throw InternalMcpError when FlowControl type is fail', async () => {
      const mockScope = createMockScope();
      const flowControl = new FlowControl('fail', { error: 'Something went wrong' });
      mockScope.runFlowForOutput.mockRejectedValue(flowControl);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);

      await expect(server.listTools()).rejects.toThrow(InternalMcpError);
      await expect(server.listTools()).rejects.toThrow('Flow ended with fail');
    });

    it('should throw InternalMcpError when FlowControl type is abort', async () => {
      const mockScope = createMockScope();
      const flowControl = new FlowControl('abort', null);
      mockScope.runFlowForOutput.mockRejectedValue(flowControl);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);

      await expect(server.listTools()).rejects.toThrow(InternalMcpError);
    });

    it('should re-throw non-FlowControl errors', async () => {
      const mockScope = createMockScope();
      const error = new Error('Unexpected error');
      mockScope.runFlowForOutput.mockRejectedValue(error);

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);

      await expect(server.listTools()).rejects.toThrow('Unexpected error');
    });
  });

  describe('dispose', () => {
    it('should call transportService.destroy', async () => {
      const mockScope = createMockScope();
      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);

      await server.dispose();

      expect(mockScope.transportService.destroy).toHaveBeenCalled();
    });

    it('should handle dispose when transportService is undefined', async () => {
      const mockScope = {
        runFlowForOutput: jest.fn(),
        transportService: undefined,
      };
      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);

      await expect(server.dispose()).resolves.not.toThrow();
    });

    it('should not throw if destroy fails', async () => {
      const mockScope = createMockScope();
      mockScope.transportService.destroy.mockRejectedValue(new Error('Cleanup failed'));

      const consoleSpy = jest.spyOn(console, 'debug').mockImplementation();
      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);

      await expect(server.dispose()).resolves.not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should only dispose once', async () => {
      const mockScope = createMockScope();
      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);

      await server.dispose();
      await server.dispose();

      expect(mockScope.transportService.destroy).toHaveBeenCalledTimes(1);
    });

    it('should throw InternalMcpError when calling methods after dispose', async () => {
      const mockScope = createMockScope();
      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);

      await server.dispose();

      await expect(server.listTools()).rejects.toThrow(InternalMcpError);
      await expect(server.listTools()).rejects.toThrow('DirectMcpServer has been disposed');
    });
  });

  describe('buildAuthInfo', () => {
    it('should build auth info with default sessionId when no authContext', async () => {
      const mockScope = createMockScope();
      mockScope.runFlowForOutput.mockResolvedValue({ tools: [] });

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      await server.listTools();

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'tools:list-tools',
        expect.objectContaining({
          ctx: expect.objectContaining({
            authInfo: expect.objectContaining({
              sessionId: expect.stringMatching(/^direct:/),
            }),
          }),
        }),
      );
    });

    it('should build auth info with user claims', async () => {
      const mockScope = createMockScope();
      mockScope.runFlowForOutput.mockResolvedValue({ tools: [] });

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      await server.listTools({
        authContext: {
          user: { sub: 'user-123', email: 'test@example.com' },
        },
      });

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'tools:list-tools',
        expect.objectContaining({
          ctx: expect.objectContaining({
            authInfo: expect.objectContaining({
              user: expect.objectContaining({
                sub: 'user-123',
                email: 'test@example.com',
              }),
            }),
          }),
        }),
      );
    });

    it('should include extra data in auth info', async () => {
      const mockScope = createMockScope();
      mockScope.runFlowForOutput.mockResolvedValue({ tools: [] });

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      await server.listTools({
        authContext: {
          extra: { customField: 'customValue' },
        },
      });

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'tools:list-tools',
        expect.objectContaining({
          ctx: expect.objectContaining({
            authInfo: expect.objectContaining({
              extra: { customField: 'customValue' },
            }),
          }),
        }),
      );
    });

    it('should pass metadata to flow context', async () => {
      const mockScope = createMockScope();
      mockScope.runFlowForOutput.mockResolvedValue({ tools: [] });

      const server = new DirectMcpServerImpl(mockScope as unknown as Scope);
      await server.listTools({
        metadata: { requestId: 'req-123' },
      });

      expect(mockScope.runFlowForOutput).toHaveBeenCalledWith(
        'tools:list-tools',
        expect.objectContaining({
          ctx: expect.objectContaining({
            metadata: { requestId: 'req-123' },
          }),
        }),
      );
    });
  });
});
