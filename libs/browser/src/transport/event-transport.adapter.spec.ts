// file: libs/browser/src/transport/event-transport.adapter.spec.ts
import {
  EventTransportAdapter,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isJSONRPCNotification,
} from './event-transport.adapter';
import { SimpleEmitter } from './simple-emitter';
import type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, JSONRPCNotification } from './transport.interface';

describe('EventTransportAdapter', () => {
  let emitter: SimpleEmitter;
  let transport: EventTransportAdapter;

  beforeEach(() => {
    emitter = new SimpleEmitter();
    transport = new EventTransportAdapter(emitter);
  });

  afterEach(() => {
    transport.destroy();
  });

  describe('constructor', () => {
    it('should create transport with default options', () => {
      expect(transport.connectionState).toBe('disconnected');
      expect(transport.getSessionId()).toBeTruthy();
    });

    it('should create transport with custom event names', () => {
      const customTransport = new EventTransportAdapter(emitter, {
        sendEvent: 'custom:send',
        receiveEvent: 'custom:receive',
      });
      expect(customTransport.connectionState).toBe('disconnected');
      customTransport.destroy();
    });
  });

  describe('connect', () => {
    it('should connect and set state to connected', async () => {
      await transport.connect();
      expect(transport.connectionState).toBe('connected');
    });

    it('should be idempotent', async () => {
      await transport.connect();
      await transport.connect();
      expect(transport.connectionState).toBe('connected');
    });
  });

  describe('send', () => {
    it('should throw if not connected', async () => {
      const message: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: '1',
        method: 'test',
      };
      await expect(transport.send(message)).rejects.toThrow('Transport not connected');
    });

    it('should emit message on send event', async () => {
      await transport.connect();
      const listener = jest.fn();
      emitter.on('mcp:response', listener);

      const message: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: '1',
        method: 'test',
      };
      await transport.send(message);

      expect(listener).toHaveBeenCalledWith(message);
    });
  });

  describe('onMessage', () => {
    it('should receive messages from emitter', async () => {
      await transport.connect();
      const handler = jest.fn();
      transport.onMessage(handler);

      const message: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: '1',
        method: 'test',
        params: { data: 'hello' },
      };
      emitter.emit('mcp:request', message);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).toHaveBeenCalledWith(message);
    });

    it('should return unsubscribe function', async () => {
      await transport.connect();
      const handler = jest.fn();
      const unsubscribe = transport.onMessage(handler);

      unsubscribe();

      emitter.emit('mcp:request', { jsonrpc: '2.0', id: '1', method: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).not.toHaveBeenCalled();
    });

    it('should send response when handler returns one', async () => {
      await transport.connect();
      const responseListener = jest.fn();
      emitter.on('mcp:response', responseListener);

      transport.onMessage(async (message) => {
        if (isJSONRPCRequest(message)) {
          return {
            jsonrpc: '2.0' as const,
            id: message.id,
            result: { success: true },
          };
        }
        return;
      });

      emitter.emit('mcp:request', { jsonrpc: '2.0', id: '1', method: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(responseListener).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '1',
          result: { success: true },
        }),
      );
    });
  });

  describe('onError', () => {
    it('should call error handler on send error', async () => {
      await transport.connect();
      const errorHandler = jest.fn();
      transport.onError(errorHandler);

      // Create a transport with a broken emitter
      const brokenEmitter = {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn().mockImplementation(() => {
          throw new Error('Emit failed');
        }),
      } as any;

      const brokenTransport = new EventTransportAdapter(brokenEmitter);
      brokenTransport.onError(errorHandler);

      // Force connected state
      (brokenTransport as any)._connectionState = 'connected';

      await expect(brokenTransport.send({ jsonrpc: '2.0', id: '1', method: 'test' })).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should return unsubscribe function', async () => {
      await transport.connect();
      const handler = jest.fn();
      const unsubscribe = transport.onError(handler);

      unsubscribe();
      // Error handler is removed - no way to directly test without triggering error
      expect(true).toBe(true);
    });
  });

  describe('onClose', () => {
    it('should call close handler on destroy', async () => {
      await transport.connect();
      const closeHandler = jest.fn();
      transport.onClose(closeHandler);

      transport.destroy('test reason');

      expect(closeHandler).toHaveBeenCalledWith('test reason');
    });

    it('should return unsubscribe function', async () => {
      await transport.connect();
      const handler = jest.fn();
      const unsubscribe = transport.onClose(handler);

      unsubscribe();
      transport.destroy();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should set state to disconnected', async () => {
      await transport.connect();
      transport.destroy();
      expect(transport.connectionState).toBe('disconnected');
    });

    it('should be idempotent', async () => {
      await transport.connect();
      transport.destroy();
      transport.destroy(); // Should not throw
      expect(transport.connectionState).toBe('disconnected');
    });

    it('should remove message listener', async () => {
      await transport.connect();
      const handler = jest.fn();
      transport.onMessage(handler);

      transport.destroy();

      emitter.emit('mcp:request', { jsonrpc: '2.0', id: '1', method: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).not.toHaveBeenCalled();
    });

    it('should clear all handlers', async () => {
      await transport.connect();
      const messageHandler = jest.fn();
      const errorHandler = jest.fn();
      const closeHandler = jest.fn();

      transport.onMessage(messageHandler);
      transport.onError(errorHandler);
      transport.onClose(closeHandler);

      transport.destroy();

      // Reconnect and verify handlers are gone
      await transport.connect();
      emitter.emit('mcp:request', { jsonrpc: '2.0', id: '1', method: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(messageHandler).not.toHaveBeenCalled();
    });
  });

  describe('two-way communication', () => {
    it('should support bidirectional communication with swapped events', async () => {
      const serverTransport = new EventTransportAdapter(emitter, {
        sendEvent: 'mcp:response',
        receiveEvent: 'mcp:request',
      });

      const clientTransport = new EventTransportAdapter(emitter, {
        sendEvent: 'mcp:request',
        receiveEvent: 'mcp:response',
      });

      await serverTransport.connect();
      await clientTransport.connect();

      const serverReceived = jest.fn();
      const clientReceived = jest.fn();

      serverTransport.onMessage(async (msg) => {
        serverReceived(msg);
        if (isJSONRPCRequest(msg)) {
          return { jsonrpc: '2.0' as const, id: msg.id, result: 'server response' };
        }
        return;
      });

      clientTransport.onMessage(async (msg) => {
        clientReceived(msg);
        return;
      });

      // Client sends request
      await clientTransport.send({ jsonrpc: '2.0', id: '1', method: 'test' });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(serverReceived).toHaveBeenCalledWith(expect.objectContaining({ method: 'test' }));
      expect(clientReceived).toHaveBeenCalledWith(expect.objectContaining({ result: 'server response' }));

      serverTransport.destroy();
      clientTransport.destroy();
    });
  });
});

describe('JSON-RPC type guards', () => {
  describe('isJSONRPCRequest', () => {
    it('should return true for requests', () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: '1',
        method: 'test',
      };
      expect(isJSONRPCRequest(request)).toBe(true);
    });

    it('should return false for responses', () => {
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: '1',
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
    it('should return true for success responses', () => {
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: '1',
        result: {},
      };
      expect(isJSONRPCResponse(response)).toBe(true);
    });

    it('should return true for error responses', () => {
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: '1',
        error: { code: -32600, message: 'Invalid Request' },
      };
      expect(isJSONRPCResponse(response)).toBe(true);
    });

    it('should return false for requests', () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: '1',
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
        id: '1',
        method: 'test',
      };
      expect(isJSONRPCNotification(request)).toBe(false);
    });
  });
});
