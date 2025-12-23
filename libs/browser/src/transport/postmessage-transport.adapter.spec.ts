// file: libs/browser/src/transport/postmessage-transport.adapter.spec.ts
import { PostMessageTransportAdapter } from './postmessage-transport.adapter';
import type { JSONRPCRequest } from './transport.interface';

/**
 * Mock MessagePort for testing postMessage communication
 */
class MockMessagePort implements EventTarget {
  private listeners = new Map<string, Set<EventListener>>();
  public otherPort: MockMessagePort | null = null;
  public messages: unknown[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
    // Simulate async message delivery to the other port
    if (this.otherPort) {
      setTimeout(() => {
        const event = new MessageEvent('message', {
          data: message,
          origin: '',
        });
        this.otherPort!.dispatchEvent(event);
      }, 0);
    }
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        if (typeof listener === 'function') {
          listener(event);
        }
      }
      return true;
    }
    return false;
  }
}

/**
 * Create a connected pair of message ports
 */
function createMessageChannel(): { port1: MockMessagePort; port2: MockMessagePort } {
  const port1 = new MockMessagePort();
  const port2 = new MockMessagePort();
  port1.otherPort = port2;
  port2.otherPort = port1;
  return { port1, port2 };
}

describe('PostMessageTransportAdapter', () => {
  let port1: MockMessagePort;
  let port2: MockMessagePort;
  let transport: PostMessageTransportAdapter;

  beforeEach(() => {
    const channel = createMessageChannel();
    port1 = channel.port1;
    port2 = channel.port2;
    transport = new PostMessageTransportAdapter(port1 as unknown as MessagePort);
  });

  afterEach(() => {
    transport.destroy();
  });

  describe('constructor', () => {
    it('should create transport with default options', () => {
      expect(transport.connectionState).toBe('disconnected');
      expect(transport.getSessionId()).toBeTruthy();
    });

    it('should create transport with custom options', () => {
      const customTransport = new PostMessageTransportAdapter(port1 as unknown as MessagePort, {
        messageType: 'custom:mcp',
        targetOrigin: 'https://example.com',
        allowedOrigins: ['https://example.com'],
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

    it('should post message with envelope', async () => {
      await transport.connect();

      const message: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: '1',
        method: 'test',
      };
      await transport.send(message);

      expect(port1.messages.length).toBe(1);
      const envelope = port1.messages[0] as { type: string; sessionId: string; payload: JSONRPCRequest };
      expect(envelope.type).toBe('mcp:message');
      expect(envelope.sessionId).toBe(transport.getSessionId());
      expect(envelope.payload).toEqual(message);
    });
  });

  describe('onMessage', () => {
    it('should receive messages from port', async () => {
      await transport.connect();
      const handler = jest.fn();
      transport.onMessage(handler);

      const message: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: '1',
        method: 'test',
      };

      // Simulate message from the other port
      const envelope = {
        type: 'mcp:message',
        sessionId: 'other-session',
        payload: message,
      };
      port1.dispatchEvent(
        new MessageEvent('message', {
          data: envelope,
          origin: '',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).toHaveBeenCalledWith(message);
    });

    it('should ignore messages with wrong type', async () => {
      await transport.connect();
      const handler = jest.fn();
      transport.onMessage(handler);

      port1.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'wrong:type',
            sessionId: 'test',
            payload: { jsonrpc: '2.0', id: '1', method: 'test' },
          },
          origin: '',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).not.toHaveBeenCalled();
    });

    it('should ignore invalid envelope structures', async () => {
      await transport.connect();
      const handler = jest.fn();
      transport.onMessage(handler);

      // Not an object
      port1.dispatchEvent(new MessageEvent('message', { data: 'string data', origin: '' }));

      // Missing type
      port1.dispatchEvent(
        new MessageEvent('message', {
          data: { sessionId: 'test', payload: {} },
          origin: '',
        }),
      );

      // Missing payload
      port1.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'mcp:message', sessionId: 'test' },
          origin: '',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return unsubscribe function', async () => {
      await transport.connect();
      const handler = jest.fn();
      const unsubscribe = transport.onMessage(handler);

      unsubscribe();

      port1.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'mcp:message',
            sessionId: 'test',
            payload: { jsonrpc: '2.0', id: '1', method: 'test' },
          },
          origin: '',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('origin validation', () => {
    it('should accept all origins with wildcard', async () => {
      const wildcardTransport = new PostMessageTransportAdapter(port1 as unknown as MessagePort, {
        allowedOrigins: ['*'],
      });
      await wildcardTransport.connect();

      const handler = jest.fn();
      wildcardTransport.onMessage(handler);

      port1.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'mcp:message',
            sessionId: 'test',
            payload: { jsonrpc: '2.0', id: '1', method: 'test' },
          },
          origin: 'https://any-origin.com',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).toHaveBeenCalled();
      wildcardTransport.destroy();
    });

    it('should accept matching string origin', async () => {
      const strictTransport = new PostMessageTransportAdapter(port1 as unknown as MessagePort, {
        allowedOrigins: ['https://trusted.com'],
      });
      await strictTransport.connect();

      const handler = jest.fn();
      strictTransport.onMessage(handler);

      port1.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'mcp:message',
            sessionId: 'test',
            payload: { jsonrpc: '2.0', id: '1', method: 'test' },
          },
          origin: 'https://trusted.com',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).toHaveBeenCalled();
      strictTransport.destroy();
    });

    it('should reject non-matching origin', async () => {
      const strictTransport = new PostMessageTransportAdapter(port1 as unknown as MessagePort, {
        allowedOrigins: ['https://trusted.com'],
      });
      await strictTransport.connect();

      const handler = jest.fn();
      strictTransport.onMessage(handler);

      port1.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'mcp:message',
            sessionId: 'test',
            payload: { jsonrpc: '2.0', id: '1', method: 'test' },
          },
          origin: 'https://untrusted.com',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).not.toHaveBeenCalled();
      strictTransport.destroy();
    });

    it('should accept regex matching origin', async () => {
      const regexTransport = new PostMessageTransportAdapter(port1 as unknown as MessagePort, {
        allowedOrigins: [/^https:\/\/.*\.trusted\.com$/],
      });
      await regexTransport.connect();

      const handler = jest.fn();
      regexTransport.onMessage(handler);

      port1.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'mcp:message',
            sessionId: 'test',
            payload: { jsonrpc: '2.0', id: '1', method: 'test' },
          },
          origin: 'https://sub.trusted.com',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(handler).toHaveBeenCalled();
      regexTransport.destroy();
    });
  });

  describe('onError', () => {
    it('should return unsubscribe function', async () => {
      await transport.connect();
      const handler = jest.fn();
      const unsubscribe = transport.onError(handler);
      unsubscribe();
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
      transport.destroy();
      expect(transport.connectionState).toBe('disconnected');
    });
  });

  describe('bidirectional communication', () => {
    it('should support communication between two transports', async () => {
      const transport1 = new PostMessageTransportAdapter(port1 as unknown as MessagePort);
      const transport2 = new PostMessageTransportAdapter(port2 as unknown as MessagePort);

      await transport1.connect();
      await transport2.connect();

      const received1 = jest.fn();
      const received2 = jest.fn();

      transport1.onMessage(received1);
      transport2.onMessage(received2);

      // Transport 1 sends to Transport 2
      await transport1.send({ jsonrpc: '2.0', id: '1', method: 'hello' });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received2).toHaveBeenCalledWith({ jsonrpc: '2.0', id: '1', method: 'hello' });

      // Transport 2 sends to Transport 1
      await transport2.send({ jsonrpc: '2.0', id: '2', result: 'world' });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received1).toHaveBeenCalledWith({ jsonrpc: '2.0', id: '2', result: 'world' });

      transport1.destroy();
      transport2.destroy();
    });
  });
});
