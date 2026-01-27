/**
 * MCP Apps (ext-apps) Message Handler
 *
 * Server-side handler for bidirectional communication with ext-apps widgets.
 * Processes JSON-RPC requests from widgets and routes them to appropriate handlers.
 *
 * @see https://github.com/modelcontextprotocol/ext-apps
 * @packageDocumentation
 */

import type { FrontMcpLogger } from '../common';
import type {
  ExtAppsCallServerToolParams,
  ExtAppsUpdateModelContextParams,
  ExtAppsOpenLinkParams,
  ExtAppsSetDisplayModeParams,
  ExtAppsCloseParams,
  ExtAppsLogParams,
  ExtAppsRegisterToolParams,
  ExtAppsUnregisterToolParams,
  ExtAppsJsonRpcRequest,
  ExtAppsJsonRpcResponse,
  ExtAppsHostCapabilities,
  ExtAppsInitializeParams,
  ExtAppsInitializeResult,
} from './ext-apps.types';
import { EXT_APPS_ERROR_CODES } from './ext-apps.types';

/**
 * Context for handling ext-apps messages.
 * Provides access to scope services for routing requests.
 */
export interface ExtAppsHandlerContext {
  /** Session ID for this widget connection */
  sessionId: string;
  /** Logger instance */
  logger: FrontMcpLogger;
  /** Call a tool by name */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Update model context (optional - host may not support) */
  updateModelContext?: (context: unknown, merge: boolean) => Promise<void>;
  /** Open a link (optional - host may not support) */
  openLink?: (url: string) => Promise<void>;
  /** Request display mode change (optional - host may not support) */
  setDisplayMode?: (mode: string) => Promise<void>;
  /** Close the widget (optional - host may not support) */
  close?: (reason?: string) => Promise<void>;
  /** Register a widget-defined tool (optional - host may not support) */
  registerTool?: (name: string, description: string, inputSchema: Record<string, unknown>) => Promise<void>;
  /** Unregister a widget-defined tool (optional - host may not support) */
  unregisterTool?: (name: string) => Promise<void>;
}

/**
 * Options for creating an ExtAppsMessageHandler.
 */
export interface ExtAppsMessageHandlerOptions {
  /** Handler context with routing capabilities */
  context: ExtAppsHandlerContext;
  /** Host capabilities to advertise */
  hostCapabilities?: ExtAppsHostCapabilities;
}

/**
 * Message handler for ext-apps widget-to-host JSON-RPC communication.
 *
 * Handles all JSON-RPC methods defined in the MCP Apps specification:
 * - ui/callServerTool - Proxy tool calls to the MCP server
 * - ui/updateModelContext - Update the model context with widget state
 * - ui/openLink - Request to open a URL
 * - ui/setDisplayMode - Request display mode change
 * - ui/close - Close the widget
 * - ui/log - Forward logs to server logger
 * - ui/registerTool - Register a widget-defined tool
 * - ui/unregisterTool - Unregister a widget-defined tool
 *
 * @example
 * ```typescript
 * import { ExtAppsMessageHandler } from '@frontmcp/sdk/ext-apps';
 *
 * const handler = new ExtAppsMessageHandler({
 *   context: {
 *     sessionId: 'session-123',
 *     logger: scopeLogger,
 *     callTool: async (name, args) => {
 *       // Route to tool call flow
 *       return scope.flows.run('tools:call-tool', { name, args });
 *     },
 *   },
 *   hostCapabilities: {
 *     serverToolProxy: true,
 *     logging: true,
 *   },
 * });
 *
 * // Handle incoming request
 * const response = await handler.handleRequest(request);
 * ```
 */
export class ExtAppsMessageHandler {
  private readonly context: ExtAppsHandlerContext;
  private readonly hostCapabilities: ExtAppsHostCapabilities;
  private readonly logger: FrontMcpLogger;

  constructor(options: ExtAppsMessageHandlerOptions) {
    this.context = options.context;
    this.hostCapabilities = options.hostCapabilities || {};
    this.logger = options.context.logger.child('ExtAppsMessageHandler');
  }

  /**
   * Get the host capabilities for this handler.
   */
  getHostCapabilities(): ExtAppsHostCapabilities {
    return { ...this.hostCapabilities };
  }

  /**
   * Handle a JSON-RPC request from a widget.
   *
   * @param request - The JSON-RPC request
   * @returns The JSON-RPC response
   */
  async handleRequest(request: ExtAppsJsonRpcRequest): Promise<ExtAppsJsonRpcResponse> {
    const { id, method, params } = request;

    this.logger.verbose(`handleRequest: method=${method}, id=${id}`);

    try {
      const result = await this.routeMethod(method, params);
      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = this.getErrorCode(error);

      this.logger.warn(`handleRequest: method=${method} failed: ${errorMessage}`);

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: errorCode,
          message: errorMessage,
          // Only include stack traces in development to avoid leaking internals in production
          data:
            process.env['NODE_ENV'] === 'development' && error instanceof Error ? { stack: error.stack } : undefined,
        },
      };
    }
  }

  /**
   * Route a method to its handler.
   */
  private async routeMethod(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      // Initialization
      case 'ui/initialize':
        return this.handleInitialize(params as ExtAppsInitializeParams);

      // Core methods
      case 'ui/callServerTool':
        return this.handleCallServerTool(params as ExtAppsCallServerToolParams);

      case 'ui/updateModelContext':
        return this.handleUpdateModelContext(params as ExtAppsUpdateModelContextParams);

      case 'ui/openLink':
        return this.handleOpenLink(params as ExtAppsOpenLinkParams);

      // Display and lifecycle
      case 'ui/setDisplayMode':
        return this.handleSetDisplayMode(params as ExtAppsSetDisplayModeParams);

      case 'ui/close':
        return this.handleClose(params as ExtAppsCloseParams);

      // Logging
      case 'ui/log':
        return this.handleLog(params as ExtAppsLogParams);

      // Widget-defined tools
      case 'ui/registerTool':
        return this.handleRegisterTool(params as ExtAppsRegisterToolParams);

      case 'ui/unregisterTool':
        return this.handleUnregisterTool(params as ExtAppsUnregisterToolParams);

      default:
        throw new ExtAppsMethodNotFoundError(`Unknown ext-apps method: ${method}`);
    }
  }

  /**
   * Handle ui/initialize - Protocol handshake with widget.
   * Returns host capabilities and initial context.
   */
  private handleInitialize(params: ExtAppsInitializeParams): ExtAppsInitializeResult {
    const { appInfo, protocolVersion } = params;

    this.logger.verbose(
      `handleInitialize: app=${appInfo?.name || 'unknown'} v${appInfo?.version || 'unknown'}, protocol=${protocolVersion}`,
    );

    // Return host capabilities and protocol acknowledgment
    return {
      hostCapabilities: this.hostCapabilities,
      protocolVersion: protocolVersion || '2024-11-05',
    };
  }

  /**
   * Handle ui/callServerTool - Route tool call to MCP server.
   */
  private async handleCallServerTool(params: ExtAppsCallServerToolParams): Promise<unknown> {
    if (!this.hostCapabilities.serverToolProxy) {
      throw new ExtAppsNotSupportedError('Server tool proxy not supported by host');
    }

    const { name, arguments: args = {} } = params;

    if (!name || typeof name !== 'string') {
      throw new ExtAppsInvalidParamsError('Tool name is required');
    }

    this.logger.verbose(`handleCallServerTool: tool=${name}`);

    return this.context.callTool(name, args);
  }

  /**
   * Handle ui/updateModelContext - Update model context with widget state.
   */
  private async handleUpdateModelContext(params: ExtAppsUpdateModelContextParams): Promise<void> {
    if (!this.hostCapabilities.modelContextUpdate) {
      throw new ExtAppsNotSupportedError('Model context update not advertised by host');
    }
    if (!this.context.updateModelContext) {
      throw new ExtAppsNotSupportedError('Model context update not supported by host');
    }

    const { context, merge = true } = params;

    this.logger.verbose(`handleUpdateModelContext: merge=${merge}`);

    await this.context.updateModelContext(context, merge);
  }

  /**
   * Handle ui/openLink - Request to open a URL.
   */
  private async handleOpenLink(params: ExtAppsOpenLinkParams): Promise<void> {
    if (!this.hostCapabilities.openLink) {
      throw new ExtAppsNotSupportedError('Open link not advertised by host');
    }
    if (!this.context.openLink) {
      throw new ExtAppsNotSupportedError('Open link not supported by host');
    }

    const { url } = params;

    if (!url || typeof url !== 'string') {
      throw new ExtAppsInvalidParamsError('URL is required');
    }

    // URL validation with scheme allowlist
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ExtAppsInvalidParamsError('Invalid URL format');
    }

    // Security: only allow safe URL schemes
    const allowedSchemes = ['http:', 'https:'];
    if (!allowedSchemes.includes(parsed.protocol)) {
      throw new ExtAppsInvalidParamsError(
        `URL scheme '${parsed.protocol}' not allowed. Only http: and https: are permitted.`,
      );
    }

    this.logger.verbose(`handleOpenLink: url=${url}`);

    await this.context.openLink(url);
  }

  /**
   * Handle ui/setDisplayMode - Request display mode change.
   */
  private async handleSetDisplayMode(params: ExtAppsSetDisplayModeParams): Promise<void> {
    const { mode } = params;

    if (!mode || !['inline', 'fullscreen', 'pip'].includes(mode)) {
      throw new ExtAppsInvalidParamsError('Invalid display mode. Must be inline, fullscreen, or pip');
    }

    // Check if host advertised support for this display mode
    if (this.hostCapabilities.displayModes && !this.hostCapabilities.displayModes.includes(mode)) {
      throw new ExtAppsNotSupportedError(`Display mode '${mode}' not advertised by host`);
    }

    if (!this.context.setDisplayMode) {
      throw new ExtAppsNotSupportedError('Display mode change not supported by host');
    }

    this.logger.verbose(`handleSetDisplayMode: mode=${mode}`);

    await this.context.setDisplayMode(mode);
  }

  /**
   * Handle ui/close - Close the widget.
   */
  private async handleClose(params: ExtAppsCloseParams): Promise<void> {
    if (!this.context.close) {
      throw new ExtAppsNotSupportedError('Widget close not supported by host');
    }

    const { reason } = params;

    this.logger.verbose(`handleClose: reason=${reason || 'none'}`);

    await this.context.close(reason);
  }

  /**
   * Handle ui/log - Forward logs to server logger.
   */
  private async handleLog(params: ExtAppsLogParams): Promise<void> {
    if (!this.hostCapabilities.logging) {
      throw new ExtAppsNotSupportedError('Logging not supported by host');
    }

    const { level, message, data } = params;

    if (!message || typeof message !== 'string') {
      throw new ExtAppsInvalidParamsError('Log message is required');
    }

    // Validate log level
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (level && !validLevels.includes(level)) {
      throw new ExtAppsInvalidParamsError(`Invalid log level '${level}'. Must be one of: ${validLevels.join(', ')}`);
    }

    const widgetLogger = this.logger.child(`Widget:${this.context.sessionId}`);

    switch (level) {
      case 'debug':
        widgetLogger.verbose(message, data);
        break;
      case 'info':
        widgetLogger.info(message, data);
        break;
      case 'warn':
        widgetLogger.warn(message, data);
        break;
      case 'error':
        widgetLogger.error(message, data);
        break;
      default:
        widgetLogger.info(message, data);
    }
  }

  /**
   * Handle ui/registerTool - Register a widget-defined tool.
   */
  private async handleRegisterTool(params: ExtAppsRegisterToolParams): Promise<void> {
    if (!this.hostCapabilities.widgetTools) {
      throw new ExtAppsNotSupportedError('Widget tools not advertised by host');
    }
    if (!this.context.registerTool) {
      throw new ExtAppsNotSupportedError('Widget tool registration not supported by host');
    }

    const { name, description, inputSchema } = params;

    if (!name || typeof name !== 'string') {
      throw new ExtAppsInvalidParamsError('Tool name is required');
    }

    if (!description || typeof description !== 'string') {
      throw new ExtAppsInvalidParamsError('Tool description is required');
    }

    if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
      throw new ExtAppsInvalidParamsError('Tool input schema must be a non-null object');
    }

    this.logger.verbose(`handleRegisterTool: name=${name}`);

    await this.context.registerTool(name, description, inputSchema);
  }

  /**
   * Handle ui/unregisterTool - Unregister a widget-defined tool.
   */
  private async handleUnregisterTool(params: ExtAppsUnregisterToolParams): Promise<void> {
    if (!this.hostCapabilities.widgetTools) {
      throw new ExtAppsNotSupportedError('Widget tools not advertised by host');
    }
    if (!this.context.unregisterTool) {
      throw new ExtAppsNotSupportedError('Widget tool unregistration not supported by host');
    }

    const { name } = params;

    if (!name || typeof name !== 'string') {
      throw new ExtAppsInvalidParamsError('Tool name is required');
    }

    this.logger.verbose(`handleUnregisterTool: name=${name}`);

    await this.context.unregisterTool(name);
  }

  /**
   * Get the appropriate error code for an error.
   */
  private getErrorCode(error: unknown): number {
    if (error instanceof ExtAppsMethodNotFoundError) {
      return EXT_APPS_ERROR_CODES.METHOD_NOT_FOUND;
    }
    if (error instanceof ExtAppsInvalidParamsError) {
      return EXT_APPS_ERROR_CODES.INVALID_PARAMS;
    }
    if (error instanceof ExtAppsNotSupportedError) {
      return EXT_APPS_ERROR_CODES.NOT_SUPPORTED;
    }
    if (error instanceof ExtAppsToolNotFoundError) {
      return EXT_APPS_ERROR_CODES.TOOL_NOT_FOUND;
    }
    return EXT_APPS_ERROR_CODES.INTERNAL_ERROR;
  }
}

// ============================================
// Error Classes
// ============================================

/**
 * Base class for ext-apps errors.
 */
export class ExtAppsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtAppsError';
  }
}

/**
 * Method not found error.
 */
export class ExtAppsMethodNotFoundError extends ExtAppsError {
  constructor(message: string) {
    super(message);
    this.name = 'ExtAppsMethodNotFoundError';
  }
}

/**
 * Invalid params error.
 */
export class ExtAppsInvalidParamsError extends ExtAppsError {
  constructor(message: string) {
    super(message);
    this.name = 'ExtAppsInvalidParamsError';
  }
}

/**
 * Feature not supported error.
 */
export class ExtAppsNotSupportedError extends ExtAppsError {
  constructor(message: string) {
    super(message);
    this.name = 'ExtAppsNotSupportedError';
  }
}

/**
 * Tool not found error.
 */
export class ExtAppsToolNotFoundError extends ExtAppsError {
  constructor(message: string) {
    super(message);
    this.name = 'ExtAppsToolNotFoundError';
  }
}

/**
 * Factory function for creating an ExtAppsMessageHandler.
 */
export function createExtAppsMessageHandler(options: ExtAppsMessageHandlerOptions): ExtAppsMessageHandler {
  return new ExtAppsMessageHandler(options);
}
