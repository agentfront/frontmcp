/**
 * @file types.ts
 * @description MCP Apps specification types.
 *
 * Implements types from the MCP Apps extension specification:
 * https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx
 *
 * @module @frontmcp/sdk/mcp-apps/types
 */

// ============================================
// MIME Types
// ============================================

/**
 * MCP Apps content MIME type.
 * MVP specification supports only HTML5 documents.
 */
export const MCP_APPS_MIME_TYPE = 'text/html+mcp' as const;

/**
 * Supported MIME types for MCP Apps resources.
 */
export type McpAppsMimeType = typeof MCP_APPS_MIME_TYPE;

// ============================================
// UI Resource Types
// ============================================

/**
 * Content Security Policy configuration for UI resources.
 * Hosts construct CSP headers from these declared domains.
 */
export interface McpAppsCSP {
  /** Domains allowed for network requests (fetch, XHR, WebSocket) */
  connectDomains?: string[];
  /** Domains allowed for static assets (images, scripts, fonts) */
  resourceDomains?: string[];
}

/**
 * UI Resource metadata as defined in MCP Apps spec.
 * Included in `_meta.ui` field of resource declarations.
 */
export interface UIResourceMeta {
  /** Content Security Policy configuration */
  csp?: McpAppsCSP;
  /** Dedicated sandbox origin for this resource */
  domain?: string;
  /** Whether host should render visual boundary around UI */
  prefersBorder?: boolean;
}

/**
 * Complete UI Resource declaration for MCP Apps.
 */
export interface UIResource {
  /** Resource URI (must start with "ui://") */
  uri: string;
  /** Human-readable display name */
  name: string;
  /** Optional description */
  description?: string;
  /** MIME type - must be "text/html+mcp" for MVP */
  mimeType: McpAppsMimeType;
  /** UI-specific metadata */
  _meta?: {
    ui?: UIResourceMeta;
  };
}

// ============================================
// Host Context Types
// ============================================

/**
 * Display modes for UI rendering.
 */
export type McpAppsDisplayMode = 'inline' | 'fullscreen' | 'pip';

/**
 * Platform types for host environment.
 */
export type McpAppsPlatform = 'web' | 'desktop' | 'mobile';

/**
 * Device capability flags.
 */
export interface DeviceCapabilities {
  /** Touch input available */
  touch?: boolean;
  /** Hover interactions available */
  hover?: boolean;
}

/**
 * Safe area insets for device screens.
 */
export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Viewport dimensions.
 */
export interface ViewportInfo {
  width: number;
  height: number;
  maxHeight?: number;
  maxWidth?: number;
}

/**
 * Tool information passed to UI.
 */
export interface ToolInfo {
  /** Request ID for this tool invocation */
  id?: string | number;
  /** Tool definition */
  tool: {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  };
}

/**
 * Host context provided to UI on initialization.
 * Contains environment information from the host.
 */
export interface McpAppsHostContext {
  /** Tool information for this UI context */
  toolInfo?: ToolInfo;
  /** Current theme */
  theme?: 'light' | 'dark';
  /** Current display mode */
  displayMode?: McpAppsDisplayMode;
  /** Viewport dimensions */
  viewport?: ViewportInfo;
  /** User's locale (BCP 47 tag) */
  locale?: string;
  /** User's timezone (IANA name) */
  timeZone?: string;
  /** Host platform type */
  platform?: McpAppsPlatform;
  /** Device capabilities */
  deviceCapabilities?: DeviceCapabilities;
  /** Safe area insets */
  safeAreaInsets?: SafeAreaInsets;
}

// ============================================
// JSON-RPC Message Types
// ============================================

/**
 * Base JSON-RPC 2.0 message.
 */
export interface JsonRpcMessage {
  jsonrpc: '2.0';
}

/**
 * JSON-RPC request message.
 */
export interface JsonRpcRequest extends JsonRpcMessage {
  id: string | number;
  method: string;
  params?: unknown;
}

/**
 * JSON-RPC response message.
 */
export interface JsonRpcResponse extends JsonRpcMessage {
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

/**
 * JSON-RPC notification (no response expected).
 */
export interface JsonRpcNotification extends JsonRpcMessage {
  method: string;
  params?: unknown;
}

/**
 * JSON-RPC error object.
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================
// MCP Apps Protocol Messages
// ============================================

/**
 * UI Initialize request parameters.
 * Sent by UI to host on startup.
 */
export interface McpUiInitializeParams {
  /** Protocol version */
  protocolVersion: string;
  /** UI capabilities */
  capabilities?: {
    /** Supported message types */
    messages?: string[];
  };
}

/**
 * UI Initialize response from host.
 */
export interface McpUiInitializeResult {
  /** Protocol version (should match request) */
  protocolVersion: string;
  /** Host capabilities */
  capabilities: {
    /** Host-provided extensions */
    extensions?: Record<string, unknown>;
  };
  /** Host context information */
  hostContext: McpAppsHostContext;
}

/**
 * Tool input notification parameters.
 * Sent by host to UI with complete tool arguments.
 */
export interface McpUiToolInputParams {
  /** Tool arguments */
  arguments: Record<string, unknown>;
}

/**
 * Tool input partial notification parameters.
 * Sent by host to UI during streaming.
 */
export interface McpUiToolInputPartialParams {
  /** Partial tool arguments (incremental) */
  argumentsDelta: string;
}

/**
 * Tool result notification parameters.
 * Sent by host to UI after tool execution.
 */
export interface McpUiToolResultParams {
  /** Tool execution result */
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
  }>;
  /** Structured content for UI rendering only */
  structuredContent?: Record<string, unknown>;
  /** Additional metadata */
  _meta?: Record<string, unknown>;
}

/**
 * Tool cancelled notification parameters.
 */
export interface McpUiToolCancelledParams {
  /** Reason for cancellation */
  reason?: string;
}

/**
 * Size change notification parameters.
 * Sent by host when UI viewport changes.
 */
export interface McpUiSizeChangeParams {
  /** New viewport dimensions */
  viewport: ViewportInfo;
}

/**
 * Host context change notification parameters.
 */
export interface McpUiHostContextChangeParams {
  /** Changed context fields */
  changes: Partial<McpAppsHostContext>;
}

/**
 * Open link request parameters.
 * Sent by UI to request host open a URL.
 */
export interface McpUiOpenLinkParams {
  /** URL to open */
  url: string;
}

/**
 * Send message request parameters.
 * Sent by UI to send content to host's chat.
 */
export interface McpUiMessageParams {
  /** Message content */
  content: string;
}

// ============================================
// MCP Apps Method Names
// ============================================

/**
 * MCP Apps protocol method names.
 */
export const MCP_APPS_METHODS = {
  // Lifecycle
  INITIALIZE: 'ui/initialize',
  INITIALIZED: 'ui/notifications/initialized',

  // Tool lifecycle notifications (Host → UI)
  TOOL_INPUT: 'ui/notifications/tool-input',
  TOOL_INPUT_PARTIAL: 'ui/notifications/tool-input-partial',
  TOOL_RESULT: 'ui/notifications/tool-result',
  TOOL_CANCELLED: 'ui/notifications/tool-cancelled',

  // Context notifications (Host → UI)
  SIZE_CHANGE: 'ui/notifications/size-change',
  HOST_CONTEXT_CHANGE: 'ui/host-context-change',
  RESOURCE_TEARDOWN: 'ui/resource-teardown',

  // UI Requests (UI → Host)
  OPEN_LINK: 'ui/open-link',
  MESSAGE: 'ui/message',

  // Standard MCP methods that UI can use
  TOOLS_CALL: 'tools/call',
  RESOURCES_READ: 'resources/read',
  NOTIFICATIONS_MESSAGE: 'notifications/message',
  PING: 'ping',

  // Sandbox proxy (web hosts only)
  SANDBOX_READY: 'ui/notifications/sandbox-ready',
  SANDBOX_RESOURCE_READY: 'ui/notifications/sandbox-resource-ready',
} as const;

// ============================================
// Extension Capability Types
// ============================================

/**
 * MCP Apps extension capability declaration.
 * Advertised by clients during connection.
 */
export interface McpAppsExtensionCapability {
  /** Supported MIME types */
  mimeTypes: McpAppsMimeType[];
}

/**
 * Client extensions object including MCP Apps.
 */
export interface McpClientExtensions {
  'io.modelcontextprotocol/ui'?: McpAppsExtensionCapability;
  [key: string]: unknown;
}

// ============================================
// Tool Metadata Extension
// ============================================

/**
 * Tool metadata extension for MCP Apps.
 * Added to tool's `_meta` field to link to UI resource.
 */
export interface ToolUIMeta {
  /** URI of the UI resource template */
  'ui/resourceUri'?: string;
  /** MIME type of the UI resource */
  'ui/mimeType'?: McpAppsMimeType;
}

/**
 * Extended tool result metadata including MCP Apps fields.
 */
export interface McpAppsToolResultMeta extends ToolUIMeta {
  /** Additional platform-specific metadata */
  [key: string]: unknown;
}

// ============================================
// Protocol Version
// ============================================

/**
 * Current MCP Apps protocol version.
 */
export const MCP_APPS_PROTOCOL_VERSION = '2025-01-01' as const;
