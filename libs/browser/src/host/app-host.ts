// file: libs/browser/src/host/app-host.ts
/**
 * App Host implementation for embedding MCP-powered applications.
 */

import { generateUUID } from '@frontmcp/sdk/core';
import type {
  AppHost,
  AppHostOptions,
  AppLoadConfig,
  LoadedApp,
  LoadedAppState,
  AppHostEvent,
  AppEventHandler,
  AuthContext,
  SandboxPermission,
  ChildMessage,
  ReadResourceResult,
  GetPromptResult,
  ServerInfo,
} from './types';
import { AppLoadError, AppConnectionError, AppTimeoutError, OriginNotAllowedError } from './types';

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_SANDBOX: SandboxPermission[] = ['allow-scripts'];
const DEFAULT_CONNECTION_TIMEOUT = 30000;

// =============================================================================
// Loaded App Implementation
// =============================================================================

class LoadedAppImpl implements LoadedApp {
  private _state: LoadedAppState = 'loading';
  private _serverInfo?: ServerInfo;
  private _messageHandlers: Set<(type: string, payload: unknown) => void> = new Set();
  private _pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }> =
    new Map();

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly iframe: HTMLIFrameElement,
    private readonly allowedOrigins: string[],
    private readonly connectionTimeout: number,
    private readonly authContext?: AuthContext,
    private readonly onStateChange?: (state: LoadedAppState) => void,
  ) {
    this.setupMessageListener();
  }

  get state(): LoadedAppState {
    return this._state;
  }

  get serverInfo(): ServerInfo | undefined {
    return this._serverInfo;
  }

  private setState(state: LoadedAppState): void {
    this._state = state;
    this.onStateChange?.(state);
  }

  private setupMessageListener(): void {
    window.addEventListener('message', this.handleMessage);
  }

  private handleMessage = (event: MessageEvent): void => {
    // Validate origin
    if (this.allowedOrigins.length > 0 && !this.allowedOrigins.includes(event.origin)) {
      return;
    }

    // Check if message is from our iframe
    if (event.source !== this.iframe.contentWindow) {
      return;
    }

    const message = event.data as ChildMessage;
    if (!message || typeof message !== 'object' || !message.type) {
      return;
    }

    switch (message.type) {
      case 'app:ready':
        this._serverInfo = message.serverInfo;
        this.setState('ready');
        break;

      case 'mcp:response':
        this.handleMcpResponse(message.id, message.result, message.error);
        break;

      case 'mcp:notification':
        // Handle MCP notifications if needed
        break;

      case 'app:resize':
        this.handleResize(message.width, message.height);
        break;

      case 'app:error':
        console.error('[AppHost] App error:', message.error);
        this.setState('error');
        break;

      case 'custom':
        this.notifyMessageHandlers('custom', message.payload);
        break;
    }
  };

  private handleMcpResponse(id: string, result?: unknown, error?: unknown): void {
    const pending = this._pendingRequests.get(id);
    if (!pending) {
      return;
    }

    this._pendingRequests.delete(id);

    if (error) {
      pending.reject(new Error(typeof error === 'string' ? error : JSON.stringify(error)));
    } else {
      pending.resolve(result);
    }
  }

  private handleResize(width: number, height: number): void {
    this.iframe.style.width = `${width}px`;
    this.iframe.style.height = `${height}px`;
  }

  private notifyMessageHandlers(type: string, payload: unknown): void {
    for (const handler of this._messageHandlers) {
      try {
        handler(type, payload);
      } catch (error) {
        console.error('[AppHost] Message handler error:', error);
      }
    }
  }

  private sendMessage(message: unknown): void {
    if (!this.iframe.contentWindow) {
      throw new AppConnectionError('Iframe content window not available', this.id);
    }

    const targetOrigin = this.allowedOrigins.length > 0 ? this.allowedOrigins[0] : '*';
    this.iframe.contentWindow.postMessage(message, targetOrigin);
  }

  private async sendMcpRequest(method: string, params?: unknown): Promise<unknown> {
    const id = generateUUID();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new AppTimeoutError(`Request timed out: ${method}`, this.id));
      }, this.connectionTimeout);

      this._pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });

      this.sendMessage({
        type: 'mcp:request',
        id,
        method,
        params,
      });
    });
  }

  async connect(): Promise<void> {
    if (this._state === 'connected') {
      return;
    }

    if (this._state !== 'ready') {
      // Wait for app to be ready
      await this.waitForReady();
    }

    // Send MCP initialize request
    await this.sendMcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: {
        name: 'FrontMCP AppHost',
        version: '1.0.0',
      },
      capabilities: {},
    });

    this.setState('connected');
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._state === 'ready' || this._state === 'connected') {
        resolve();
        return;
      }

      const timeoutId = setTimeout(() => {
        reject(new AppTimeoutError('Timeout waiting for app to be ready', this.id));
      }, this.connectionTimeout);

      const checkState = () => {
        if (this._state === 'ready' || this._state === 'connected') {
          clearTimeout(timeoutId);
          resolve();
        } else if (this._state === 'error') {
          clearTimeout(timeoutId);
          reject(new AppConnectionError('App entered error state', this.id));
        } else {
          setTimeout(checkState, 100);
        }
      };

      checkState();
    });
  }

  async disconnect(): Promise<void> {
    if (this._state === 'disconnected') {
      return;
    }

    this._pendingRequests.clear();
    window.removeEventListener('message', this.handleMessage);
    this.setState('disconnected');
  }

  async callTool<T>(name: string, args: unknown): Promise<T> {
    if (this._state !== 'connected') {
      throw new AppConnectionError('App not connected', this.id);
    }

    const result = await this.sendMcpRequest('tools/call', { name, arguments: args });
    return result as T;
  }

  async readResource(uri: string): Promise<ReadResourceResult> {
    if (this._state !== 'connected') {
      throw new AppConnectionError('App not connected', this.id);
    }

    const result = await this.sendMcpRequest('resources/read', { uri });
    return result as ReadResourceResult;
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    if (this._state !== 'connected') {
      throw new AppConnectionError('App not connected', this.id);
    }

    const result = await this.sendMcpRequest('prompts/get', { name, arguments: args });
    return result as GetPromptResult;
  }

  postMessage(type: string, payload: unknown): void {
    this.sendMessage({ type: 'custom', messageType: type, payload });
  }

  onMessage(handler: (type: string, payload: unknown) => void): () => void {
    this._messageHandlers.add(handler);
    return () => this._messageHandlers.delete(handler);
  }

  /**
   * Send initial data and auth context to the app
   */
  sendInitData(initialData?: unknown): void {
    this.sendMessage({
      type: 'app:init',
      data: initialData,
      auth: this.authContext,
    });
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    window.removeEventListener('message', this.handleMessage);
    this._pendingRequests.clear();
    this._messageHandlers.clear();
  }
}

// =============================================================================
// App Host Implementation
// =============================================================================

class AppHostImpl implements AppHost {
  private apps: Map<string, LoadedAppImpl> = new Map();
  private eventHandlers: Map<AppHostEvent, Set<AppEventHandler>> = new Map();
  private authContext?: AuthContext;

  constructor(private readonly options: AppHostOptions) {
    this.authContext = options.authContext;
  }

  async load(config: AppLoadConfig): Promise<LoadedApp> {
    const id = config.id || generateUUID();
    const name = config.name || `App-${id.slice(0, 8)}`;

    // Validate origin if allowedOrigins is specified
    if (this.options.allowedOrigins && this.options.allowedOrigins.length > 0) {
      try {
        const url = new URL(config.src);
        if (!this.options.allowedOrigins.includes(url.origin)) {
          throw new OriginNotAllowedError(url.origin);
        }
      } catch (error) {
        if (error instanceof OriginNotAllowedError) {
          throw error;
        }
        throw new AppLoadError(`Invalid URL: ${config.src}`, config.src);
      }
    }

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.id = `frontmcp-app-${id}`;
    iframe.src = config.src;

    // Set sandbox permissions
    const sandboxPerms = config.sandbox || this.options.sandbox || DEFAULT_SANDBOX;
    iframe.sandbox.add(...sandboxPerms);

    // Set dimensions
    if (config.width) {
      iframe.style.width = typeof config.width === 'number' ? `${config.width}px` : config.width;
    }
    if (config.height) {
      iframe.style.height = typeof config.height === 'number' ? `${config.height}px` : config.height;
    }

    // Apply default styles
    if (this.options.style) {
      Object.assign(iframe.style, this.options.style);
    }

    // Set additional attributes
    if (config.attributes) {
      for (const [key, value] of Object.entries(config.attributes)) {
        iframe.setAttribute(key, value);
      }
    }

    // Create loaded app instance
    const loadedApp = new LoadedAppImpl(
      id,
      name,
      iframe,
      this.options.allowedOrigins || [],
      this.options.connectionTimeout || DEFAULT_CONNECTION_TIMEOUT,
      this.authContext,
      (state) => {
        switch (state) {
          case 'ready':
            this.emit('app:ready', loadedApp);
            break;
          case 'connected':
            this.emit('app:connected', loadedApp);
            break;
          case 'error':
            this.emit('app:error', loadedApp);
            break;
          case 'disconnected':
            this.emit('app:disconnected', loadedApp);
            break;
        }
      },
    );

    // Add to container
    this.options.container.appendChild(iframe);
    this.apps.set(id, loadedApp);

    // Wait for iframe to load
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new AppLoadError('Iframe load timeout', config.src));
      }, this.options.connectionTimeout || DEFAULT_CONNECTION_TIMEOUT);

      iframe.onload = () => {
        clearTimeout(timeoutId);
        loadedApp.sendInitData(config.initialData);
        resolve();
      };

      iframe.onerror = () => {
        clearTimeout(timeoutId);
        reject(new AppLoadError('Failed to load iframe', config.src));
      };
    });

    this.emit('app:loaded', loadedApp);

    // Auto-connect if enabled
    if (config.autoConnect !== false) {
      await loadedApp.connect();
    }

    return loadedApp;
  }

  async unload(appId: string): Promise<void> {
    const app = this.apps.get(appId);
    if (!app) {
      return;
    }

    await app.disconnect();
    app.destroy();
    app.iframe.remove();
    this.apps.delete(appId);
  }

  async unloadAll(): Promise<void> {
    const appIds = Array.from(this.apps.keys());
    await Promise.all(appIds.map((id) => this.unload(id)));
  }

  get(appId: string): LoadedApp | undefined {
    return this.apps.get(appId);
  }

  list(): LoadedApp[] {
    return Array.from(this.apps.values());
  }

  on(event: AppHostEvent, handler: AppEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => this.eventHandlers.get(event)?.delete(handler);
  }

  updateAuthContext(context: Partial<AuthContext>): void {
    this.authContext = { ...this.authContext, ...context };

    // Notify all loaded apps
    for (const app of this.apps.values()) {
      app.postMessage('auth:refresh', { token: context.token });
    }
  }

  async destroy(): Promise<void> {
    await this.unloadAll();
    this.eventHandlers.clear();
  }

  private emit(event: AppHostEvent, app: LoadedApp, data?: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(app, data);
        } catch (error) {
          console.error(`[AppHost] Error in ${event} handler:`, error);
        }
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an app host for embedding MCP-powered applications.
 */
export function createAppHost(options: AppHostOptions): AppHost {
  return new AppHostImpl(options);
}
