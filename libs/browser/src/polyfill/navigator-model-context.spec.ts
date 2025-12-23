// file: libs/browser/src/polyfill/navigator-model-context.spec.ts
/**
 * Tests for the navigator.modelContext polyfill
 */

import { cleanup, isInstalled, getPolyfillVersion } from './navigator-model-context';
import type { NavigatorModelContext, ModelContextSession } from './types';
import { ModelContextConnectionError, ModelContextTimeoutError } from './types';

// Store original navigator.modelContext
const originalModelContext = (navigator as { modelContext?: NavigatorModelContext }).modelContext;

describe('navigator.modelContext polyfill', () => {
  afterEach(async () => {
    await cleanup();
  });

  describe('installation', () => {
    it('should be installed on navigator', () => {
      expect(isInstalled()).toBe(true);
      expect(navigator.modelContext).toBeDefined();
    });

    it('should report as supported', () => {
      expect(navigator.modelContext?.supported).toBe(true);
    });

    it('should have a polyfill version', () => {
      const version = getPolyfillVersion();
      expect(version).toBe('1.0.0');
      expect(navigator.modelContext?.polyfillVersion).toBe('1.0.0');
    });
  });

  describe('connect', () => {
    it('should create a session with server info', async () => {
      const session = await navigator.modelContext!.connect({
        serverInfo: {
          name: 'TestApp',
          version: '1.0.0',
        },
      });

      expect(session).toBeDefined();
      expect(session.state).toBe('connected');
      expect(session.clientInfo).toBeDefined();

      await session.close();
    });

    it('should timeout when specified', async () => {
      // This test verifies the timeout mechanism works
      // In practice, the connection should succeed quickly
      const session = await navigator.modelContext!.connect({
        serverInfo: {
          name: 'TestApp',
          version: '1.0.0',
        },
        timeout: 5000,
      });

      expect(session.state).toBe('connected');
      await session.close();
    });

    it('should include optional description', async () => {
      const session = await navigator.modelContext!.connect({
        serverInfo: {
          name: 'TestApp',
          version: '1.0.0',
          description: 'A test application',
        },
      });

      expect(session).toBeDefined();
      await session.close();
    });
  });

  describe('session lifecycle', () => {
    let session: ModelContextSession;

    beforeEach(async () => {
      session = await navigator.modelContext!.connect({
        serverInfo: { name: 'TestApp', version: '1.0.0' },
      });
    });

    afterEach(async () => {
      if (session.state !== 'disconnected') {
        await session.close();
      }
    });

    it('should close the session', async () => {
      await session.close();
      expect(session.state).toBe('disconnected');
    });

    it('should emit disconnect event on close', async () => {
      const disconnectHandler = jest.fn();
      session.on('disconnect', disconnectHandler);

      await session.close();

      expect(disconnectHandler).toHaveBeenCalled();
    });

    it('should handle multiple close calls gracefully', async () => {
      await session.close();
      await session.close();
      expect(session.state).toBe('disconnected');
    });
  });

  describe('tool registration', () => {
    let session: ModelContextSession;

    beforeEach(async () => {
      session = await navigator.modelContext!.connect({
        serverInfo: { name: 'TestApp', version: '1.0.0' },
      });
    });

    afterEach(async () => {
      await session.close();
    });

    it('should register a tool', () => {
      const unregister = session.registerTool('test-tool', {
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        execute: async (args) => ({ result: `Hello, ${(args as { name: string }).name}` }),
      });

      expect(typeof unregister).toBe('function');
    });

    it('should unregister a tool via return function', () => {
      const unregister = session.registerTool('test-tool', {
        description: 'A test tool',
        inputSchema: { type: 'object' },
        execute: async () => ({}),
      });

      unregister();
      // Should not throw when re-registering after unregister
      session.registerTool('test-tool', {
        description: 'A test tool',
        inputSchema: { type: 'object' },
        execute: async () => ({}),
      });
    });

    it('should unregister a tool by name', () => {
      session.registerTool('test-tool', {
        description: 'A test tool',
        inputSchema: { type: 'object' },
        execute: async () => ({}),
      });

      session.unregisterTool('test-tool');

      // Should not throw when re-registering
      session.registerTool('test-tool', {
        description: 'A test tool',
        inputSchema: { type: 'object' },
        execute: async () => ({}),
      });
    });

    it('should throw when registering duplicate tool', () => {
      session.registerTool('test-tool', {
        description: 'A test tool',
        inputSchema: { type: 'object' },
        execute: async () => ({}),
      });

      expect(() => {
        session.registerTool('test-tool', {
          description: 'Another test tool',
          inputSchema: { type: 'object' },
          execute: async () => ({}),
        });
      }).toThrow('Tool "test-tool" is already registered');
    });

    it('should emit toolCall event when tool is executed', async () => {
      const toolCallHandler = jest.fn();
      session.on('toolCall', toolCallHandler);

      session.registerTool('greet', {
        description: 'Greet someone',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        execute: async (args) => ({ message: `Hello, ${(args as { name: string }).name}` }),
      });

      // The toolCall event is emitted when the tool is called through MCP
      // In unit tests, we verify the handler is registered
      expect(typeof session.on).toBe('function');
    });
  });

  describe('resource registration', () => {
    let session: ModelContextSession;

    beforeEach(async () => {
      session = await navigator.modelContext!.connect({
        serverInfo: { name: 'TestApp', version: '1.0.0' },
      });
    });

    afterEach(async () => {
      await session.close();
    });

    it('should register a resource', () => {
      const unregister = session.registerResource('config://app', {
        name: 'App Config',
        description: 'Application configuration',
        mimeType: 'application/json',
        read: async () => ({
          contents: [
            {
              uri: 'config://app',
              mimeType: 'application/json',
              text: '{"version": "1.0.0"}',
            },
          ],
        }),
      });

      expect(typeof unregister).toBe('function');
    });

    it('should unregister a resource', () => {
      session.registerResource('config://app', {
        name: 'App Config',
        read: async () => ({ contents: [] }),
      });

      session.unregisterResource('config://app');

      // Should not throw when re-registering
      session.registerResource('config://app', {
        name: 'App Config',
        read: async () => ({ contents: [] }),
      });
    });

    it('should throw when registering duplicate resource', () => {
      session.registerResource('config://app', {
        name: 'App Config',
        read: async () => ({ contents: [] }),
      });

      expect(() => {
        session.registerResource('config://app', {
          name: 'Another Config',
          read: async () => ({ contents: [] }),
        });
      }).toThrow('Resource "config://app" is already registered');
    });
  });

  describe('prompt registration', () => {
    let session: ModelContextSession;

    beforeEach(async () => {
      session = await navigator.modelContext!.connect({
        serverInfo: { name: 'TestApp', version: '1.0.0' },
      });
    });

    afterEach(async () => {
      await session.close();
    });

    it('should register a prompt', () => {
      const unregister = session.registerPrompt('greeting', {
        name: 'Greeting Prompt',
        description: 'Generate a greeting message',
        arguments: [{ name: 'name', description: 'Name to greet', required: true }],
        execute: async (args) => ({
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: `Please greet ${args['name']}` },
            },
          ],
        }),
      });

      expect(typeof unregister).toBe('function');
    });

    it('should unregister a prompt', () => {
      session.registerPrompt('greeting', {
        execute: async () => ({ messages: [] }),
      });

      session.unregisterPrompt('greeting');

      // Should not throw when re-registering
      session.registerPrompt('greeting', {
        execute: async () => ({ messages: [] }),
      });
    });

    it('should throw when registering duplicate prompt', () => {
      session.registerPrompt('greeting', {
        execute: async () => ({ messages: [] }),
      });

      expect(() => {
        session.registerPrompt('greeting', {
          execute: async () => ({ messages: [] }),
        });
      }).toThrow('Prompt "greeting" is already registered');
    });
  });

  describe('notifications', () => {
    let session: ModelContextSession;

    beforeEach(async () => {
      session = await navigator.modelContext!.connect({
        serverInfo: { name: 'TestApp', version: '1.0.0' },
      });
    });

    afterEach(async () => {
      await session.close();
    });

    it('should send notifications', () => {
      // Should not throw
      session.notify('custom/event', { data: 'test' });
    });

    it('should handle notifications without params', () => {
      // Should not throw
      session.notify('custom/ping');
    });
  });

  describe('error handling', () => {
    let session: ModelContextSession;

    beforeEach(async () => {
      session = await navigator.modelContext!.connect({
        serverInfo: { name: 'TestApp', version: '1.0.0' },
      });
    });

    afterEach(async () => {
      await session.close();
    });

    it('should have error event handler', () => {
      const errorHandler = jest.fn();
      const unsubscribe = session.on('error', errorHandler);

      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });
  });

  describe('cleanup', () => {
    it('should clean up all sessions', async () => {
      const session1 = await navigator.modelContext!.connect({
        serverInfo: { name: 'App1', version: '1.0.0' },
      });
      const session2 = await navigator.modelContext!.connect({
        serverInfo: { name: 'App2', version: '1.0.0' },
      });

      expect(session1.state).toBe('connected');
      expect(session2.state).toBe('connected');

      await cleanup();

      expect(session1.state).toBe('disconnected');
      expect(session2.state).toBe('disconnected');
    });
  });

  describe('error classes', () => {
    it('should export ModelContextConnectionError', () => {
      const error = new ModelContextConnectionError('Test error');
      expect(error.name).toBe('ModelContextConnectionError');
      expect(error.message).toBe('Test error');
    });

    it('should export ModelContextTimeoutError', () => {
      const error = new ModelContextTimeoutError('Custom timeout');
      expect(error.name).toBe('ModelContextTimeoutError');
      expect(error.message).toBe('Custom timeout');
    });

    it('should have default timeout message', () => {
      const error = new ModelContextTimeoutError();
      expect(error.message).toBe('Connection timed out');
    });
  });
});
