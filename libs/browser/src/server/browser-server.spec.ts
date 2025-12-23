// file: libs/browser/src/server/browser-server.spec.ts
import { BrowserMcpServer } from './browser-server';
import { createSimpleEmitter, EventTransportAdapter } from '../transport';
import { createMcpStore } from '../store';
import { ComponentRegistry, RendererRegistry } from '../registry';
import { z } from 'zod';

describe('BrowserMcpServer', () => {
  let emitter: ReturnType<typeof createSimpleEmitter>;
  let transport: EventTransportAdapter;
  let server: BrowserMcpServer;

  beforeEach(() => {
    emitter = createSimpleEmitter();
    transport = new EventTransportAdapter(emitter);
  });

  afterEach(() => {
    server?.stop();
  });

  const createServer = (options: Record<string, unknown> = {}) => {
    server = new BrowserMcpServer({
      name: 'test-server',
      version: '1.0.0',
      transport,
      ...options,
    } as ConstructorParameters<typeof BrowserMcpServer>[0]);
    return server;
  };

  describe('constructor', () => {
    it('should create a server with required options', () => {
      const server = createServer();
      expect(server).toBeInstanceOf(BrowserMcpServer);
    });

    it('should create a server with optional store', () => {
      const store = createMcpStore({ initialState: { count: 0 } });
      const server = createServer({ store });
      expect(server.getStore()).toBe(store);
    });

    it('should create a server with optional registries', () => {
      const componentRegistry = new ComponentRegistry();
      const rendererRegistry = new RendererRegistry();
      const server = createServer({ componentRegistry, rendererRegistry });
      expect(server.getComponentRegistry()).toBe(componentRegistry);
      expect(server.getRendererRegistry()).toBe(rendererRegistry);
    });
  });

  describe('addTool', () => {
    it('should add a tool', () => {
      const server = createServer();
      server.addTool({
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        handler: async (args) => ({ result: 'ok' }),
      });

      // Tool should be listable after server starts
      expect(server).toBeDefined();
    });

    it('should throw on duplicate tool registration', () => {
      const server = createServer();
      const tool = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object' as const },
        handler: async () => ({}),
      };

      server.addTool(tool);
      expect(() => server.addTool(tool)).toThrow('Tool "test-tool" is already registered');
    });

    it('should be chainable', () => {
      const server = createServer();
      const result = server.addTool({
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: { type: 'object' },
        handler: async () => ({}),
      });
      expect(result).toBe(server);
    });
  });

  describe('addResource', () => {
    it('should add a resource', () => {
      const server = createServer();
      server.addResource({
        uri: 'test://resource',
        name: 'Test Resource',
        handler: async () => ({ contents: [{ uri: 'test://resource', text: 'content' }] }),
      });

      expect(server).toBeDefined();
    });

    it('should throw on duplicate resource registration', () => {
      const server = createServer();
      const resource = {
        uri: 'test://resource',
        name: 'Test Resource',
        handler: async () => ({ contents: [] }),
      };

      server.addResource(resource);
      expect(() => server.addResource(resource)).toThrow('Resource "test://resource" is already registered');
    });
  });

  describe('addPrompt', () => {
    it('should add a prompt', () => {
      const server = createServer();
      server.addPrompt({
        name: 'test-prompt',
        description: 'A test prompt',
        handler: async () => ({
          messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }],
        }),
      });

      expect(server).toBeDefined();
    });

    it('should throw on duplicate prompt registration', () => {
      const server = createServer();
      const prompt = {
        name: 'test-prompt',
        handler: async () => ({
          messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }],
        }),
      };

      server.addPrompt(prompt);
      expect(() => server.addPrompt(prompt)).toThrow('Prompt "test-prompt" is already registered');
    });
  });

  describe('start/stop', () => {
    it('should start the server', async () => {
      const server = createServer();
      await server.start();
      expect(transport.connectionState).toBe('connected');
    });

    it('should be idempotent on start', async () => {
      const server = createServer();
      await server.start();
      await server.start();
      expect(transport.connectionState).toBe('connected');
    });

    it('should stop the server', async () => {
      const server = createServer();
      await server.start();
      server.stop();
      expect(transport.connectionState).toBe('disconnected');
    });

    it('should be idempotent on stop', async () => {
      const server = createServer();
      await server.start();
      server.stop();
      server.stop();
      expect(transport.connectionState).toBe('disconnected');
    });
  });

  describe('MCP protocol handling', () => {
    const sendRequest = async (method: string, params?: unknown) => {
      // Create client transport
      const clientEmitter = emitter;
      const clientTransport = new EventTransportAdapter(clientEmitter, {
        sendEvent: 'mcp:request',
        receiveEvent: 'mcp:response',
      });
      await clientTransport.connect();

      return new Promise<unknown>((resolve, reject) => {
        const id = Date.now().toString();
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

        clientTransport.onMessage(async (message) => {
          if ('id' in message && message.id === id) {
            clearTimeout(timeout);
            if ('error' in message && message.error) {
              reject(new Error(message.error.message));
            } else if ('result' in message) {
              resolve(message.result);
            }
          }
          return;
        });

        clientTransport.send({
          jsonrpc: '2.0',
          id,
          method,
          params,
        });
      });
    };

    it('should handle initialize request', async () => {
      const server = createServer();
      await server.start();

      const result = await sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      expect(result).toEqual({
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'test-server', version: '1.0.0' },
      });
    });

    it('should handle tools/list request', async () => {
      const server = createServer();
      server.addTool({
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        handler: async () => ({}),
      });
      await server.start();

      const result = (await sendRequest('tools/list')) as { tools: unknown[] };

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toEqual({
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      });
    });

    it('should handle tools/call request', async () => {
      const server = createServer();
      server.addTool({
        name: 'greet',
        description: 'Greet someone',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        handler: async (args) => ({ message: `Hello, ${args['name']}!` }),
      });
      await server.start();

      const result = (await sendRequest('tools/call', {
        name: 'greet',
        arguments: { name: 'World' },
      })) as { content: { type: string; text: string }[] };

      expect(result.content).toHaveLength(1);
      expect(JSON.parse(result.content[0].text)).toEqual({ message: 'Hello, World!' });
    });

    it('should handle tool not found error', async () => {
      const server = createServer();
      await server.start();

      const result = (await sendRequest('tools/call', {
        name: 'nonexistent',
        arguments: {},
      })) as { content: { type: string; text: string }[]; isError?: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Tool not found');
    });

    it('should handle resources/list request', async () => {
      const server = createServer();
      server.addResource({
        uri: 'test://data',
        name: 'Test Data',
        description: 'Some test data',
        mimeType: 'application/json',
        handler: async () => ({ contents: [] }),
      });
      await server.start();

      const result = (await sendRequest('resources/list')) as { resources: unknown[] };

      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toEqual({
        uri: 'test://data',
        name: 'Test Data',
        description: 'Some test data',
        mimeType: 'application/json',
      });
    });

    it('should handle resources/read request', async () => {
      const server = createServer();
      server.addResource({
        uri: 'test://data',
        name: 'Test Data',
        handler: async () => ({
          contents: [{ uri: 'test://data', text: '{"value": 42}', mimeType: 'application/json' }],
        }),
      });
      await server.start();

      const result = (await sendRequest('resources/read', { uri: 'test://data' })) as { contents: unknown[] };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toEqual({
        uri: 'test://data',
        text: '{"value": 42}',
        mimeType: 'application/json',
      });
    });

    it('should handle prompts/list request', async () => {
      const server = createServer();
      server.addPrompt({
        name: 'greeting',
        description: 'A greeting prompt',
        arguments: [{ name: 'name', description: 'Name to greet', required: true }],
        handler: async () => ({
          messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }],
        }),
      });
      await server.start();

      const result = (await sendRequest('prompts/list')) as { prompts: unknown[] };

      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0]).toEqual({
        name: 'greeting',
        description: 'A greeting prompt',
        arguments: [{ name: 'name', description: 'Name to greet', required: true }],
      });
    });

    it('should handle prompts/get request', async () => {
      const server = createServer();
      server.addPrompt({
        name: 'greeting',
        handler: async (args) => ({
          messages: [
            {
              role: 'user' as const,
              content: [{ type: 'text' as const, text: `Hello, ${args['name'] || 'World'}!` }],
            },
          ],
        }),
      });
      await server.start();

      const result = (await sendRequest('prompts/get', {
        name: 'greeting',
        arguments: { name: 'Alice' },
      })) as { messages: unknown[] };

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: 'user',
        content: [{ type: 'text', text: 'Hello, Alice!' }],
      });
    });

    it('should handle ping request', async () => {
      const server = createServer();
      await server.start();

      const result = await sendRequest('ping');
      expect(result).toEqual({});
    });
  });

  describe('integration with store', () => {
    it('should allow tools to access store', async () => {
      const store = createMcpStore({ initialState: { count: 0 } });
      const server = createServer({ store });

      server.addTool({
        name: 'increment',
        description: 'Increment counter',
        inputSchema: { type: 'object' },
        handler: async (_, context) => {
          if (context.store) {
            (context.store.state as { count: number }).count++;
            return { count: (context.store.state as { count: number }).count };
          }
          return { error: 'No store' };
        },
      });

      await server.start();

      expect(store.state.count).toBe(0);

      // Simulate tool call
      const clientEmitter = emitter;
      const clientTransport = new EventTransportAdapter(clientEmitter, {
        sendEvent: 'mcp:request',
        receiveEvent: 'mcp:response',
      });
      await clientTransport.connect();

      await new Promise<void>((resolve) => {
        const id = '1';
        clientTransport.onMessage(async (message) => {
          if ('id' in message && message.id === id) {
            resolve();
          }
          return;
        });
        clientTransport.send({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: 'increment', arguments: {} },
        });
      });

      expect(store.state.count).toBe(1);
    });
  });

  describe('debug mode', () => {
    it('should log when debug is enabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const server = createServer({ debug: true });
      await server.start();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
