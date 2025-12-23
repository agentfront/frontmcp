// file: libs/browser/src/transport/event-transport.adapter.ts
/**
 * EventEmitter-based transport adapter for browser MCP communication.
 *
 * This adapter enables MCP communication through an EventEmitter pattern,
 * making it ideal for same-context communication like Web Workers,
 * in-browser testing, or any scenario where both parties share an emitter.
 */

import { generateUUID } from '@frontmcp/sdk/core';
import type {
  MinimalEventEmitter,
  BrowserTransport,
  BrowserConnectionState,
  BrowserMessageHandler,
  EventTransportOptions,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
} from './transport.interface';

/**
 * Default event names for MCP communication
 */
const DEFAULT_SEND_EVENT = 'mcp:response';
const DEFAULT_RECEIVE_EVENT = 'mcp:request';

/**
 * EventEmitter-based transport adapter.
 *
 * @example Basic usage with SimpleEmitter
 * ```typescript
 * import { createSimpleEmitter, EventTransportAdapter } from '@frontmcp/browser';
 *
 * const emitter = createSimpleEmitter();
 * const transport = new EventTransportAdapter(emitter);
 *
 * await transport.connect();
 *
 * transport.onMessage(async (message) => {
 *   console.log('Received:', message);
 * });
 * ```
 *
 * @example Two-way communication
 * ```typescript
 * const emitter = createSimpleEmitter();
 *
 * // Server side
 * const serverTransport = new EventTransportAdapter(emitter, {
 *   sendEvent: 'mcp:response',
 *   receiveEvent: 'mcp:request',
 * });
 *
 * // Client side (swapped events)
 * const clientTransport = new EventTransportAdapter(emitter, {
 *   sendEvent: 'mcp:request',
 *   receiveEvent: 'mcp:response',
 * });
 * ```
 */
export class EventTransportAdapter implements BrowserTransport {
  private _connectionState: BrowserConnectionState = 'disconnected';
  private readonly sessionId: string;
  private readonly sendEvent: string;
  private readonly receiveEvent: string;
  private messageHandlers = new Set<BrowserMessageHandler>();
  private errorHandlers = new Set<(error: Error) => void>();
  private closeHandlers = new Set<(reason?: string) => void>();
  private boundMessageHandler: ((...args: unknown[]) => void) | null = null;

  constructor(private readonly emitter: MinimalEventEmitter, options: EventTransportOptions = {}) {
    this.sessionId = generateUUID();
    this.sendEvent = options.sendEvent ?? DEFAULT_SEND_EVENT;
    this.receiveEvent = options.receiveEvent ?? DEFAULT_RECEIVE_EVENT;
  }

  get connectionState(): BrowserConnectionState {
    return this._connectionState;
  }

  /**
   * Get session ID for this transport
   */
  getSessionId(): string {
    return this.sessionId;
  }

  async connect(): Promise<void> {
    if (this._connectionState === 'connected') {
      return;
    }

    this._connectionState = 'connecting';

    try {
      // Set up message listener
      this.boundMessageHandler = (...args: unknown[]) => {
        const message = args[0] as JSONRPCMessage;
        this.handleIncomingMessage(message);
      };

      this.emitter.on(this.receiveEvent, this.boundMessageHandler);
      this._connectionState = 'connected';
    } catch (error) {
      this._connectionState = 'error';
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._connectionState !== 'connected') {
      throw new Error('Transport not connected');
    }

    try {
      this.emitter.emit(this.sendEvent, message);
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  destroy(reason?: string): void {
    if (this._connectionState === 'disconnected') {
      return;
    }

    // Remove message listener
    if (this.boundMessageHandler) {
      this.emitter.off(this.receiveEvent, this.boundMessageHandler);
      this.boundMessageHandler = null;
    }

    this._connectionState = 'disconnected';

    // Notify close handlers
    for (const handler of this.closeHandlers) {
      try {
        handler(reason);
      } catch {
        // Ignore errors in close handlers
      }
    }

    // Clear all handlers
    this.messageHandlers.clear();
    this.errorHandlers.clear();
    this.closeHandlers.clear();
  }

  onMessage(handler: BrowserMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler);
    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  onClose(handler: (reason?: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  private async handleIncomingMessage(message: JSONRPCMessage): Promise<void> {
    for (const handler of this.messageHandlers) {
      try {
        const response = await handler(message);
        if (response) {
          await this.send(response);
        }
      } catch (error) {
        this.emitError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch {
        // Ignore errors in error handlers
      }
    }
  }
}

/**
 * Type guard for JSON-RPC request
 */
export function isJSONRPCRequest(message: JSONRPCMessage): message is JSONRPCRequest {
  return 'method' in message && 'id' in message;
}

/**
 * Type guard for JSON-RPC response
 */
export function isJSONRPCResponse(message: JSONRPCMessage): message is JSONRPCResponse {
  return ('result' in message || 'error' in message) && 'id' in message && !('method' in message);
}

/**
 * Type guard for JSON-RPC notification
 */
export function isJSONRPCNotification(message: JSONRPCMessage): message is JSONRPCNotification {
  return 'method' in message && !('id' in message);
}
