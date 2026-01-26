/**
 * Connect Utilities Tests
 */

import type { FrontMcpConfigInput } from '../../common';
import type { DirectClient } from '../client.types';

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => ({
  randomUUID: jest.fn(() => 'mock-uuid-1234'),
}));

// Mock the entire front-mcp module
const mockScopes = [
  {
    tools: {
      hasAny: () => true,
      getCapabilities: () => ({ tools: { listChanged: true } }),
    },
    resources: {
      hasAny: () => false,
      getCapabilities: () => ({}),
    },
    prompts: {
      hasAny: () => false,
      getCapabilities: () => ({}),
    },
    agents: {
      hasAny: () => false,
      getCapabilities: () => ({}),
    },
    apps: {
      getApps: () => [],
    },
    notifications: {
      registerServer: jest.fn(),
      unregisterServer: jest.fn(),
    },
    metadata: {
      info: { name: 'test-server', version: '1.0.0' },
    },
  },
];

const mockFrontMcpInstance = {
  ready: Promise.resolve(),
  getScopes: () => mockScopes,
};

jest.mock('../../front-mcp/front-mcp', () => ({
  FrontMcpInstance: {
    createForGraph: jest.fn().mockResolvedValue(mockFrontMcpInstance),
  },
}));

// Mock the in-memory server
const mockClientTransport = {
  start: jest.fn(),
  close: jest.fn(),
};

const mockClose = jest.fn().mockResolvedValue(undefined);

jest.mock('../../transport/in-memory-server', () => ({
  createInMemoryServer: jest.fn().mockResolvedValue({
    clientTransport: mockClientTransport,
    setAuthInfo: jest.fn(),
    close: mockClose,
  }),
}));

// Mock MCP SDK Client
const mockMcpClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  getServerVersion: jest.fn().mockReturnValue({ name: 'test-server', version: '1.0.0' }),
  getServerCapabilities: jest.fn().mockReturnValue({ tools: { listChanged: true } }),
  listTools: jest.fn().mockResolvedValue({ tools: [] }),
  callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
  readResource: jest.fn().mockResolvedValue({ contents: [] }),
  listResourceTemplates: jest.fn().mockResolvedValue({ resourceTemplates: [] }),
  listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
  getPrompt: jest.fn().mockResolvedValue({ messages: [] }),
};

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => mockMcpClient),
}));

describe('connect utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to create a fresh config for each test
  const createTestConfig = (): FrontMcpConfigInput => ({
    info: { name: 'test-server', version: '1.0.0' },
    apps: [],
  });

  describe('connect', () => {
    it('should create a DirectClient', async () => {
      const { connect } = await import('../connect');
      const config = createTestConfig();

      const client = await connect(config);

      expect(client).toBeDefined();
      expect(client.getSessionId).toBeDefined();
      expect(client.listTools).toBeDefined();
      expect(client.callTool).toBeDefined();
    });

    it('should use default clientInfo when not provided', async () => {
      const { connect } = await import('../connect');
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const config = createTestConfig();

      await connect(config);

      expect(Client).toHaveBeenCalledWith(
        { name: 'mcp-client', version: '1.0.0' },
        undefined, // No capabilities when not provided
      );
    });

    it('should pass custom clientInfo to MCP client', async () => {
      const { connect } = await import('../connect');
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const config = createTestConfig();

      await connect(config, {
        clientInfo: { name: 'custom-agent', version: '2.0.0' },
      });

      expect(Client).toHaveBeenCalledWith({ name: 'custom-agent', version: '2.0.0' }, undefined);
    });

    it('should pass authToken to in-memory server', async () => {
      const { connect } = await import('../connect');
      const { createInMemoryServer } = await import('../../transport/in-memory-server');
      const config = createTestConfig();

      await connect(config, {
        authToken: 'test-jwt-token',
      });

      expect(createInMemoryServer).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          authInfo: expect.objectContaining({
            token: 'test-jwt-token',
          }),
        }),
      );
    });

    it('should pass session user to in-memory server', async () => {
      const { connect } = await import('../connect');
      const { createInMemoryServer } = await import('../../transport/in-memory-server');
      const config = createTestConfig();

      await connect(config, {
        session: {
          id: 'session-123',
          user: { sub: 'user-456', email: 'test@example.com' },
        },
      });

      expect(createInMemoryServer).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sessionId: 'session-123',
          authInfo: expect.objectContaining({
            user: expect.objectContaining({
              iss: 'direct',
              sub: 'user-456',
              email: 'test@example.com',
            }),
          }),
        }),
      );
    });

    it('should generate sessionId when not provided', async () => {
      const { connect } = await import('../connect');
      const { createInMemoryServer } = await import('../../transport/in-memory-server');
      const config = createTestConfig();

      await connect(config);

      expect(createInMemoryServer).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sessionId: expect.stringMatching(/^direct:/),
        }),
      );
    });

    it('should pass capabilities to MCP client', async () => {
      const { connect } = await import('../connect');
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const config = createTestConfig();

      await connect(config, {
        capabilities: { tools: { listChanged: true } },
      });

      expect(Client).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          capabilities: { tools: { listChanged: true } },
        }),
      );
    });
  });

  describe('connectOpenAI', () => {
    it('should use OpenAI client info', async () => {
      const { connectOpenAI } = await import('../connect');
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const config = createTestConfig();

      await connectOpenAI(config);

      expect(Client).toHaveBeenCalledWith({ name: 'openai', version: '1.0.0' }, undefined);
    });

    it('should pass options through', async () => {
      const { connectOpenAI } = await import('../connect');
      const { createInMemoryServer } = await import('../../transport/in-memory-server');
      const config = createTestConfig();

      await connectOpenAI(config, {
        authToken: 'openai-token',
        session: { id: 'openai-session' },
      });

      expect(createInMemoryServer).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sessionId: 'openai-session',
          authInfo: expect.objectContaining({
            token: 'openai-token',
          }),
        }),
      );
    });
  });

  describe('connectClaude', () => {
    it('should use Claude client info', async () => {
      const { connectClaude } = await import('../connect');
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const config = createTestConfig();

      await connectClaude(config);

      expect(Client).toHaveBeenCalledWith({ name: 'claude', version: '1.0.0' }, undefined);
    });
  });

  describe('connectLangChain', () => {
    it('should use LangChain client info', async () => {
      const { connectLangChain } = await import('../connect');
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const config = createTestConfig();

      await connectLangChain(config);

      expect(Client).toHaveBeenCalledWith({ name: 'langchain', version: '1.0.0' }, undefined);
    });
  });

  describe('connectVercelAI', () => {
    it('should use Vercel AI client info', async () => {
      const { connectVercelAI } = await import('../connect');
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const config = createTestConfig();

      await connectVercelAI(config);

      expect(Client).toHaveBeenCalledWith({ name: 'vercel-ai', version: '1.0.0' }, undefined);
    });
  });

  describe('DirectClient interface', () => {
    let client: DirectClient;

    beforeEach(async () => {
      const { connect } = await import('../connect');
      const config = createTestConfig();
      client = await connect(config);
    });

    it('should return session ID', () => {
      const sessionId = client.getSessionId();
      expect(sessionId).toMatch(/^direct:/);
    });

    it('should return client info', () => {
      const clientInfo = client.getClientInfo();
      expect(clientInfo).toEqual({ name: 'mcp-client', version: '1.0.0' });
    });

    it('should return server info', () => {
      const serverInfo = client.getServerInfo();
      expect(serverInfo).toEqual({ name: 'test-server', version: '1.0.0' });
    });

    it('should return capabilities', () => {
      const capabilities = client.getCapabilities();
      expect(capabilities).toEqual({ tools: { listChanged: true } });
    });

    it('should return detected platform', () => {
      const platform = client.getDetectedPlatform();
      expect(platform).toBe('raw');
    });

    it('should list tools', async () => {
      const tools = await client.listTools();
      expect(tools).toEqual([]);
    });

    it('should call tool', async () => {
      const result = await client.callTool('test-tool', { arg: 'value' });
      expect(mockMcpClient.callTool).toHaveBeenCalledWith({
        name: 'test-tool',
        arguments: { arg: 'value' },
      });
      expect(result).toBeDefined();
    });

    it('should call tool with empty args when not provided', async () => {
      await client.callTool('test-tool');
      expect(mockMcpClient.callTool).toHaveBeenCalledWith({
        name: 'test-tool',
        arguments: {},
      });
    });

    it('should list resources', async () => {
      const resources = await client.listResources();
      expect(resources).toEqual({ resources: [] });
    });

    it('should read resource', async () => {
      await client.readResource('file://test.txt');
      expect(mockMcpClient.readResource).toHaveBeenCalledWith({ uri: 'file://test.txt' });
    });

    it('should list resource templates', async () => {
      const templates = await client.listResourceTemplates();
      expect(templates).toEqual({ resourceTemplates: [] });
    });

    it('should list prompts', async () => {
      const prompts = await client.listPrompts();
      expect(prompts).toEqual({ prompts: [] });
    });

    it('should get prompt', async () => {
      await client.getPrompt('test-prompt', { arg: 'value' });
      expect(mockMcpClient.getPrompt).toHaveBeenCalledWith({
        name: 'test-prompt',
        arguments: { arg: 'value' },
      });
    });

    it('should close client', async () => {
      await client.close();
      expect(mockMcpClient.close).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('platform formatting', () => {
    it('should format tools for OpenAI', async () => {
      // Mock tools response
      mockMcpClient.listTools.mockResolvedValueOnce({
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });

      const { connectOpenAI } = await import('../connect');
      const config = createTestConfig();
      const client = await connectOpenAI(config);

      const tools = (await client.listTools()) as Array<{ type: string; function: unknown }>;

      expect(tools[0]).toHaveProperty('type', 'function');
      expect(tools[0]).toHaveProperty('function');
    });

    it('should format tools for Claude', async () => {
      mockMcpClient.listTools.mockResolvedValueOnce({
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });

      const { connectClaude } = await import('../connect');
      const config = createTestConfig();
      const client = await connectClaude(config);

      const tools = (await client.listTools()) as Array<{ name: string; input_schema: unknown }>;

      expect(tools[0]).toHaveProperty('name', 'test_tool');
      expect(tools[0]).toHaveProperty('input_schema');
    });
  });
});
