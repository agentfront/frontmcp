/**
 * OpenTelemetry semantic attributes for FrontMCP.
 *
 * Three attribute namespaces:
 * - `mcp.*`       — MCP protocol-level attributes (interoperable with other MCP implementations)
 * - `frontmcp.*`  — FrontMCP-specific attributes (vendor namespace per OTel conventions)
 * - Standard OTel — `http.*`, `rpc.*`, `url.*`, `enduser.*`, `server.*`
 */

// ─────────────────────────────────────────────────────────────────────────────
// MCP Protocol Attributes (interoperable)
// ─────────────────────────────────────────────────────────────────────────────

export const McpAttributes = {
  /** MCP protocol method name (e.g., "tools/call", "resources/read") */
  METHOD_NAME: 'mcp.method.name',

  /** MCP session identifier (hashed for privacy) */
  SESSION_ID: 'mcp.session.id',

  /** MCP resource URI */
  RESOURCE_URI: 'mcp.resource.uri',

  /** MCP component type: "tool" | "resource" | "prompt" | "resource_template" */
  COMPONENT_TYPE: 'mcp.component.type',

  /** MCP component key (e.g., "tool:get_weather", "resource:config://db") */
  COMPONENT_KEY: 'mcp.component.key',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// FrontMCP Vendor Attributes
// ─────────────────────────────────────────────────────────────────────────────

export const FrontMcpAttributes = {
  /** Scope identifier */
  SCOPE_ID: 'frontmcp.scope.id',

  /** Server/scope name */
  SERVER_NAME: 'frontmcp.server.name',

  /** Tool name being executed */
  TOOL_NAME: 'frontmcp.tool.name',

  /** Tool owner class name */
  TOOL_OWNER: 'frontmcp.tool.owner',

  /** Resource URI being read */
  RESOURCE_URI: 'frontmcp.resource.uri',

  /** Resource name */
  RESOURCE_NAME: 'frontmcp.resource.name',

  /** Prompt name being invoked */
  PROMPT_NAME: 'frontmcp.prompt.name',

  /** Flow name (e.g., "tools:call-tool") */
  FLOW_NAME: 'frontmcp.flow.name',

  /** Flow stage (e.g., "willExecute") */
  FLOW_STAGE: 'frontmcp.flow.stage',

  /** Hook stage (e.g., "willValidateInput") */
  HOOK_STAGE: 'frontmcp.hook.stage',

  /** Hook owner identifier */
  HOOK_OWNER: 'frontmcp.hook.owner',

  /** Hashed session ID (for trace correlation, not the real session ID) */
  SESSION_ID_HASH: 'frontmcp.session.id_hash',

  /** Authentication type */
  AUTH_TYPE: 'frontmcp.auth.type',

  /** Request identifier */
  REQUEST_ID: 'frontmcp.request.id',

  /** Provider type (e.g., "local", "adapter", "remote") */
  PROVIDER_TYPE: 'frontmcp.provider.type',

  /** Delegation — original name before namespacing */
  DELEGATE_ORIGINAL_NAME: 'frontmcp.delegate.original_name',

  // ── Transport ──

  /** Transport type: "legacy-sse" | "streamable-http" | "stateless-http" */
  TRANSPORT_TYPE: 'frontmcp.transport.type',

  /** Transport request type: "initialize" | "message" | "elicitResult" | "sseListener" | "extApps" */
  TRANSPORT_REQUEST_TYPE: 'frontmcp.transport.request_type',

  /** Session protocol */
  SESSION_PROTOCOL: 'frontmcp.session.protocol',

  /** Whether a new session was created */
  SESSION_CREATED: 'frontmcp.session.created',

  // ── Auth ──

  /** Auth mode: "public" | "transparent" | "orchestrated" */
  AUTH_MODE: 'frontmcp.auth.mode',

  /** Auth result: "authorized" | "unauthorized" | "anonymous" */
  AUTH_RESULT: 'frontmcp.auth.result',

  // ── OAuth ──

  /** OAuth grant type: "authorization_code" | "refresh_token" | "anonymous" */
  OAUTH_GRANT_TYPE: 'frontmcp.oauth.grant_type',

  // ── Elicitation ──

  /** Elicitation request ID */
  ELICITATION_ID: 'frontmcp.elicitation.id',

  // ── Agent ──

  /** Agent name */
  AGENT_NAME: 'frontmcp.agent.name',

  /** Agent execution loop iterations */
  AGENT_ITERATIONS: 'frontmcp.agent.iterations',

  /** Agent execution duration in ms */
  AGENT_EXECUTION_DURATION_MS: 'frontmcp.agent.execution_duration_ms',

  // ── Startup ──

  /** Total tools registered at startup */
  STARTUP_TOOLS_COUNT: 'frontmcp.startup.tools_count',

  /** Total resources registered at startup */
  STARTUP_RESOURCES_COUNT: 'frontmcp.startup.resources_count',

  /** Total prompts registered at startup */
  STARTUP_PROMPTS_COUNT: 'frontmcp.startup.prompts_count',

  /** Total plugins loaded at startup */
  STARTUP_PLUGINS_COUNT: 'frontmcp.startup.plugins_count',

  /** Startup initialization duration in ms */
  STARTUP_DURATION_MS: 'frontmcp.startup.duration_ms',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Standard OTel HTTP Attributes
// ─────────────────────────────────────────────────────────────────────────────

export const HttpAttributes = {
  METHOD: 'http.request.method',
  STATUS_CODE: 'http.response.status_code',
  URL_PATH: 'url.path',
  URL_FULL: 'url.full',
  URL_SCHEME: 'url.scheme',
  SERVER_ADDRESS: 'server.address',
  SERVER_PORT: 'server.port',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Standard OTel RPC Attributes
// ─────────────────────────────────────────────────────────────────────────────

export const RpcAttributes = {
  /** RPC system — "mcp" for MCP protocol */
  SYSTEM: 'rpc.system',
  /** RPC service name */
  SERVICE: 'rpc.service',
  /** RPC method */
  METHOD: 'rpc.method',
  /** JSON-RPC version */
  JSONRPC_VERSION: 'rpc.jsonrpc.version',
  /** JSON-RPC request ID */
  JSONRPC_REQUEST_ID: 'rpc.jsonrpc.request_id',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Standard OTel Enduser Attributes
// ─────────────────────────────────────────────────────────────────────────────

export const EnduserAttributes = {
  /** Client/user ID from auth token */
  ID: 'enduser.id',
  /** OAuth scopes (space-separated) */
  SCOPE: 'enduser.scope',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OTel tracing configuration options.
 */
export interface TracingOptions {
  /** Instrument HTTP request spans (default: true) */
  httpSpans?: boolean;

  /** Instrument tool/resource/prompt execution spans (default: true) */
  executionSpans?: boolean;

  /** Instrument individual hook spans — verbose (default: false) */
  hookSpans?: boolean;

  /** Instrument outbound fetch() calls (default: true) */
  fetchSpans?: boolean;

  /** Record flow stages as span events (default: true) */
  flowStageEvents?: boolean;

  /** Instrument transport flows — SSE, streamable-http, stateless-http (default: true) */
  transportSpans?: boolean;

  /** Instrument auth verify/session verify flows (default: true) */
  authSpans?: boolean;

  /** Instrument OAuth flows — token, authorize, callback, register (default: true) */
  oauthSpans?: boolean;

  /** Instrument elicitation request/result flows (default: true) */
  elicitationSpans?: boolean;

  /** Emit startup telemetry report on first request (default: true) */
  startupReport?: boolean;
}

/**
 * OTel setup configuration for the convenience setupOTel() function.
 */
export interface OTelSetupOptions {
  /** Service name for the OTel resource (default: 'frontmcp-server') */
  serviceName?: string;

  /** Exporter type */
  exporter?: 'otlp' | 'console';

  /** OTLP endpoint URL (default: 'http://localhost:4318') */
  endpoint?: string;

  /** Service version */
  serviceVersion?: string;
}
