// file: libs/browser/src/transport/extension-transport.adapter.ts
/**
 * Chrome Extension Transport Adapter
 *
 * Provides MCP transport over Chrome extension messaging APIs.
 * Supports both content script <-> background communication and
 * external messaging for Claude Desktop integration.
 *
 * @example Background script usage
 * ```typescript
 * import { ExtensionServerTransport } from '@frontmcp/browser';
 *
 * const transport = new ExtensionServerTransport({
 *   mode: 'background',
 *   onClientConnect: (tabId) => console.log('Tab connected:', tabId),
 * });
 *
 * await transport.connect();
 * ```
 *
 * @example Content script usage
 * ```typescript
 * import { ExtensionServerTransport } from '@frontmcp/browser';
 *
 * const transport = new ExtensionServerTransport({
 *   mode: 'content-script',
 * });
 *
 * await transport.connect();
 * await transport.request('tools/list');
 * ```
 */

import { BrowserTransportAdapterBase, type BrowserTransportBaseOptions } from './browser-transport.base';
import type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse } from './transport.interface';

/**
 * Chrome extension types (subset of chrome.* APIs)
 * These are declared here to avoid dependency on @types/chrome
 */
interface ChromePort {
  name: string;
  sender?: {
    tab?: { id: number; url?: string };
    url?: string;
    id?: string;
  };
  onMessage: {
    addListener: (callback: (message: unknown) => void) => void;
    removeListener: (callback: (message: unknown) => void) => void;
  };
  onDisconnect: {
    addListener: (callback: () => void) => void;
    removeListener: (callback: () => void) => void;
  };
  postMessage: (message: unknown) => void;
  disconnect: () => void;
}

interface ChromeRuntime {
  connect: (connectInfo?: { name?: string }) => ChromePort;
  onConnect: {
    addListener: (callback: (port: ChromePort) => void) => void;
    removeListener: (callback: (port: ChromePort) => void) => void;
  };
  onConnectExternal?: {
    addListener: (callback: (port: ChromePort) => void) => void;
    removeListener: (callback: (port: ChromePort) => void) => void;
  };
  sendMessage?: (message: unknown) => Promise<unknown>;
  id?: string;
}

declare const chrome: {
  runtime: ChromeRuntime;
};

/**
 * Extension transport mode
 */
export type ExtensionTransportMode = 'background' | 'content-script' | 'external';

/**
 * Connected client information
 */
export interface ExtensionClient {
  /** Unique client ID */
  id: string;
  /** Tab ID if from content script */
  tabId?: number;
  /** Tab URL if available */
  url?: string;
  /** Extension ID if external */
  extensionId?: string;
  /** Port connection */
  port: ChromePort;
  /** Connection timestamp */
  connectedAt: Date;
}

/**
 * Extension transport adapter options
 */
export interface ExtensionTransportOptions extends BrowserTransportBaseOptions {
  /**
   * Transport mode:
   * - 'background': Running in extension background (listens for connections)
   * - 'content-script': Running in content script (connects to background)
   * - 'external': External messaging from another extension or web page
   */
  mode: ExtensionTransportMode;

  /**
   * Port name for chrome.runtime.connect
   * @default 'frontmcp'
   */
  portName?: string;

  /**
   * Allow external connections (only for background mode)
   * @default false
   */
  allowExternal?: boolean;

  /**
   * Callback when a client connects (background mode only)
   */
  onClientConnect?: (client: ExtensionClient) => void;

  /**
   * Callback when a client disconnects (background mode only)
   */
  onClientDisconnect?: (clientId: string) => void;

  /**
   * Target extension ID for external connections
   */
  targetExtensionId?: string;
}

/**
 * Chrome Extension Server Transport
 *
 * Enables MCP communication through Chrome extension messaging APIs.
 * Can run in background script (server mode) or content script (client mode).
 */
export class ExtensionServerTransport extends BrowserTransportAdapterBase {
  private readonly mode: ExtensionTransportMode;
  private readonly portName: string;
  private readonly allowExternal: boolean;
  private readonly onClientConnectCb?: (client: ExtensionClient) => void;
  private readonly onClientDisconnectCb?: (clientId: string) => void;
  private readonly targetExtensionId?: string;

  // For content-script mode: single port to background
  private port: ChromePort | null = null;

  // For background mode: multiple client ports
  private clients = new Map<string, ExtensionClient>();
  private clientIdCounter = 0;

  // Message handlers
  private messageHandlers: Array<(message: JSONRPCMessage, clientId?: string) => void | Promise<void>> = [];
  private connectListener: ((port: ChromePort) => void) | null = null;
  private externalConnectListener: ((port: ChromePort) => void) | null = null;
  private messageListener: ((message: unknown) => void) | null = null;
  private disconnectListener: (() => void) | null = null;

  constructor(options: ExtensionTransportOptions) {
    super(options);
    this.mode = options.mode;
    this.portName = options.portName ?? 'frontmcp';
    this.allowExternal = options.allowExternal ?? false;
    this.onClientConnectCb = options.onClientConnect;
    this.onClientDisconnectCb = options.onClientDisconnect;
    this.targetExtensionId = options.targetExtensionId;
  }

  /**
   * Get all connected clients (background mode only)
   */
  getClients(): ReadonlyMap<string, ExtensionClient> {
    return this.clients;
  }

  /**
   * Get client by ID
   */
  getClient(clientId: string): ExtensionClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Get client count
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Connect the transport
   */
  async connect(): Promise<void> {
    if (this.connectionState === 'connected') {
      return;
    }

    this.connectionState = 'connecting';

    try {
      // Check if Chrome extension APIs are available
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        throw new Error('Chrome extension APIs not available');
      }

      if (this.mode === 'background') {
        await this.connectAsBackground();
      } else if (this.mode === 'content-script') {
        await this.connectAsContentScript();
      } else if (this.mode === 'external') {
        await this.connectAsExternal();
      }

      await this.onConnect();
    } catch (error) {
      this.connectionState = 'disconnected';
      throw error;
    }
  }

  /**
   * Connect as background script (listen for connections)
   */
  private async connectAsBackground(): Promise<void> {
    // Listen for internal connections from content scripts
    this.connectListener = (port: ChromePort) => {
      if (port.name !== this.portName) {
        return;
      }
      this.handleClientConnection(port, 'internal');
    };

    chrome.runtime.onConnect.addListener(this.connectListener);

    // Optionally listen for external connections
    if (this.allowExternal && chrome.runtime.onConnectExternal) {
      this.externalConnectListener = (port: ChromePort) => {
        if (port.name !== this.portName) {
          return;
        }
        this.handleClientConnection(port, 'external');
      };

      chrome.runtime.onConnectExternal.addListener(this.externalConnectListener);
    }
  }

  /**
   * Handle new client connection
   */
  private handleClientConnection(port: ChromePort, source: 'internal' | 'external'): void {
    const clientId = `client-${++this.clientIdCounter}`;

    const client: ExtensionClient = {
      id: clientId,
      tabId: port.sender?.tab?.id,
      url: port.sender?.tab?.url ?? port.sender?.url,
      extensionId: source === 'external' ? port.sender?.id : undefined,
      port,
      connectedAt: new Date(),
    };

    this.clients.set(clientId, client);

    // Set up message handler for this client
    const messageHandler = (message: unknown) => {
      if (this.isValidMessage(message)) {
        this.handleMessage(message as JSONRPCMessage);
        // Also notify registered handlers with client context
        for (const handler of this.messageHandlers) {
          try {
            handler(message as JSONRPCMessage, clientId);
          } catch (err) {
            this.logger.error('Message handler error', err);
          }
        }
      }
    };

    const disconnectHandler = () => {
      this.clients.delete(clientId);
      port.onMessage.removeListener(messageHandler);
      port.onDisconnect.removeListener(disconnectHandler);
      this.onClientDisconnectCb?.(clientId);
    };

    port.onMessage.addListener(messageHandler);
    port.onDisconnect.addListener(disconnectHandler);

    this.onClientConnectCb?.(client);
  }

  /**
   * Connect as content script
   */
  private async connectAsContentScript(): Promise<void> {
    this.port = chrome.runtime.connect({ name: this.portName });

    this.messageListener = (message: unknown) => {
      if (this.isValidMessage(message)) {
        this.handleMessage(message as JSONRPCMessage);
      }
    };

    this.disconnectListener = () => {
      this.connectionState = 'disconnected';
      this.port = null;
    };

    this.port.onMessage.addListener(this.messageListener);
    this.port.onDisconnect.addListener(this.disconnectListener);
  }

  /**
   * Connect to external extension
   */
  private async connectAsExternal(): Promise<void> {
    if (!this.targetExtensionId) {
      throw new Error('targetExtensionId required for external mode');
    }

    // For external connections, we'd need chrome.runtime.connect with extensionId
    // This is a simplified implementation; full external messaging may need
    // chrome.runtime.sendMessage for one-shot messages
    throw new Error('External mode not yet fully implemented');
  }

  /**
   * Validate incoming message
   */
  private isValidMessage(message: unknown): boolean {
    if (!message || typeof message !== 'object') {
      return false;
    }
    const msg = message as Record<string, unknown>;
    return msg['jsonrpc'] === '2.0' && ('method' in msg || 'result' in msg || 'error' in msg);
  }

  /**
   * Send message through the transport
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (this.mode === 'background') {
      // In background mode, we need to specify target client
      // For now, broadcast to all clients
      for (const client of this.clients.values()) {
        try {
          client.port.postMessage(message);
        } catch (err) {
          this.logger.warn('Failed to send to client', { clientId: client.id, error: err });
        }
      }
    } else {
      // Content script mode: send through port
      if (!this.port) {
        throw new Error('Not connected');
      }
      this.port.postMessage(message);
    }
  }

  /**
   * Send message to specific client (background mode only)
   */
  sendToClient(clientId: string, message: JSONRPCMessage): void {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`Client not found: ${clientId}`);
    }
    client.port.postMessage(message);
  }

  /**
   * Send message to specific tab (background mode only)
   */
  sendToTab(tabId: number, message: JSONRPCMessage): void {
    for (const client of this.clients.values()) {
      if (client.tabId === tabId) {
        client.port.postMessage(message);
        return;
      }
    }
    throw new Error(`No client found for tab: ${tabId}`);
  }

  /**
   * Respond to a specific request
   */
  respond(request: JSONRPCRequest, result: unknown, clientId?: string): void {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };

    if (clientId && this.mode === 'background') {
      this.sendToClient(clientId, response);
    } else {
      this.send(response);
    }
  }

  /**
   * Respond with error
   */
  respondError(request: JSONRPCRequest, code: number, message: string, data?: unknown, clientId?: string): void {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: request.id,
      error: { code, message, data },
    };

    if (clientId && this.mode === 'background') {
      this.sendToClient(clientId, response);
    } else {
      this.send(response);
    }
  }

  /**
   * Register a message handler
   */
  onMessage(handler: (message: JSONRPCMessage, clientId?: string) => void | Promise<void>): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index >= 0) {
        this.messageHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Disconnect a specific client (background mode only)
   */
  disconnectClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.port.disconnect();
      this.clients.delete(clientId);
      this.onClientDisconnectCb?.(clientId);
    }
  }

  /**
   * Destroy the transport
   */
  async destroy(reason?: string): Promise<void> {
    // Clean up listeners
    if (this.connectListener && chrome?.runtime?.onConnect) {
      chrome.runtime.onConnect.removeListener(this.connectListener);
    }

    if (this.externalConnectListener && chrome?.runtime?.onConnectExternal) {
      chrome.runtime.onConnectExternal.removeListener(this.externalConnectListener);
    }

    // Disconnect all clients (background mode)
    for (const client of this.clients.values()) {
      try {
        client.port.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    this.clients.clear();

    // Disconnect port (content script mode)
    if (this.port) {
      if (this.messageListener) {
        this.port.onMessage.removeListener(this.messageListener);
      }
      if (this.disconnectListener) {
        this.port.onDisconnect.removeListener(this.disconnectListener);
      }
      try {
        this.port.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.port = null;
    }

    this.messageHandlers = [];

    await this.onDestroy(reason);
  }
}
