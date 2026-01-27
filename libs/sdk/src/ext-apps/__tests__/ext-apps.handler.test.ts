/**
 * @file ext-apps.handler.test.ts
 * @description Tests for the MCP Apps (ext-apps) message handler.
 */

import {
  ExtAppsMessageHandler,
  createExtAppsMessageHandler,
  ExtAppsMethodNotFoundError,
  ExtAppsInvalidParamsError,
  ExtAppsNotSupportedError,
  type ExtAppsHandlerContext,
} from '../ext-apps.handler';
import { EXT_APPS_ERROR_CODES } from '../ext-apps.types';
import type { ExtAppsJsonRpcRequest } from '../ext-apps.types';

describe('ExtAppsMessageHandler', () => {
  // Mock logger
  const mockLogger = {
    verbose: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  // Base context with required methods
  const createMockContext = (overrides: Partial<ExtAppsHandlerContext> = {}): ExtAppsHandlerContext => ({
    sessionId: 'test-session-123',
    logger: mockLogger as any,
    callTool: jest.fn().mockResolvedValue({ result: 'tool-result' }),
    ...overrides,
  });

  // Helper to create a request
  const createRequest = (method: string, params?: unknown): ExtAppsJsonRpcRequest => ({
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor and factory', () => {
    it('should create handler with default options', () => {
      const context = createMockContext();
      const handler = new ExtAppsMessageHandler({ context });

      expect(handler).toBeInstanceOf(ExtAppsMessageHandler);
      expect(handler.getHostCapabilities()).toEqual({});
    });

    it('should create handler with custom host capabilities', () => {
      const context = createMockContext();
      const handler = new ExtAppsMessageHandler({
        context,
        hostCapabilities: {
          serverToolProxy: true,
          logging: true,
        },
      });

      expect(handler.getHostCapabilities()).toEqual({
        serverToolProxy: true,
        logging: true,
      });
    });

    it('should create handler using factory function', () => {
      const context = createMockContext();
      const handler = createExtAppsMessageHandler({ context });

      expect(handler).toBeInstanceOf(ExtAppsMessageHandler);
    });
  });

  describe('handleRequest', () => {
    describe('ui/callServerTool', () => {
      it('should call tool when serverToolProxy is enabled', async () => {
        const callTool = jest.fn().mockResolvedValue({ data: 'result' });
        const context = createMockContext({ callTool });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { serverToolProxy: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/callServerTool', {
            name: 'get_weather',
            arguments: { location: 'NYC' },
          }),
        );

        expect(response.error).toBeUndefined();
        expect(response.result).toEqual({ data: 'result' });
        expect(callTool).toHaveBeenCalledWith('get_weather', { location: 'NYC' });
      });

      it('should reject when serverToolProxy is not enabled', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { serverToolProxy: false },
        });

        const response = await handler.handleRequest(createRequest('ui/callServerTool', { name: 'get_weather' }));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.NOT_SUPPORTED);
        expect(response.error?.message).toContain('not supported');
      });

      it('should reject when tool name is missing', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { serverToolProxy: true },
        });

        const response = await handler.handleRequest(createRequest('ui/callServerTool', {}));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
      });

      it('should use empty object for arguments when not provided', async () => {
        const callTool = jest.fn().mockResolvedValue({ data: 'result' });
        const context = createMockContext({ callTool });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { serverToolProxy: true },
        });

        await handler.handleRequest(createRequest('ui/callServerTool', { name: 'list_items' }));

        expect(callTool).toHaveBeenCalledWith('list_items', {});
      });
    });

    describe('ui/updateModelContext', () => {
      it('should update model context when supported', async () => {
        const updateModelContext = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ updateModelContext });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { modelContextUpdate: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/updateModelContext', {
            context: { key: 'value' },
            merge: true,
          }),
        );

        expect(response.error).toBeUndefined();
        expect(updateModelContext).toHaveBeenCalledWith({ key: 'value' }, true);
      });

      it('should default merge to true', async () => {
        const updateModelContext = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ updateModelContext });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { modelContextUpdate: true },
        });

        await handler.handleRequest(createRequest('ui/updateModelContext', { context: { foo: 'bar' } }));

        expect(updateModelContext).toHaveBeenCalledWith({ foo: 'bar' }, true);
      });

      it('should reject when updateModelContext is not supported', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/updateModelContext', { context: {} }));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.NOT_SUPPORTED);
      });
    });

    describe('ui/openLink', () => {
      it('should open link when supported', async () => {
        const openLink = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ openLink });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { openLink: true },
        });

        const response = await handler.handleRequest(createRequest('ui/openLink', { url: 'https://example.com' }));

        expect(response.error).toBeUndefined();
        expect(openLink).toHaveBeenCalledWith('https://example.com');
      });

      it('should reject when openLink is not supported', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/openLink', { url: 'https://example.com' }));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.NOT_SUPPORTED);
      });

      it('should reject invalid URL', async () => {
        const openLink = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ openLink });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { openLink: true },
        });

        const response = await handler.handleRequest(createRequest('ui/openLink', { url: 'not-a-valid-url' }));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
        expect(response.error?.message).toContain('Invalid URL');
      });

      it('should reject missing URL', async () => {
        const openLink = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ openLink });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { openLink: true },
        });

        const response = await handler.handleRequest(createRequest('ui/openLink', {}));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
      });
    });

    describe('ui/setDisplayMode', () => {
      it('should set display mode when supported', async () => {
        const setDisplayMode = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ setDisplayMode });
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/setDisplayMode', { mode: 'fullscreen' }));

        expect(response.error).toBeUndefined();
        expect(setDisplayMode).toHaveBeenCalledWith('fullscreen');
      });

      it('should reject when setDisplayMode is not supported', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/setDisplayMode', { mode: 'fullscreen' }));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.NOT_SUPPORTED);
      });

      it('should reject invalid display mode', async () => {
        const setDisplayMode = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ setDisplayMode });
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/setDisplayMode', { mode: 'invalid-mode' }));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
      });
    });

    describe('ui/close', () => {
      it('should close when supported', async () => {
        const close = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ close });
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/close', { reason: 'user requested' }));

        expect(response.error).toBeUndefined();
        expect(close).toHaveBeenCalledWith('user requested');
      });

      it('should close without reason', async () => {
        const close = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ close });
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/close', {}));

        expect(response.error).toBeUndefined();
        expect(close).toHaveBeenCalledWith(undefined);
      });

      it('should reject when close is not supported', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/close', {}));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.NOT_SUPPORTED);
      });
    });

    describe('ui/log', () => {
      it('should log messages at different levels', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { logging: true },
        });

        const levels = ['debug', 'info', 'warn', 'error'] as const;

        for (const level of levels) {
          const response = await handler.handleRequest(
            createRequest('ui/log', {
              level,
              message: `Test ${level} message`,
              data: { extra: 'data' },
            }),
          );

          expect(response.error).toBeUndefined();
        }
      });

      it('should reject missing message', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { logging: true },
        });

        const response = await handler.handleRequest(createRequest('ui/log', { level: 'info' }));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
      });
    });

    describe('ui/registerTool', () => {
      it('should register tool when supported', async () => {
        const registerTool = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ registerTool });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { widgetTools: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/registerTool', {
            name: 'my_tool',
            description: 'My custom tool',
            inputSchema: { type: 'object', properties: {} },
          }),
        );

        expect(response.error).toBeUndefined();
        expect(registerTool).toHaveBeenCalledWith('my_tool', 'My custom tool', { type: 'object', properties: {} });
      });

      it('should reject when widgetTools is not supported', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(
          createRequest('ui/registerTool', {
            name: 'my_tool',
            description: 'My custom tool',
            inputSchema: {},
          }),
        );

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.NOT_SUPPORTED);
      });

      it('should reject missing required fields', async () => {
        const registerTool = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ registerTool });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { widgetTools: true },
        });

        // Missing name
        let response = await handler.handleRequest(
          createRequest('ui/registerTool', {
            description: 'My tool',
            inputSchema: {},
          }),
        );
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);

        // Missing description
        response = await handler.handleRequest(
          createRequest('ui/registerTool', {
            name: 'my_tool',
            inputSchema: {},
          }),
        );
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);

        // Missing inputSchema
        response = await handler.handleRequest(
          createRequest('ui/registerTool', {
            name: 'my_tool',
            description: 'My tool',
          }),
        );
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
      });
    });

    describe('ui/unregisterTool', () => {
      it('should unregister tool when supported', async () => {
        const unregisterTool = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ unregisterTool });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { widgetTools: true },
        });

        const response = await handler.handleRequest(createRequest('ui/unregisterTool', { name: 'my_tool' }));

        expect(response.error).toBeUndefined();
        expect(unregisterTool).toHaveBeenCalledWith('my_tool');
      });

      it('should reject when widgetTools is not supported', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/unregisterTool', { name: 'my_tool' }));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.NOT_SUPPORTED);
      });

      it('should reject missing tool name', async () => {
        const unregisterTool = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ unregisterTool });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { widgetTools: true },
        });

        const response = await handler.handleRequest(createRequest('ui/unregisterTool', {}));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
      });
    });

    describe('unknown method', () => {
      it('should return method not found error', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/unknownMethod', {}));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.METHOD_NOT_FOUND);
        expect(response.error?.message).toContain('Unknown ext-apps method');
      });
    });
  });

  describe('error classes', () => {
    it('should create ExtAppsMethodNotFoundError', () => {
      const error = new ExtAppsMethodNotFoundError('Method not found');
      expect(error.name).toBe('ExtAppsMethodNotFoundError');
      expect(error.message).toBe('Method not found');
    });

    it('should create ExtAppsInvalidParamsError', () => {
      const error = new ExtAppsInvalidParamsError('Invalid params');
      expect(error.name).toBe('ExtAppsInvalidParamsError');
      expect(error.message).toBe('Invalid params');
    });

    it('should create ExtAppsNotSupportedError', () => {
      const error = new ExtAppsNotSupportedError('Not supported');
      expect(error.name).toBe('ExtAppsNotSupportedError');
      expect(error.message).toBe('Not supported');
    });
  });
});
