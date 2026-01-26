/**
 * DirectClientImpl Tests
 */

import { DirectClientImpl } from '../direct-client';
import type { Scope } from '../../scope/scope.instance';

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => ({
  randomUUID: jest.fn(() => 'mock-uuid-1234'),
}));

// Mock client transport
const mockClientTransport = {
  start: jest.fn(),
  close: jest.fn(),
};

const mockServerClose = jest.fn().mockResolvedValue(undefined);

// Mock createInMemoryServer
jest.mock('../../transport/in-memory-server', () => ({
  createInMemoryServer: jest.fn().mockResolvedValue({
    clientTransport: mockClientTransport,
    setAuthInfo: jest.fn(),
    close: mockServerClose,
  }),
}));

// Mock MCP SDK Client
const mockMcpClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  getServerVersion: jest.fn().mockReturnValue({ name: 'test-server', version: '1.0.0' }),
  getServerCapabilities: jest.fn().mockReturnValue({ tools: { listChanged: true } }),
  listTools: jest.fn().mockResolvedValue({
    tools: [
      {
        name: 'get_weather',
        description: 'Get weather',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }),
  callTool: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"temperature": 72}' }],
  }),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
  readResource: jest.fn().mockResolvedValue({ contents: [] }),
  listResourceTemplates: jest.fn().mockResolvedValue({ resourceTemplates: [] }),
  listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
  getPrompt: jest.fn().mockResolvedValue({ messages: [] }),
};

const MockClient = jest.fn().mockImplementation(() => mockMcpClient);

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}));

describe('DirectClientImpl', () => {
  // Minimal mock scope
  const createMockScope = (): Partial<Scope> => ({
    tools: {
      hasAny: () => true,
      getCapabilities: () => ({ tools: { listChanged: true } }),
    } as Scope['tools'],
    resources: {
      hasAny: () => false,
      getCapabilities: () => ({}),
    } as Scope['resources'],
    prompts: {
      hasAny: () => false,
      getCapabilities: () => ({}),
    } as Scope['prompts'],
    agents: {
      hasAny: () => false,
      getCapabilities: () => ({}),
    } as Scope['agents'],
    apps: {
      getApps: () => [],
    } as unknown as Scope['apps'],
    notifications: {
      registerServer: jest.fn(),
      unregisterServer: jest.fn(),
    } as unknown as Scope['notifications'],
    metadata: {
      info: { name: 'test-server', version: '1.0.0' },
    } as Scope['metadata'],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    MockClient.mockClear();
    mockMcpClient.listTools.mockResolvedValue({
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });
    mockMcpClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: '{"temperature": 72}' }],
    });
    mockMcpClient.getServerVersion.mockReturnValue({ name: 'test-server', version: '1.0.0' });
    mockMcpClient.getServerCapabilities.mockReturnValue({ tools: { listChanged: true } });
  });

  describe('create', () => {
    it('should create a DirectClient instance', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope);

      expect(client).toBeDefined();
      expect(MockClient).toHaveBeenCalled();
      expect(mockMcpClient.connect).toHaveBeenCalledWith(mockClientTransport);
    });

    it('should use default clientInfo when not provided', async () => {
      const mockScope = createMockScope();
      await DirectClientImpl.create(mockScope as Scope);

      expect(MockClient).toHaveBeenCalledWith({ name: 'mcp-client', version: '1.0.0' }, undefined);
    });

    it('should use custom clientInfo when provided', async () => {
      const mockScope = createMockScope();
      await DirectClientImpl.create(mockScope as Scope, {
        clientInfo: { name: 'custom-agent', version: '2.0.0' },
      });

      expect(MockClient).toHaveBeenCalledWith({ name: 'custom-agent', version: '2.0.0' }, undefined);
    });

    it('should generate session ID when not provided', async () => {
      const mockScope = createMockScope();
      const { createInMemoryServer } = await import('../../transport/in-memory-server');

      await DirectClientImpl.create(mockScope as Scope);

      expect(createInMemoryServer).toHaveBeenCalledWith(
        mockScope,
        expect.objectContaining({
          sessionId: 'direct:mock-uuid-1234',
        }),
      );
    });

    it('should use provided session ID', async () => {
      const mockScope = createMockScope();
      const { createInMemoryServer } = await import('../../transport/in-memory-server');

      await DirectClientImpl.create(mockScope as Scope, {
        session: { id: 'custom-session-id' },
      });

      expect(createInMemoryServer).toHaveBeenCalledWith(
        mockScope,
        expect.objectContaining({
          sessionId: 'custom-session-id',
        }),
      );
    });

    it('should pass authToken to in-memory server', async () => {
      const mockScope = createMockScope();
      const { createInMemoryServer } = await import('../../transport/in-memory-server');

      await DirectClientImpl.create(mockScope as Scope, {
        authToken: 'test-token',
      });

      expect(createInMemoryServer).toHaveBeenCalledWith(
        mockScope,
        expect.objectContaining({
          authInfo: expect.objectContaining({
            token: 'test-token',
          }),
        }),
      );
    });

    it('should build user auth info correctly', async () => {
      const mockScope = createMockScope();
      const { createInMemoryServer } = await import('../../transport/in-memory-server');

      await DirectClientImpl.create(mockScope as Scope, {
        session: {
          user: {
            sub: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
          },
        },
      });

      expect(createInMemoryServer).toHaveBeenCalledWith(
        mockScope,
        expect.objectContaining({
          authInfo: expect.objectContaining({
            user: {
              iss: 'direct',
              sub: 'user-123',
              email: 'test@example.com',
              name: 'Test User',
            },
          }),
        }),
      );
    });

    it('should use default sub when not provided in user', async () => {
      const mockScope = createMockScope();
      const { createInMemoryServer } = await import('../../transport/in-memory-server');

      await DirectClientImpl.create(mockScope as Scope, {
        session: {
          user: { email: 'test@example.com' },
        },
      });

      expect(createInMemoryServer).toHaveBeenCalledWith(
        mockScope,
        expect.objectContaining({
          authInfo: expect.objectContaining({
            user: expect.objectContaining({
              iss: 'direct',
              sub: 'direct',
            }),
          }),
        }),
      );
    });

    it('should pass capabilities to MCP client', async () => {
      const mockScope = createMockScope();

      await DirectClientImpl.create(mockScope as Scope, {
        capabilities: { tools: { listChanged: true } },
      });

      expect(MockClient).toHaveBeenCalledWith(expect.anything(), {
        capabilities: { tools: { listChanged: true } },
      });
    });

    it('should throw if server version is not available', async () => {
      mockMcpClient.getServerVersion.mockReturnValueOnce(undefined);
      const mockScope = createMockScope();

      await expect(DirectClientImpl.create(mockScope as Scope)).rejects.toThrow(
        'Failed to get server info from MCP handshake',
      );
    });

    it('should throw if server capabilities are not available', async () => {
      mockMcpClient.getServerCapabilities.mockReturnValueOnce(undefined);
      const mockScope = createMockScope();

      await expect(DirectClientImpl.create(mockScope as Scope)).rejects.toThrow(
        'Failed to get server capabilities from MCP handshake',
      );
    });
  });

  describe('info methods', () => {
    let client: Awaited<ReturnType<typeof DirectClientImpl.create>>;

    beforeEach(async () => {
      const mockScope = createMockScope();
      client = await DirectClientImpl.create(mockScope as Scope);
    });

    it('getSessionId should return session ID', () => {
      expect(client.getSessionId()).toBe('direct:mock-uuid-1234');
    });

    it('getClientInfo should return client info', () => {
      expect(client.getClientInfo()).toEqual({ name: 'mcp-client', version: '1.0.0' });
    });

    it('getServerInfo should return server info', () => {
      expect(client.getServerInfo()).toEqual({ name: 'test-server', version: '1.0.0' });
    });

    it('getCapabilities should return server capabilities', () => {
      expect(client.getCapabilities()).toEqual({ tools: { listChanged: true } });
    });

    it('getDetectedPlatform should return detected platform', () => {
      expect(client.getDetectedPlatform()).toBe('raw');
    });
  });

  describe('platform detection', () => {
    it('should detect OpenAI platform', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope, {
        clientInfo: { name: 'openai-agent', version: '1.0.0' },
      });

      expect(client.getDetectedPlatform()).toBe('openai');
    });

    it('should detect Claude platform', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope, {
        clientInfo: { name: 'claude', version: '1.0.0' },
      });

      expect(client.getDetectedPlatform()).toBe('claude');
    });

    it('should detect LangChain platform', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope, {
        clientInfo: { name: 'langchain', version: '1.0.0' },
      });

      expect(client.getDetectedPlatform()).toBe('langchain');
    });

    it('should detect Vercel AI platform', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope, {
        clientInfo: { name: 'vercel-ai', version: '1.0.0' },
      });

      expect(client.getDetectedPlatform()).toBe('vercel-ai');
    });
  });

  describe('listTools', () => {
    it('should format tools for detected platform', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope, {
        clientInfo: { name: 'openai', version: '1.0.0' },
      });

      const tools = (await client.listTools()) as Array<{ type: string; function: { name: string } }>;

      expect(tools[0]).toHaveProperty('type', 'function');
      expect(tools[0]).toHaveProperty('function');
      expect(tools[0].function.name).toBe('get_weather');
    });

    it('should return raw format for raw platform', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope);

      const tools = await client.listTools();

      // Raw format is the MCP tools array directly
      expect(Array.isArray(tools)).toBe(true);
      expect(tools[0]).toHaveProperty('name', 'get_weather');
    });
  });

  describe('callTool', () => {
    it('should call MCP client with correct arguments', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope);

      await client.callTool('test_tool', { arg1: 'value1' });

      expect(mockMcpClient.callTool).toHaveBeenCalledWith({
        name: 'test_tool',
        arguments: { arg1: 'value1' },
      });
    });

    it('should use empty object when no args provided', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope);

      await client.callTool('test_tool');

      expect(mockMcpClient.callTool).toHaveBeenCalledWith({
        name: 'test_tool',
        arguments: {},
      });
    });

    it('should format result for OpenAI platform', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope, {
        clientInfo: { name: 'openai', version: '1.0.0' },
      });

      const result = await client.callTool('test_tool');

      // OpenAI format parses JSON
      expect(result).toEqual({ temperature: 72 });
    });

    it('should format result for Claude platform', async () => {
      mockMcpClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello' }],
      });

      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope, {
        clientInfo: { name: 'claude', version: '1.0.0' },
      });

      const result = await client.callTool('test_tool');

      // Claude format returns content array
      expect(result).toEqual([{ type: 'text', text: 'Hello' }]);
    });
  });

  describe('resource operations', () => {
    let client: Awaited<ReturnType<typeof DirectClientImpl.create>>;

    beforeEach(async () => {
      const mockScope = createMockScope();
      client = await DirectClientImpl.create(mockScope as Scope);
    });

    it('listResources should call MCP client', async () => {
      await client.listResources();
      expect(mockMcpClient.listResources).toHaveBeenCalled();
    });

    it('readResource should call MCP client with uri', async () => {
      await client.readResource('file://test.txt');
      expect(mockMcpClient.readResource).toHaveBeenCalledWith({ uri: 'file://test.txt' });
    });

    it('listResourceTemplates should call MCP client', async () => {
      await client.listResourceTemplates();
      expect(mockMcpClient.listResourceTemplates).toHaveBeenCalled();
    });
  });

  describe('prompt operations', () => {
    let client: Awaited<ReturnType<typeof DirectClientImpl.create>>;

    beforeEach(async () => {
      const mockScope = createMockScope();
      client = await DirectClientImpl.create(mockScope as Scope);
    });

    it('listPrompts should call MCP client', async () => {
      await client.listPrompts();
      expect(mockMcpClient.listPrompts).toHaveBeenCalled();
    });

    it('getPrompt should call MCP client with name and args', async () => {
      await client.getPrompt('test-prompt', { arg: 'value' });
      expect(mockMcpClient.getPrompt).toHaveBeenCalledWith({
        name: 'test-prompt',
        arguments: { arg: 'value' },
      });
    });

    it('getPrompt should handle undefined args', async () => {
      await client.getPrompt('test-prompt');
      expect(mockMcpClient.getPrompt).toHaveBeenCalledWith({
        name: 'test-prompt',
        arguments: undefined,
      });
    });
  });

  describe('close', () => {
    it('should close MCP client and server', async () => {
      const mockScope = createMockScope();
      const client = await DirectClientImpl.create(mockScope as Scope);

      await client.close();

      expect(mockMcpClient.close).toHaveBeenCalled();
      expect(mockServerClose).toHaveBeenCalled();
    });
  });
});
