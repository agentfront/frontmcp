// file: libs/browser/src/transport/browser-transport.base.spec.ts
/**
 * Tests for BrowserTransportAdapterBase
 */

import {
  BrowserTransportAdapterBase,
  BrowserTransportBaseOptions,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isJSONRPCNotification,
} from './browser-transport.base';
import type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, JSONRPCNotification } from './transport.interface';

/**
 * Test implementation of BrowserTransportAdapterBase
 */
class TestTransport extends BrowserTransportAdapterBase {
  public sentMessages: JSONRPCMessage[] = [];
  public connected = false;
  public destroyed = false;

  constructor(options?: BrowserTransportBaseOptions) {
    super(options);
  }

  async connect(): Promise<void> {
    this.connected = true;
    await this.onConnect();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Transport not connected');
    }
    this.sentMessages.push(message);
  }

  async destroy(reason?: string): Promise<void> {
    this.destroyed = true;
    await this.onDestroy(reason);
  }

  // Expose protected methods for testing
  public simulateIncomingMessage(message: JSONRPCMessage): void {
    this.handleMessage(message);
  }

  public getState() {
    return this.state;
  }
}

describe('BrowserTransportAdapterBase', () => {
  let transport: TestTransport;

  beforeEach(() => {
    transport = new TestTransport();
  });

  afterEach(async () => {
    if (transport.isConnected) {
      await transport.destroy();
    }
  });

  describe('constructor', () => {
    it('should generate a session ID if not provided', () => {
      expect(transport.getSessionId()).toBeDefined();
      expect(transport.getSessionId()).toMatch(/^[a-f0-9-]{36}$/);
    });

    it('should use provided session ID', () => {
      const customTransport = new TestTransport({ sessionId: 'custom-session' });
      expect(customTransport.getSessionId()).toBe('custom-session');
    });

    it('should start in disconnected state', () => {
      expect(transport.getState()).toBe('disconnected');
      expect(transport.isConnected).toBe(false);
    });
  });

  describe('connect', () => {
    it('should set connection state to connected', async () => {
      await transport.connect();
      expect(transport.getState()).toBe('connected');
      expect(transport.isConnected).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should set connection state to disconnected', async () => {
      await transport.connect();
      await transport.destroy();
      expect(transport.getState()).toBe('disconnected');
      expect(transport.isConnected).toBe(false);
    });

    it('should reject pending requests', async () => {
      await transport.connect();

      // Start a request that won't be answered
      const requestPromise = transport.request('test-method');

      // Destroy transport
      await transport.destroy('test reason');

      // Request should be rejected
      await expect(requestPromise).rejects.toThrow('test reason');
    });
  });

  describe('send', () => {
    it('should throw if not connected', async () => {
      const message: JSONRPCNotification = {
        jsonrpc: '2.0',
        method: 'test',
      };

      await expect(transport.send(message)).rejects.toThrow('Transport not connected');
    });

    it('should send message when connected', async () => {
      await transport.connect();

      const message: JSONRPCNotification = {
        jsonrpc: '2.0',
        method: 'test',
      };

      await transport.send(message);
      expect(transport.sentMessages).toContainEqual(message);
    });
  });

  describe('request', () => {
    it('should throw if not connected', async () => {
      await expect(transport.request('test')).rejects.toThrow('Transport not connected');
    });

    it('should send request message', async () => {
      await transport.connect();

      // Start request (will timeout since no response)
      const requestPromise = transport.request('test-method', { foo: 'bar' }, 100);

      // Check sent message
      expect(transport.sentMessages).toHaveLength(1);
      expect(transport.sentMessages[0]).toMatchObject({
        jsonrpc: '2.0',
        method: 'test-method',
        params: { foo: 'bar' },
      });

      // Let it timeout
      await expect(requestPromise).rejects.toThrow('Request timeout');
    });

    it('should resolve when response is received', async () => {
      await transport.connect();

      // Start request
      const requestPromise = transport.request('test-method');

      // Get the request ID from sent message
      const sentRequest = transport.sentMessages[0] as JSONRPCRequest;

      // Simulate response
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: sentRequest.id,
        result: { success: true },
      };
      transport.simulateIncomingMessage(response);

      // Should resolve
      await expect(requestPromise).resolves.toEqual({ success: true });
    });

    it('should reject when error response is received', async () => {
      await transport.connect();

      // Start request
      const requestPromise = transport.request('test-method');

      // Get the request ID from sent message
      const sentRequest = transport.sentMessages[0] as JSONRPCRequest;

      // Simulate error response
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: sentRequest.id,
        error: { code: -32000, message: 'Test error' },
      };
      transport.simulateIncomingMessage(response);

      // Should reject
      await expect(requestPromise).rejects.toThrow('Test error');
    });
  });

  describe('notify', () => {
    it('should throw if not connected', async () => {
      await expect(transport.notify('test')).rejects.toThrow('Transport not connected');
    });

    it('should send notification message', async () => {
      await transport.connect();

      await transport.notify('test-notification', { data: 123 });

      expect(transport.sentMessages).toContainEqual({
        jsonrpc: '2.0',
        method: 'test-notification',
        params: { data: 123 },
      });
    });
  });

  describe('ping', () => {
    it('should return false if not connected', async () => {
      // ping internally calls request which throws if not connected
      const result = await transport.ping(100);
      expect(result).toBe(false);
    });

    it('should return false on timeout', async () => {
      await transport.connect();
      const result = await transport.ping(100);
      expect(result).toBe(false);
    });

    it('should return true on successful response', async () => {
      await transport.connect();

      // Start ping
      const pingPromise = transport.ping(1000);

      // Simulate response
      const sentRequest = transport.sentMessages[0] as JSONRPCRequest;
      transport.simulateIncomingMessage({
        jsonrpc: '2.0',
        id: sentRequest.id,
        result: 'pong',
      });

      expect(await pingPromise).toBe(true);
    });
  });

  describe('pendingRequestCount', () => {
    it('should track pending requests', async () => {
      await transport.connect();

      expect(transport.pendingRequestCount).toBe(0);

      // Start request
      const requestPromise = transport.request('test', undefined, 1000);

      expect(transport.pendingRequestCount).toBe(1);

      // Simulate response
      const sentRequest = transport.sentMessages[0] as JSONRPCRequest;
      transport.simulateIncomingMessage({
        jsonrpc: '2.0',
        id: sentRequest.id,
        result: 'done',
      });

      await requestPromise;

      expect(transport.pendingRequestCount).toBe(0);
    });
  });
});

describe('Type guards', () => {
  describe('isJSONRPCRequest', () => {
    it('should return true for requests', () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };
      expect(isJSONRPCRequest(request)).toBe(true);
    });

    it('should return false for responses', () => {
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {},
      };
      expect(isJSONRPCRequest(response)).toBe(false);
    });

    it('should return false for notifications', () => {
      const notification: JSONRPCNotification = {
        jsonrpc: '2.0',
        method: 'test',
      };
      expect(isJSONRPCRequest(notification)).toBe(false);
    });
  });

  describe('isJSONRPCResponse', () => {
    it('should return true for responses with result', () => {
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {},
      };
      expect(isJSONRPCResponse(response)).toBe(true);
    });

    it('should return true for responses with error', () => {
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -1, message: 'error' },
      };
      expect(isJSONRPCResponse(response)).toBe(true);
    });

    it('should return false for requests', () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };
      expect(isJSONRPCResponse(request)).toBe(false);
    });
  });

  describe('isJSONRPCNotification', () => {
    it('should return true for notifications', () => {
      const notification: JSONRPCNotification = {
        jsonrpc: '2.0',
        method: 'test',
      };
      expect(isJSONRPCNotification(notification)).toBe(true);
    });

    it('should return false for requests', () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };
      expect(isJSONRPCNotification(request)).toBe(false);
    });
  });
});
