// file: libs/browser/src/transport/postmessage-transport.adapter.ts
/**
 * PostMessage-based transport adapter for browser MCP communication.
 *
 * This adapter enables MCP communication through the postMessage API,
 * making it ideal for cross-origin iframe communication, Web Workers,
 * ServiceWorkers, and any scenario requiring cross-context messaging.
 */

import { generateUUID } from '@frontmcp/sdk/core';
import type {
  BrowserTransport,
  BrowserConnectionState,
  BrowserMessageHandler,
  PostMessageTransportOptions,
  PostMessageTarget,
  JSONRPCMessage,
} from './transport.interface';

/**
 * Default message type for MCP postMessage communication
 */
const DEFAULT_MESSAGE_TYPE = 'mcp:message';

/**
 * Envelope for postMessage communication
 */
interface PostMessageEnvelope {
  type: string;
  sessionId: string;
  payload: JSONRPCMessage;
}

/**
 * PostMessage-based transport adapter.
 *
 * @example Communication with iframe
 * ```typescript
 * const iframe = document.querySelector('iframe');
 * const transport = new PostMessageTransportAdapter(iframe.contentWindow, {
 *   targetOrigin: 'https://trusted-origin.com',
 *   allowedOrigins: ['https://trusted-origin.com'],
 * });
 *
 * await transport.connect();
 * ```
 *
 * @example Communication with Web Worker
 * ```typescript
 * const worker = new Worker('mcp-worker.js');
 * const transport = new PostMessageTransportAdapter(worker);
 *
 * await transport.connect();
 * ```
 *
 * @example Bidirectional iframe communication (parent side)
 * ```typescript
 * // In parent window
 * const parentTransport = new PostMessageTransportAdapter(iframe.contentWindow, {
 *   targetOrigin: '*',
 *   allowedOrigins: ['*'],
 * });
 *
 * // In iframe
 * const childTransport = new PostMessageTransportAdapter(window.parent, {
 *   targetOrigin: '*',
 *   allowedOrigins: ['*'],
 * });
 * ```
 */
export class PostMessageTransportAdapter implements BrowserTransport {
  private _connectionState: BrowserConnectionState = 'disconnected';
  private readonly sessionId: string;
  private readonly messageType: string;
  private readonly targetOrigin: string;
  private readonly allowedOrigins: (string | RegExp)[];
  private messageHandlers = new Set<BrowserMessageHandler>();
  private errorHandlers = new Set<(error: Error) => void>();
  private closeHandlers = new Set<(reason?: string) => void>();
  private boundMessageHandler: ((event: MessageEvent) => void) | null = null;
  private messageSource: EventTarget;

  constructor(private readonly target: PostMessageTarget, options: PostMessageTransportOptions = {}) {
    this.sessionId = generateUUID();
    this.messageType = options.messageType ?? DEFAULT_MESSAGE_TYPE;
    this.targetOrigin = options.targetOrigin ?? '*';
    this.allowedOrigins = options.allowedOrigins ?? ['*'];

    // Determine where to listen for messages
    this.messageSource = this.getMessageSource();
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
      this.boundMessageHandler = (event: MessageEvent) => {
        this.handleMessageEvent(event);
      };

      this.messageSource.addEventListener('message', this.boundMessageHandler as EventListener);
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

    const envelope: PostMessageEnvelope = {
      type: this.messageType,
      sessionId: this.sessionId,
      payload: message,
    };

    try {
      this.postMessageToTarget(envelope);
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
      this.messageSource.removeEventListener('message', this.boundMessageHandler as EventListener);
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

  /**
   * Determine where to listen for incoming messages.
   * For Windows we listen on self (window), for Workers we listen on the worker itself.
   */
  private getMessageSource(): EventTarget {
    // If target is a Window, listen on the current window (self)
    if (typeof self !== 'undefined' && 'Window' in self && this.target instanceof Window) {
      return self;
    }
    // For Workers, MessagePorts, etc., listen on the target itself
    return this.target as EventTarget;
  }

  /**
   * Post message to the target with appropriate method.
   */
  private postMessageToTarget(envelope: PostMessageEnvelope): void {
    // Window target requires origin parameter
    if (typeof self !== 'undefined' && 'Window' in self && this.target instanceof Window) {
      this.target.postMessage(envelope, this.targetOrigin);
      return;
    }

    // Worker, MessagePort, ServiceWorker
    (this.target as Worker | MessagePort).postMessage(envelope);
  }

  /**
   * Handle incoming message events.
   */
  private handleMessageEvent(event: MessageEvent): void {
    // Validate origin for Window targets
    if (!this.isOriginAllowed(event.origin)) {
      return;
    }

    // Validate message structure
    const data = event.data;
    if (!this.isValidEnvelope(data)) {
      return;
    }

    // Filter by message type
    if (data.type !== this.messageType) {
      return;
    }

    // Process the message
    this.handleIncomingMessage(data.payload);
  }

  /**
   * Check if the origin is allowed.
   */
  private isOriginAllowed(origin: string): boolean {
    for (const allowed of this.allowedOrigins) {
      if (allowed === '*') {
        return true;
      }
      if (typeof allowed === 'string' && allowed === origin) {
        return true;
      }
      if (allowed instanceof RegExp && allowed.test(origin)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validate that data is a valid PostMessage envelope.
   */
  private isValidEnvelope(data: unknown): data is PostMessageEnvelope {
    if (typeof data !== 'object' || data === null) {
      return false;
    }
    const envelope = data as Record<string, unknown>;
    return (
      typeof envelope['type'] === 'string' &&
      typeof envelope['sessionId'] === 'string' &&
      typeof envelope['payload'] === 'object' &&
      envelope['payload'] !== null
    );
  }

  /**
   * Process incoming MCP message.
   */
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
