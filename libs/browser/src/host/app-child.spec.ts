// file: libs/browser/src/host/app-child.spec.ts
/**
 * @jest-environment jsdom
 */

import { createAppChild } from './app-child';
import { AppChildError } from './types';

describe('createAppChild', () => {
  let originalParent: Window | null;
  let mockPostMessage: jest.Mock;

  beforeEach(() => {
    originalParent = window.parent;
    mockPostMessage = jest.fn();

    // Mock window.parent
    Object.defineProperty(window, 'parent', {
      value: {
        postMessage: mockPostMessage,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'parent', {
      value: originalParent,
      writable: true,
      configurable: true,
    });
  });

  describe('factory function', () => {
    it('should create an AppChild instance', () => {
      const child = createAppChild();

      expect(child).toBeDefined();
      expect(typeof child.ready).toBe('function');
      expect(typeof child.getInitialData).toBe('function');
      expect(typeof child.postMessage).toBe('function');
      expect(typeof child.onMessage).toBe('function');
      expect(typeof child.requestPermission).toBe('function');
      expect(typeof child.getPermissions).toBe('function');
    });

    it('should accept options', () => {
      const onInitialData = jest.fn();
      const onError = jest.fn();

      const child = createAppChild({
        allowedOrigins: ['https://host.com'],
        onInitialData,
        onError,
      });

      expect(child).toBeDefined();
    });

    it('should accept serverInfo', () => {
      const child = createAppChild(
        {},
        {
          name: 'Test App',
          version: '1.0.0',
        },
      );

      expect(child).toBeDefined();
    });
  });

  describe('ready()', () => {
    it('should send app:ready message to parent', () => {
      const child = createAppChild(
        {},
        {
          name: 'Test App',
          version: '1.0.0',
        },
      );

      child.ready();

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'app:ready',
          serverInfo: { name: 'Test App', version: '1.0.0' },
        }),
        '*',
      );
    });

    it('should only send ready message once', () => {
      const child = createAppChild();

      child.ready();
      child.ready();

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
    });

    it('should use first allowed origin as target when specified', () => {
      const child = createAppChild({
        allowedOrigins: ['https://host.com'],
      });

      child.ready();

      expect(mockPostMessage).toHaveBeenCalledWith(expect.any(Object), 'https://host.com');
    });
  });

  describe('getInitialData()', () => {
    it('should return undefined before receiving init data', () => {
      const child = createAppChild();

      expect(child.getInitialData()).toBeUndefined();
    });
  });

  describe('getAuthContext()', () => {
    it('should return undefined before receiving auth context', () => {
      const child = createAppChild();

      expect(child.getAuthContext()).toBeUndefined();
    });
  });

  describe('postMessage()', () => {
    it('should send custom message to parent', () => {
      const child = createAppChild();

      child.postMessage('test-type', { key: 'value' });

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          type: 'custom',
          messageType: 'test-type',
          payload: { key: 'value' },
        },
        '*',
      );
    });
  });

  describe('onMessage()', () => {
    it('should register message handler and return unsubscribe function', () => {
      const child = createAppChild();
      const handler = jest.fn();

      const unsubscribe = child.onMessage(handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should allow unsubscribing', () => {
      const child = createAppChild();
      const handler = jest.fn();

      const unsubscribe = child.onMessage(handler);
      unsubscribe();

      // Handler should be removed
    });
  });

  describe('requestPermission()', () => {
    it('should send permission request to parent', async () => {
      const child = createAppChild();

      const permissionPromise = child.requestPermission('camera');

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'permission:request',
          permission: 'camera',
        }),
        '*',
      );

      // Will timeout and return false
    });
  });

  describe('getPermissions()', () => {
    it('should return empty array initially', () => {
      const child = createAppChild();

      expect(child.getPermissions()).toEqual([]);
    });
  });

  describe('notifyResize()', () => {
    it('should send resize message to parent', () => {
      const child = createAppChild();

      child.notifyResize(800, 600);

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          type: 'app:resize',
          width: 800,
          height: 600,
        },
        '*',
      );
    });
  });

  describe('reportError()', () => {
    it('should send error message to parent', () => {
      const child = createAppChild();

      child.reportError('Something went wrong');

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          type: 'app:error',
          error: 'Something went wrong',
        },
        '*',
      );
    });
  });

  describe('sendMcpResponse()', () => {
    it('should send MCP response to parent', () => {
      const child = createAppChild();

      child.sendMcpResponse('req-123', { data: 'result' });

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          type: 'mcp:response',
          id: 'req-123',
          result: { data: 'result' },
          error: undefined,
        },
        '*',
      );
    });

    it('should send MCP error response', () => {
      const child = createAppChild();

      child.sendMcpResponse('req-123', undefined, 'Error message');

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          type: 'mcp:response',
          id: 'req-123',
          result: undefined,
          error: 'Error message',
        },
        '*',
      );
    });
  });

  describe('sendMcpNotification()', () => {
    it('should send MCP notification to parent', () => {
      const child = createAppChild();

      child.sendMcpNotification('resources/updated', { uri: 'file://test' });

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          type: 'mcp:notification',
          method: 'resources/updated',
          params: { uri: 'file://test' },
        },
        '*',
      );
    });
  });

  describe('destroy()', () => {
    it('should clean up resources', () => {
      const child = createAppChild();
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      child.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('when not in iframe', () => {
    beforeEach(() => {
      // Simulate not being in an iframe
      Object.defineProperty(window, 'parent', {
        value: window,
        writable: true,
        configurable: true,
      });
    });

    it('should warn when trying to send messages', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const child = createAppChild();

      child.ready();

      expect(warnSpy).toHaveBeenCalledWith('[AppChild] Not running in iframe, cannot send to parent');
      warnSpy.mockRestore();
    });
  });
});

describe('AppChildError', () => {
  it('should create error with message', () => {
    const error = new AppChildError('Something went wrong');

    expect(error.message).toBe('Something went wrong');
    expect(error.name).toBe('AppChildError');
    expect(error instanceof Error).toBe(true);
  });
});
