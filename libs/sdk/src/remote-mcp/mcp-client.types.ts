/**
 * @file mcp-client.types.ts
 * @description Types for MCP client connections to remote servers
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  ServerCapabilities,
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

// ═══════════════════════════════════════════════════════════════════
// CONNECTION TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Connection status for a remote MCP server
 */
export type McpConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Represents an active connection to a remote MCP server
 */
export interface McpClientConnection {
  /** The MCP client instance */
  client: Client;
  /** The transport used for communication */
  transport: Transport;
  /** Session ID assigned by the remote server (if any) */
  sessionId?: string;
  /** Current connection status */
  status: McpConnectionStatus;
  /** Last error if status is 'error' */
  lastError?: Error;
  /** Server capabilities reported during initialization */
  capabilities?: ServerCapabilities;
  /** Timestamp of last successful communication */
  lastHeartbeat?: Date;
  /** Timestamp when connection was established */
  connectedAt?: Date;
}

/**
 * Summary of connection status for external consumers
 */
export interface McpConnectionInfo {
  appId: string;
  status: McpConnectionStatus;
  sessionId?: string;
  connectedAt?: Date;
  lastHeartbeat?: Date;
  capabilities?: ServerCapabilities;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// TRANSPORT TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Supported transport types for remote MCP connections
 */
export type McpTransportType = 'http' | 'sse' | 'worker' | 'npm' | 'esm';

/**
 * Options for HTTP-based transports (Streamable HTTP and SSE)
 */
export interface McpHttpTransportOptions {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retry attempts for failed requests (default: 3) */
  retryAttempts?: number;
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelayMs?: number;
  /** Whether to fallback to SSE if Streamable HTTP fails (default: true) */
  fallbackToSSE?: boolean;
  /** Additional headers to include in all requests */
  headers?: Record<string, string>;
}

/**
 * Options for Worker subprocess transport
 */
export interface McpWorkerTransportOptions {
  /** Path to the worker script */
  workerPath: string;
  /** Environment variables for the worker process */
  env?: Record<string, string>;
  /** Working directory for the worker process */
  cwd?: string;
  /** Timeout for worker startup in milliseconds (default: 10000) */
  startupTimeout?: number;
}

/**
 * Options for ESM/NPM dynamic import transport
 */
export interface McpEsmTransportOptions {
  /** Package name or URL (e.g., '@frontmcp/slack-mcp@latest' or 'https://esm.sh/...') */
  packageUrl: string;
  /** Import map for module resolution */
  importMap?: Record<string, string>;
}

/**
 * Union of all transport options
 */
export type McpTransportOptions = McpHttpTransportOptions | McpWorkerTransportOptions | McpEsmTransportOptions;

// ═══════════════════════════════════════════════════════════════════
// AUTH TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Static credentials for remote server authentication
 */
export interface McpStaticCredentials {
  type: 'bearer' | 'basic' | 'apiKey';
  value: string;
  /** Header name for apiKey type (default: 'X-API-Key') */
  headerName?: string;
}

/**
 * Authentication configuration for remote MCP connections
 */
export type McpRemoteAuthConfig =
  | {
      /** Use static credentials */
      mode: 'static';
      credentials: McpStaticCredentials;
    }
  | {
      /** Forward gateway user's token to remote server */
      mode: 'forward';
      /** Specific claim to extract from token (default: entire token) */
      tokenClaim?: string;
      /** Header name to use (default: 'Authorization') */
      headerName?: string;
    }
  | {
      /** Map gateway auth info to remote credentials */
      mode: 'mapped';
      mapper: (authInfo: AuthInfo | undefined) => McpStaticCredentials | Promise<McpStaticCredentials>;
    }
  | {
      /** Let remote server handle its own OAuth flow */
      mode: 'oauth';
    };

/**
 * Resolved authentication context for a remote call
 */
export interface McpRemoteAuthContext {
  /** Gateway auth info (if available) - may be partial if not fully authenticated */
  authInfo?: Partial<AuthInfo>;
  /** Resolved headers to send to remote server */
  headers?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════
// CAPABILITY TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Cached capabilities from a remote server
 */
export interface McpRemoteCapabilities {
  /** Tools available on the remote server */
  tools: Tool[];
  /** Resources available on the remote server */
  resources: Resource[];
  /** Resource templates available on the remote server */
  resourceTemplates: ResourceTemplate[];
  /** Prompts available on the remote server */
  prompts: Prompt[];
  /** Timestamp when capabilities were last fetched */
  fetchedAt: Date;
}

/**
 * Event emitted when remote capabilities change
 */
export interface McpCapabilityChangeEvent {
  appId: string;
  kind: 'tools' | 'resources' | 'prompts' | 'all';
  previousCount: number;
  newCount: number;
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Retry options for self-healing
 */
export interface McpRetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Jitter factor 0-1 to randomize delays (default: 0.1) */
  jitterFactor?: number;
}

/**
 * Circuit breaker options
 */
export interface McpCircuitBreakerOptions {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before attempting to close circuit (default: 30000) */
  resetTimeoutMs?: number;
  /** Number of successful calls in half-open to close circuit (default: 2) */
  successThreshold?: number;
  /** Time window in ms for counting failures (default: 60000) */
  failureWindowMs?: number;
}

/**
 * Health check options
 */
export interface McpHealthCheckOptions {
  /** Interval between health checks in ms (default: 30000) */
  intervalMs?: number;
  /** Timeout for health check in ms (default: 5000) */
  timeoutMs?: number;
  /** Number of failures before marking unhealthy (default: 3) */
  unhealthyThreshold?: number;
  /** Number of successes before marking healthy (default: 2) */
  healthyThreshold?: number;
}

/**
 * Configuration for the MCP client service
 */
export interface McpClientServiceOptions {
  /** Interval for capability refresh in ms (0 = no refresh, default: 0) */
  capabilityRefreshInterval?: number;
  /** Client name reported to remote servers (default: 'frontmcp-gateway') */
  clientName?: string;
  /** Client version reported to remote servers (default: '1.0.0') */
  clientVersion?: string;
  /** Enable debug logging */
  debug?: boolean;

  // ═══════════════════════════════════════════════════════════════════
  // RESILIENCE OPTIONS
  // ═══════════════════════════════════════════════════════════════════

  /** Enable retry with exponential backoff for transient failures (default: true) */
  enableRetry?: boolean;
  /** Retry configuration options */
  retryOptions?: McpRetryOptions;

  /** Enable circuit breaker to prevent cascading failures (default: true) */
  enableCircuitBreaker?: boolean;
  /** Circuit breaker configuration options */
  circuitBreakerOptions?: McpCircuitBreakerOptions;

  /** Enable health checking for proactive monitoring (default: true) */
  enableHealthCheck?: boolean;
  /** Health check configuration options */
  healthCheckOptions?: McpHealthCheckOptions;

  /** Enable automatic reconnection on connection failures (default: true) */
  enableAutoReconnect?: boolean;
  /** Base delay between auto-reconnect attempts in ms (default: 5000) */
  autoReconnectDelayMs?: number;
  /** Maximum number of auto-reconnect attempts (default: 3) */
  maxAutoReconnectAttempts?: number;
}

/**
 * Request to connect to a remote MCP server
 */
export interface McpConnectRequest {
  /** Unique identifier for this remote app */
  appId: string;
  /** Display name for the remote app */
  name: string;
  /** Transport type to use */
  transportType: McpTransportType;
  /** URL or path for the remote server */
  url: string;
  /** Transport-specific options */
  transportOptions?: McpTransportOptions;
  /** Authentication configuration */
  auth?: McpRemoteAuthConfig;
  /** Namespace prefix for tool names (default: appId) */
  namespace?: string;
}

/**
 * Result of a tool call to a remote server
 */
export interface McpRemoteCallToolResult {
  /** The raw result from the remote server */
  result: CallToolResult;
  /** Duration of the call in milliseconds */
  durationMs: number;
  /** Whether the call was successful */
  success: boolean;
  /** Error if the call failed */
  error?: Error;
}

/**
 * Result of a resource read from a remote server
 */
export interface McpRemoteReadResourceResult {
  /** The raw result from the remote server */
  result: ReadResourceResult;
  /** Duration of the call in milliseconds */
  durationMs: number;
  /** Whether the call was successful */
  success: boolean;
  /** Error if the call failed */
  error?: Error;
}

/**
 * Result of a prompt get from a remote server
 */
export interface McpRemoteGetPromptResult {
  /** The raw result from the remote server */
  result: GetPromptResult;
  /** Duration of the call in milliseconds */
  durationMs: number;
  /** Whether the call was successful */
  success: boolean;
  /** Error if the call failed */
  error?: Error;
}

// ═══════════════════════════════════════════════════════════════════
// CALLBACK TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Callback for capability change notifications
 */
export type McpCapabilityChangeCallback = (event: McpCapabilityChangeEvent) => void;

/**
 * Callback for connection status changes
 */
export type McpConnectionChangeCallback = (appId: string, status: McpConnectionStatus, error?: Error) => void;

/**
 * Unsubscribe function returned by event subscriptions
 */
export type McpUnsubscribeFn = () => void;
