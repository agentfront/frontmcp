/**
 * @file ext-apps.handler.spec.ts
 * @description Tests for the MCP Apps (ext-apps) message handler.
 */

import {
  createExtAppsMessageHandler,
  ExtAppsInvalidParamsError,
  ExtAppsMessageHandler,
  ExtAppsMethodNotFoundError,
  ExtAppsNotSupportedError,
  type ExtAppsHandlerContext,
} from '../ext-apps.handler';
import { EXT_APPS_ERROR_CODES, type ExtAppsJsonRpcNotification, type ExtAppsJsonRpcRequest } from '../ext-apps.types';

describe('ExtAppsMessageHandler', () => {
  // Mock logger with all FrontMcpLogger methods
  const mockLogger = {
    debug: jest.fn(),
    verbose: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  // Base context with required methods
  const createMockContext = (overrides: Partial<ExtAppsHandlerContext> = {}): ExtAppsHandlerContext => ({
    sessionId: 'test-session-123',
    logger: mockLogger as unknown as ExtAppsHandlerContext['logger'],
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
      it('should log debug messages using verbose', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { logging: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/log', {
            level: 'debug',
            message: 'Test debug message',
            data: { extra: 'data' },
          }),
        );

        expect(response.error).toBeUndefined();
        expect(mockLogger.child).toHaveBeenCalled();
        expect(mockLogger.verbose).toHaveBeenCalledWith('Test debug message', { extra: 'data' });
      });

      it('answers with an empty result, so the JSON-RPC response carries `result` (#681)', async () => {
        const handler = new ExtAppsMessageHandler({
          context: createMockContext(),
          hostCapabilities: { logging: true },
        });

        const response = await handler.handleRequest(createRequest('ui/log', { level: 'info', message: 'hi' }));

        expect(response).toEqual({ jsonrpc: '2.0', id: expect.anything(), result: {} });
        expect(JSON.parse(JSON.stringify(response))).toHaveProperty('result', {});
      });

      it('should log info messages using info', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { logging: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/log', {
            level: 'info',
            message: 'Test info message',
            data: { key: 'value' },
          }),
        );

        expect(response.error).toBeUndefined();
        expect(mockLogger.info).toHaveBeenCalledWith('Test info message', { key: 'value' });
      });

      it('should log warn messages using warn', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { logging: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/log', {
            level: 'warn',
            message: 'Test warn message',
          }),
        );

        expect(response.error).toBeUndefined();
        expect(mockLogger.warn).toHaveBeenCalledWith('Test warn message', undefined);
      });

      it('should log error messages using error', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { logging: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/log', {
            level: 'error',
            message: 'Test error message',
            data: { stack: 'error stack' },
          }),
        );

        expect(response.error).toBeUndefined();
        expect(mockLogger.error).toHaveBeenCalledWith('Test error message', { stack: 'error stack' });
      });

      it('should default to info for undefined level', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { logging: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/log', {
            message: 'Test message without level',
          }),
        );

        expect(response.error).toBeUndefined();
        expect(mockLogger.info).toHaveBeenCalledWith('Test message without level', undefined);
      });

      it('should reject invalid log level', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { logging: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/log', {
            level: 'invalid-level',
            message: 'Test message',
          }),
        );

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
        expect(response.error?.message).toContain('Invalid log level');
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

      it('should reject when logging is not supported', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { logging: false },
        });

        const response = await handler.handleRequest(createRequest('ui/log', { level: 'info', message: 'Test' }));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.NOT_SUPPORTED);
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

      it('should reject inputSchema that is an array', async () => {
        const registerTool = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ registerTool });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { widgetTools: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/registerTool', {
            name: 'my_tool',
            description: 'My tool',
            inputSchema: ['not', 'an', 'object'],
          }),
        );

        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
        expect(response.error?.message).toContain('must be a non-null object');
      });

      it('should reject null inputSchema', async () => {
        const registerTool = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ registerTool });
        const handler = new ExtAppsMessageHandler({
          context,
          hostCapabilities: { widgetTools: true },
        });

        const response = await handler.handleRequest(
          createRequest('ui/registerTool', {
            name: 'my_tool',
            description: 'My tool',
            inputSchema: null,
          }),
        );

        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
        expect(response.error?.message).toContain('must be a non-null object');
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

    describe('MCP Apps spec method names', () => {
      it('ui/update-model-context replaces the context with its content and structuredContent', async () => {
        const updateModelContext = jest.fn().mockResolvedValue(undefined);
        const handler = new ExtAppsMessageHandler({
          context: createMockContext({ updateModelContext }),
          hostCapabilities: { modelContextUpdate: true },
        });
        const content = [{ type: 'text', text: '{"city":"Oslo"}' }];

        const response = await handler.handleRequest(
          createRequest('ui/update-model-context', { content, structuredContent: { city: 'Oslo' } }),
        );

        expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
        expect(updateModelContext).toHaveBeenCalledWith({ content, structuredContent: { city: 'Oslo' } }, false);
      });

      it('ui/update-model-context passes only the fields the widget sent', async () => {
        const updateModelContext = jest.fn().mockResolvedValue(undefined);
        const handler = new ExtAppsMessageHandler({
          context: createMockContext({ updateModelContext }),
          hostCapabilities: { modelContextUpdate: true },
        });

        await handler.handleRequest(createRequest('ui/update-model-context', { structuredContent: { unit: 'C' } }));

        expect(updateModelContext).toHaveBeenCalledWith({ structuredContent: { unit: 'C' } }, false);
      });

      it('ui/update-model-context rejects content that is not an array and structuredContent that is not an object', async () => {
        const handler = new ExtAppsMessageHandler({
          context: createMockContext({ updateModelContext: jest.fn() }),
          hostCapabilities: { modelContextUpdate: true },
        });

        const badContent = await handler.handleRequest(createRequest('ui/update-model-context', { content: 'hi' }));
        const badStructured = await handler.handleRequest(
          createRequest('ui/update-model-context', { structuredContent: ['a'] }),
        );

        expect(badContent.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
        expect(badStructured.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
      });

      it('ui/update-model-context is not supported when the host does not advertise it', async () => {
        const handler = new ExtAppsMessageHandler({ context: createMockContext({ updateModelContext: jest.fn() }) });

        const response = await handler.handleRequest(createRequest('ui/update-model-context', { content: [] }));

        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.NOT_SUPPORTED);
      });

      it('ui/open-link opens the link', async () => {
        const openLink = jest.fn().mockResolvedValue(undefined);
        const handler = new ExtAppsMessageHandler({
          context: createMockContext({ openLink }),
          hostCapabilities: { openLink: true },
        });

        const response = await handler.handleRequest(createRequest('ui/open-link', { url: 'https://example.com' }));

        expect(response.error).toBeUndefined();
        expect(openLink).toHaveBeenCalledWith('https://example.com');
      });

      it('ui/notifications/request-teardown sent with an id still closes the widget', async () => {
        const close = jest.fn().mockResolvedValue(undefined);
        const handler = new ExtAppsMessageHandler({ context: createMockContext({ close }) });

        const response = await handler.handleRequest(createRequest('ui/notifications/request-teardown', {}));

        expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
        expect(close).toHaveBeenCalledWith(undefined);
      });

      it('ui/request-display-mode sets the mode and answers with it', async () => {
        const setDisplayMode = jest.fn().mockResolvedValue(undefined);
        const handler = new ExtAppsMessageHandler({ context: createMockContext({ setDisplayMode }) });

        const response = await handler.handleRequest(createRequest('ui/request-display-mode', { mode: 'pip' }));

        expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: { mode: 'pip' } });
        expect(setDisplayMode).toHaveBeenCalledWith('pip');
      });

      it.each([
        ['debug', 'verbose'],
        ['info', 'info'],
        ['notice', 'info'],
        ['warning', 'warn'],
        ['error', 'error'],
        ['critical', 'error'],
        ['alert', 'error'],
        ['emergency', 'error'],
      ] as const)('notifications/message at level %s logs with %s', async (level, method) => {
        const handler = new ExtAppsMessageHandler({
          context: createMockContext(),
          hostCapabilities: { logging: true },
        });

        const response = await handler.handleRequest(
          createRequest('notifications/message', { level, data: 'Quota low' }),
        );

        expect(response.error).toBeUndefined();
        expect(mockLogger[method]).toHaveBeenCalledWith('Quota low', undefined);
      });

      it('notifications/message logs non-string data under the logger name', async () => {
        const handler = new ExtAppsMessageHandler({
          context: createMockContext(),
          hostCapabilities: { logging: true },
        });

        await handler.handleRequest(
          createRequest('notifications/message', { level: 'info', logger: 'chart', data: { points: 3 } }),
        );

        expect(mockLogger.info).toHaveBeenCalledWith('chart', { points: 3 });
      });

      it('notifications/message rejects a level MCP does not define', async () => {
        const handler = new ExtAppsMessageHandler({
          context: createMockContext(),
          hostCapabilities: { logging: true },
        });

        const response = await handler.handleRequest(
          createRequest('notifications/message', { level: 'warn', data: 'x' }),
        );

        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
      });

      it('notifications/message is not supported when the host does not log', async () => {
        const handler = new ExtAppsMessageHandler({ context: createMockContext() });

        const response = await handler.handleRequest(
          createRequest('notifications/message', { level: 'info', data: 'x' }),
        );

        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.NOT_SUPPORTED);
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

    describe('params validation', () => {
      it('should reject null params', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/close', null as unknown));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
        expect(response.error?.message).toContain('Invalid params: expected object');
      });

      it('should reject array params', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/close', ['invalid']));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
        expect(response.error?.message).toContain('Invalid params: expected object');
      });

      it('should reject primitive params (string)', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/close', 'invalid'));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
        expect(response.error?.message).toContain('Invalid params: expected object');
      });

      it('should reject primitive params (number)', async () => {
        const context = createMockContext();
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/close', 123));

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(EXT_APPS_ERROR_CODES.INVALID_PARAMS);
        expect(response.error?.message).toContain('Invalid params: expected object');
      });

      it('should accept undefined params', async () => {
        const close = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ close });
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/close', undefined));

        expect(response.error).toBeUndefined();
        expect(close).toHaveBeenCalled();
      });

      it('should accept valid object params', async () => {
        const close = jest.fn().mockResolvedValue(undefined);
        const context = createMockContext({ close });
        const handler = new ExtAppsMessageHandler({ context });

        const response = await handler.handleRequest(createRequest('ui/close', { reason: 'test' }));

        expect(response.error).toBeUndefined();
        expect(close).toHaveBeenCalledWith('test');
      });
    });
  });

  describe('handleNotification', () => {
    const createNotification = (method: string, params?: unknown): ExtAppsJsonRpcNotification => ({
      jsonrpc: '2.0',
      method,
      params,
    });

    it('logs a notifications/message', async () => {
      const handler = new ExtAppsMessageHandler({ context: createMockContext(), hostCapabilities: { logging: true } });

      await handler.handleNotification(createNotification('notifications/message', { level: 'warning', data: 'Low' }));

      expect(mockLogger.warn).toHaveBeenCalledWith('Low', undefined);
    });

    it('closes the widget on a ui/notifications/request-teardown', async () => {
      const close = jest.fn().mockResolvedValue(undefined);
      const handler = new ExtAppsMessageHandler({ context: createMockContext({ close }) });

      await handler.handleNotification(createNotification('ui/notifications/request-teardown', {}));
      await handler.handleNotification(createNotification('ui/notifications/request-teardown'));

      expect(close).toHaveBeenNthCalledWith(1, undefined);
      expect(close).toHaveBeenCalledTimes(2);
    });

    it('logs that a ui/notifications/request-teardown is not supported without a close callback', async () => {
      const handler = new ExtAppsMessageHandler({ context: createMockContext() });

      await handler.handleNotification(createNotification('ui/notifications/request-teardown', {}));

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Widget close not supported by host'));
    });

    it('ignores a notification it does not handle', async () => {
      const handler = new ExtAppsMessageHandler({ context: createMockContext(), hostCapabilities: { logging: true } });

      await expect(
        handler.handleNotification(createNotification('ui/notifications/size-changed', { height: 200 })),
      ).resolves.toBeUndefined();

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('only logs a failure, as a notification gets no answer', async () => {
      const handler = new ExtAppsMessageHandler({ context: createMockContext() });

      await expect(
        handler.handleNotification(createNotification('notifications/message', { level: 'info', data: 'x' })),
      ).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Logging not supported by host'));
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
