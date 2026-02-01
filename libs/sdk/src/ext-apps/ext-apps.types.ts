/**
 * MCP Apps (ext-apps) Type Definitions
 *
 * Types for the MCP Apps Extension protocol (SEP-1865) bidirectional
 * communication between embedded widgets and AI hosts.
 *
 * @see https://github.com/modelcontextprotocol/ext-apps
 * @packageDocumentation
 */

// ============================================
// Core Message Params
// ============================================

/**
 * Parameters for ui/callServerTool request.
 * Widget requests the host to invoke a server tool.
 */
export interface ExtAppsCallServerToolParams {
  /** Tool name to invoke */
  name: string;
  /** Tool arguments */
  arguments?: Record<string, unknown>;
}

/**
 * Parameters for ui/updateModelContext request.
 * Widget updates the model context with new state.
 */
export interface ExtAppsUpdateModelContextParams {
  /** Context data to update */
  context: unknown;
  /** Whether to merge with existing context (default: true) */
  merge?: boolean;
}

/**
 * Parameters for ui/openLink request.
 * Widget requests the host to open a URL.
 */
export interface ExtAppsOpenLinkParams {
  /** URL to open */
  url: string;
}

// ============================================
// Display and Lifecycle
// ============================================

/**
 * Display mode options for ext-apps widgets.
 */
export type ExtAppsDisplayMode = 'inline' | 'fullscreen' | 'pip';

/**
 * Parameters for ui/setDisplayMode request.
 * Widget requests a display mode change.
 */
export interface ExtAppsSetDisplayModeParams {
  /** Desired display mode */
  mode: ExtAppsDisplayMode;
}

/**
 * Parameters for ui/close request.
 * Widget requests to be closed.
 */
export interface ExtAppsCloseParams {
  /** Optional reason for closing */
  reason?: string;
}

// ============================================
// Logging
// ============================================

/**
 * Log levels for ext-apps logging.
 */
export type ExtAppsLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Parameters for ui/log request.
 * Widget sends a log message to the host.
 */
export interface ExtAppsLogParams {
  /** Log level */
  level: ExtAppsLogLevel;
  /** Log message */
  message: string;
  /** Optional additional data */
  data?: unknown;
}

// ============================================
// Widget-Defined Tools
// ============================================

/**
 * Parameters for ui/registerTool request.
 * Widget registers a tool it provides.
 */
export interface ExtAppsRegisterToolParams {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Tool input schema (JSON Schema format) */
  inputSchema: Record<string, unknown>;
}

/**
 * Parameters for ui/unregisterTool request.
 * Widget unregisters a tool it previously registered.
 */
export interface ExtAppsUnregisterToolParams {
  /** Tool name to unregister */
  name: string;
}

// ============================================
// Host Capabilities
// ============================================

/**
 * Host capabilities advertised during initialization.
 * These capabilities are returned by the host in the ui/initialize response.
 */
export interface ExtAppsHostCapabilities {
  /** Host supports proxying tool calls to the MCP server */
  serverToolProxy?: boolean;
  /** Host supports opening links */
  openLink?: boolean;
  /** Host supports model context updates */
  modelContextUpdate?: boolean;
  /** Host supports widget-defined tools */
  widgetTools?: boolean;
  /** Supported display modes */
  displayModes?: ExtAppsDisplayMode[];
  /** Host supports logging */
  logging?: boolean;
}

// ============================================
// Widget Capabilities
// ============================================

/**
 * Widget capabilities advertised during initialization.
 * These capabilities are sent by the widget in the ui/initialize request.
 */
export interface ExtAppsWidgetCapabilities {
  /** Widget tools configuration */
  tools?: {
    /** Widget can emit tool list changes (dynamic tool registration) */
    listChanged?: boolean;
  };
  /** Widget supports partial input streaming */
  supportsPartialInput?: boolean;
}

// ============================================
// Initialization
// ============================================

/**
 * App info provided during initialization.
 */
export interface ExtAppsAppInfo {
  /** Application name */
  name: string;
  /** Application version */
  version: string;
}

/**
 * Host context provided during initialization.
 */
export interface ExtAppsHostContext {
  /** Current theme */
  theme?: 'light' | 'dark' | 'system';
  /** Current display mode */
  displayMode?: ExtAppsDisplayMode;
  /** Viewport dimensions */
  viewport?: { width: number; height: number };
  /** User locale */
  locale?: string;
  /** User timezone */
  timezone?: string;
}

/**
 * Parameters for ui/initialize request.
 */
export interface ExtAppsInitializeParams {
  /** Widget app info */
  appInfo: ExtAppsAppInfo;
  /** Widget capabilities */
  appCapabilities: ExtAppsWidgetCapabilities;
  /** Protocol version */
  protocolVersion: string;
}

/**
 * Result of ui/initialize request.
 */
export interface ExtAppsInitializeResult {
  /** Host capabilities */
  hostCapabilities: ExtAppsHostCapabilities;
  /** Initial host context */
  hostContext?: ExtAppsHostContext;
  /** Protocol version acknowledged */
  protocolVersion: string;
}

// ============================================
// Notifications (Host to Widget)
// ============================================

/**
 * Parameters for ui/notifications/tool-input notification.
 */
export interface ExtAppsToolInputNotification {
  /** Tool input arguments */
  arguments: Record<string, unknown>;
}

/**
 * Parameters for ui/notifications/tool-result notification.
 */
export interface ExtAppsToolResultNotification {
  /** Tool result content */
  content: unknown;
  /** Structured content for widget rendering */
  structuredContent?: unknown;
}

/**
 * Parameters for ui/notifications/host-context-changed notification.
 */
export interface ExtAppsHostContextChangedNotification {
  /** Updated theme */
  theme?: 'light' | 'dark' | 'system';
  /** Updated display mode */
  displayMode?: ExtAppsDisplayMode;
  /** Updated viewport */
  viewport?: { width: number; height: number };
  /** Updated locale */
  locale?: string;
  /** Updated timezone */
  timezone?: string;
}

/**
 * Parameters for ui/notifications/cancelled notification.
 */
export interface ExtAppsCancelledNotification {
  /** Cancellation reason */
  reason?: string;
}

// ============================================
// JSON-RPC Types
// ============================================

/**
 * JSON-RPC 2.0 request.
 */
export interface ExtAppsJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

/**
 * JSON-RPC 2.0 response.
 */
export interface ExtAppsJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * JSON-RPC 2.0 notification (no id, no response expected).
 */
export interface ExtAppsJsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/**
 * Union type for all JSON-RPC messages.
 */
export type ExtAppsJsonRpcMessage = ExtAppsJsonRpcRequest | ExtAppsJsonRpcResponse | ExtAppsJsonRpcNotification;

// ============================================
// Error Codes
// ============================================

/**
 * Standard JSON-RPC error codes for ext-apps.
 */
export const EXT_APPS_ERROR_CODES = {
  /** Invalid JSON was received */
  PARSE_ERROR: -32700,
  /** The JSON sent is not a valid Request object */
  INVALID_REQUEST: -32600,
  /** The method does not exist or is not available */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameter(s) */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error */
  INTERNAL_ERROR: -32603,
  /** Tool not found */
  TOOL_NOT_FOUND: -32001,
  /** Tool execution failed */
  TOOL_EXECUTION_FAILED: -32002,
  /** Feature not supported */
  NOT_SUPPORTED: -32003,
  /** Operation cancelled */
  CANCELLED: -32004,
} as const;

export type ExtAppsErrorCode = (typeof EXT_APPS_ERROR_CODES)[keyof typeof EXT_APPS_ERROR_CODES];
