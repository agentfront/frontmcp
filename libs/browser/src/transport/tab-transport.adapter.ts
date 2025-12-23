// file: libs/browser/src/transport/tab-transport.adapter.ts
/**
 * Tab Server Transport
 *
 * Maintains MCP connections across page navigations within a browser tab.
 * Uses Chrome extension storage and messaging to persist connection state
 * and automatically reconnect when pages reload or navigate.
 *
 * @example Background script setup
 * ```typescript
 * import { TabServerTransport } from '@frontmcp/browser';
 *
 * const transport = new TabServerTransport({
 *   mode: 'server',
 *   sessionRecovery: true,
 * });
 *
 * await transport.connect();
 *
 * // Handle reconnections automatically
 * transport.onTabReconnect((tabId, session) => {
 *   console.log(`Tab ${tabId} reconnected with session ${session.id}`);
 * });
 * ```
 *
 * @example Content script setup
 * ```typescript
 * import { TabServerTransport } from '@frontmcp/browser';
 *
 * const transport = new TabServerTransport({
 *   mode: 'client',
 *   autoReconnect: true,
 * });
 *
 * await transport.connect();
 * // Transport will reconnect automatically after page navigation
 * ```
 */

import { generateUUID } from '@frontmcp/sdk/core';
import { BrowserTransportAdapterBase, type BrowserTransportBaseOptions } from './browser-transport.base';
import type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse } from './transport.interface';
import type { PlatformLogger } from '../platform';

/**
 * Tab session state (persisted across navigations)
 */
export interface TabSession {
  /** Session ID */
  id: string;
  /** Tab ID */
  tabId: number;
  /** Session created timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Page URL at session start */
  originUrl: string;
  /** Current page URL */
  currentUrl: string;
  /** Session state (custom data) */
  state: Record<string, unknown>;
  /** Registered tools for this session */
  tools: string[];
  /** Registered resources for this session */
  resources: string[];
  /** Active subscriptions */
  subscriptions: string[];
}

/**
 * Chrome extension types
 */
interface ChromePort {
  name: string;
  sender?: {
    tab?: { id: number; url?: string };
    url?: string;
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

interface ChromeStorage {
  session: {
    get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
    remove: (keys: string | string[]) => Promise<void>;
  };
}

interface ChromeTabs {
  get: (tabId: number) => Promise<{ id: number; url?: string }>;
  onRemoved: {
    addListener: (callback: (tabId: number) => void) => void;
    removeListener: (callback: (tabId: number) => void) => void;
  };
}

declare const chrome: {
  runtime: {
    connect: (connectInfo?: { name?: string }) => ChromePort;
    onConnect: {
      addListener: (callback: (port: ChromePort) => void) => void;
      removeListener: (callback: (port: ChromePort) => void) => void;
    };
  };
  storage: ChromeStorage;
  tabs: ChromeTabs;
};

/**
 * Tab transport mode
 */
export type TabTransportMode = 'server' | 'client';

/**
 * Tab transport options
 */
export interface TabTransportOptions extends BrowserTransportBaseOptions {
  /**
   * Transport mode:
   * - 'server': Running in background script, manages multiple tab sessions
   * - 'client': Running in content script, connects to background
   */
  mode: TabTransportMode;

  /**
   * Enable session recovery across page navigations
   * @default true
   */
  sessionRecovery?: boolean;

  /**
   * Auto-reconnect on disconnect
   * @default true
   */
  autoReconnect?: boolean;

  /**
   * Reconnect delay in milliseconds
   * @default 1000
   */
  reconnectDelay?: number;

  /**
   * Maximum reconnect attempts
   * @default 3
   */
  maxReconnectAttempts?: number;

  /**
   * Session timeout in milliseconds (0 = no timeout)
   * @default 3600000 (1 hour)
   */
  sessionTimeout?: number;

  /**
   * Port name for chrome.runtime.connect
   * @default 'frontmcp-tab'
   */
  portName?: string;

  /**
   * Session storage key prefix
   * @default 'frontmcp_session_'
   */
  storageKeyPrefix?: string;
}

/**
 * Tab server transport for cross-navigation persistence
 */
export class TabServerTransport extends BrowserTransportAdapterBase {
  private readonly mode: TabTransportMode;
  private readonly sessionRecovery: boolean;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelay: number;
  private readonly maxReconnectAttempts: number;
  private readonly sessionTimeout: number;
  private readonly portName: string;
  private readonly storageKeyPrefix: string;

  // Server mode: manage multiple tab sessions
  private tabSessions = new Map<number, TabSession>();
  private tabPorts = new Map<number, ChromePort>();

  // Client mode: single connection to background
  private port: ChromePort | null = null;
  private currentSession: TabSession | null = null;
  private reconnectAttempts = 0;

  // Event handlers
  private connectListener: ((port: ChromePort) => void) | null = null;
  private tabRemovedListener: ((tabId: number) => void) | null = null;
  private messageHandlers: Array<(message: JSONRPCMessage, tabId?: number) => void | Promise<void>> = [];
  private reconnectHandlers: Array<(tabId: number, session: TabSession) => void> = [];
  private disconnectHandlers: Array<(tabId: number) => void> = [];

  constructor(options: TabTransportOptions) {
    super(options);
    this.mode = options.mode;
    this.sessionRecovery = options.sessionRecovery ?? true;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
    this.sessionTimeout = options.sessionTimeout ?? 3600000;
    this.portName = options.portName ?? 'frontmcp-tab';
    this.storageKeyPrefix = options.storageKeyPrefix ?? 'frontmcp_session_';
  }

  /**
   * Get all active tab sessions (server mode)
   */
  getSessions(): ReadonlyMap<number, TabSession> {
    return this.tabSessions;
  }

  /**
   * Get session for a specific tab
   */
  getSession(tabId: number): TabSession | undefined {
    return this.tabSessions.get(tabId);
  }

  /**
   * Get current session (client mode)
   */
  getCurrentSession(): TabSession | null {
    return this.currentSession;
  }

  /**
   * Get active tab count
   */
  get tabCount(): number {
    return this.tabSessions.size;
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
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        throw new Error('Chrome extension APIs not available');
      }

      if (this.mode === 'server') {
        await this.connectAsServer();
      } else {
        await this.connectAsClient();
      }

      await this.onConnect();
    } catch (error) {
      this.connectionState = 'disconnected';
      throw error;
    }
  }

  /**
   * Connect as server (background script)
   */
  private async connectAsServer(): Promise<void> {
    // Listen for tab connections
    this.connectListener = (port: ChromePort) => {
      if (port.name !== this.portName) {
        return;
      }
      this.handleTabConnection(port);
    };

    chrome.runtime.onConnect.addListener(this.connectListener);

    // Listen for tab removal to clean up sessions
    this.tabRemovedListener = (tabId: number) => {
      this.handleTabRemoved(tabId);
    };

    chrome.tabs.onRemoved.addListener(this.tabRemovedListener);

    // Load existing sessions from storage if recovery is enabled
    if (this.sessionRecovery) {
      await this.loadExistingSessions();
    }
  }

  /**
   * Handle new tab connection
   */
  private async handleTabConnection(port: ChromePort): Promise<void> {
    const tabId = port.sender?.tab?.id;
    if (!tabId) {
      this.logger.warn('Port connected without tab ID');
      return;
    }

    const url = port.sender?.tab?.url ?? port.sender?.url ?? '';

    // Check for existing session (reconnection)
    let session = this.tabSessions.get(tabId);
    const isReconnect = !!session;

    if (session && this.sessionRecovery) {
      // Update session
      session.lastActivityAt = Date.now();
      session.currentUrl = url;
    } else {
      // Create new session
      session = {
        id: generateUUID(),
        tabId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        originUrl: url,
        currentUrl: url,
        state: {},
        tools: [],
        resources: [],
        subscriptions: [],
      };
      this.tabSessions.set(tabId, session);
    }

    // Store port
    this.tabPorts.set(tabId, port);

    // Set up message handler
    const messageHandler = (message: unknown) => {
      if (this.isValidMessage(message)) {
        session!.lastActivityAt = Date.now();
        this.handleMessage(message as JSONRPCMessage);

        for (const handler of this.messageHandlers) {
          try {
            handler(message as JSONRPCMessage, tabId);
          } catch (err) {
            this.logger.error('Message handler error', err);
          }
        }
      }
    };

    const disconnectHandler = () => {
      this.tabPorts.delete(tabId);
      port.onMessage.removeListener(messageHandler);
      port.onDisconnect.removeListener(disconnectHandler);

      // Don't remove session immediately - allow for reconnection
      if (this.sessionRecovery) {
        this.saveSessionToStorage(session!);
      } else {
        this.tabSessions.delete(tabId);
      }

      for (const handler of this.disconnectHandlers) {
        try {
          handler(tabId);
        } catch (err) {
          this.logger.error('Disconnect handler error', err);
        }
      }
    };

    port.onMessage.addListener(messageHandler);
    port.onDisconnect.addListener(disconnectHandler);

    // Persist session
    if (this.sessionRecovery) {
      await this.saveSessionToStorage(session);
    }

    // Notify reconnect handlers
    if (isReconnect) {
      for (const handler of this.reconnectHandlers) {
        try {
          handler(tabId, session);
        } catch (err) {
          this.logger.error('Reconnect handler error', err);
        }
      }
    }

    // Send session info to client
    port.postMessage({
      jsonrpc: '2.0',
      method: 'session/info',
      params: {
        sessionId: session.id,
        isReconnect,
        state: session.state,
      },
    });
  }

  /**
   * Handle tab removal
   */
  private async handleTabRemoved(tabId: number): Promise<void> {
    const port = this.tabPorts.get(tabId);
    if (port) {
      try {
        port.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }

    this.tabPorts.delete(tabId);
    this.tabSessions.delete(tabId);

    // Remove from storage
    if (this.sessionRecovery) {
      await this.removeSessionFromStorage(tabId);
    }
  }

  /**
   * Connect as client (content script)
   */
  private async connectAsClient(): Promise<void> {
    await this.attemptConnection();
  }

  /**
   * Attempt to connect to background
   */
  private async attemptConnection(): Promise<void> {
    this.port = chrome.runtime.connect({ name: this.portName });

    const messageHandler = (message: unknown) => {
      if (this.isValidMessage(message)) {
        const msg = message as JSONRPCMessage;

        // Handle session info message
        if ('method' in msg && msg.method === 'session/info') {
          const params = (msg as JSONRPCRequest).params as Record<string, unknown>;
          this.currentSession = {
            id: params['sessionId'] as string,
            tabId: 0, // Will be filled by server
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            originUrl: window.location.href,
            currentUrl: window.location.href,
            state: (params['state'] as Record<string, unknown>) ?? {},
            tools: [],
            resources: [],
            subscriptions: [],
          };
          return;
        }

        this.handleMessage(msg);
      }
    };

    const disconnectHandler = () => {
      this.connectionState = 'disconnected';
      this.port = null;

      if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => {
          this.attemptConnection().catch((err) => {
            this.logger.error('Reconnection failed', err);
          });
        }, this.reconnectDelay * this.reconnectAttempts);
      }
    };

    this.port.onMessage.addListener(messageHandler);
    this.port.onDisconnect.addListener(disconnectHandler);
  }

  /**
   * Validate message
   */
  private isValidMessage(message: unknown): boolean {
    if (!message || typeof message !== 'object') {
      return false;
    }
    const msg = message as Record<string, unknown>;
    return msg['jsonrpc'] === '2.0' && ('method' in msg || 'result' in msg || 'error' in msg);
  }

  /**
   * Load existing sessions from storage
   */
  private async loadExistingSessions(): Promise<void> {
    try {
      // Get all session keys - pass null to retrieve all stored items
      const result = await chrome.storage.session.get(null);

      for (const [key, value] of Object.entries(result)) {
        if (key.startsWith(this.storageKeyPrefix) && value) {
          const session = value as TabSession;

          // Check if session is expired
          if (this.sessionTimeout > 0) {
            const age = Date.now() - session.lastActivityAt;
            if (age > this.sessionTimeout) {
              await this.removeSessionFromStorage(session.tabId);
              continue;
            }
          }

          // Verify tab still exists
          try {
            await chrome.tabs.get(session.tabId);
            this.tabSessions.set(session.tabId, session);
          } catch {
            // Tab no longer exists
            await this.removeSessionFromStorage(session.tabId);
          }
        }
      }
    } catch (err) {
      this.logger.error('Failed to load sessions', err);
    }
  }

  /**
   * Save session to storage
   */
  private async saveSessionToStorage(session: TabSession): Promise<void> {
    try {
      const key = `${this.storageKeyPrefix}${session.tabId}`;
      await chrome.storage.session.set({ [key]: session });
    } catch (err) {
      this.logger.error('Failed to save session', err);
    }
  }

  /**
   * Remove session from storage
   */
  private async removeSessionFromStorage(tabId: number): Promise<void> {
    try {
      const key = `${this.storageKeyPrefix}${tabId}`;
      await chrome.storage.session.remove(key);
    } catch (err) {
      this.logger.error('Failed to remove session', err);
    }
  }

  /**
   * Update session state
   */
  async updateSessionState(tabId: number, state: Record<string, unknown>): Promise<void> {
    const session = this.tabSessions.get(tabId);
    if (session) {
      session.state = { ...session.state, ...state };
      session.lastActivityAt = Date.now();

      if (this.sessionRecovery) {
        await this.saveSessionToStorage(session);
      }
    }
  }

  /**
   * Send message through the transport
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (this.mode === 'server') {
      // Broadcast to all tabs
      for (const [tabId, port] of this.tabPorts) {
        try {
          port.postMessage(message);
        } catch (err) {
          this.logger.warn('Failed to send to tab', { tabId, error: err });
        }
      }
    } else {
      if (!this.port) {
        throw new Error('Not connected');
      }
      this.port.postMessage(message);
    }
  }

  /**
   * Send to specific tab (server mode)
   */
  sendToTab(tabId: number, message: JSONRPCMessage): void {
    const port = this.tabPorts.get(tabId);
    if (!port) {
      throw new Error(`Tab not connected: ${tabId}`);
    }
    port.postMessage(message);
  }

  /**
   * Register message handler
   */
  onMessage(handler: (message: JSONRPCMessage, tabId?: number) => void | Promise<void>): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index >= 0) {
        this.messageHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Register reconnect handler (server mode)
   */
  onTabReconnect(handler: (tabId: number, session: TabSession) => void): () => void {
    this.reconnectHandlers.push(handler);
    return () => {
      const index = this.reconnectHandlers.indexOf(handler);
      if (index >= 0) {
        this.reconnectHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Register disconnect handler
   */
  onTabDisconnect(handler: (tabId: number) => void): () => void {
    this.disconnectHandlers.push(handler);
    return () => {
      const index = this.disconnectHandlers.indexOf(handler);
      if (index >= 0) {
        this.disconnectHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Destroy the transport
   */
  async destroy(reason?: string): Promise<void> {
    // Clean up listeners
    if (this.connectListener && chrome?.runtime?.onConnect) {
      chrome.runtime.onConnect.removeListener(this.connectListener);
    }

    if (this.tabRemovedListener && chrome?.tabs?.onRemoved) {
      chrome.tabs.onRemoved.removeListener(this.tabRemovedListener);
    }

    // Disconnect all tabs (server mode)
    for (const port of this.tabPorts.values()) {
      try {
        port.disconnect();
      } catch {
        // Ignore
      }
    }
    this.tabPorts.clear();
    this.tabSessions.clear();

    // Disconnect port (client mode)
    if (this.port) {
      try {
        this.port.disconnect();
      } catch {
        // Ignore
      }
      this.port = null;
    }

    this.messageHandlers = [];
    this.reconnectHandlers = [];
    this.disconnectHandlers = [];

    await this.onDestroy(reason);
  }
}
