import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Transport Configuration Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unix socket transport configuration.
 * Used for local TUI connections.
 */
export const unixTransportOptionsSchema = z.object({
  /**
   * Enable Unix socket transport.
   * Default: true when manager is enabled
   */
  enabled: z.boolean().default(true),

  /**
   * Unix socket path.
   * Supports {pid} placeholder for process ID.
   * Default: '/tmp/frontmcp-{pid}.sock'
   */
  path: z.string().default('/tmp/frontmcp-{pid}.sock'),
});

/**
 * TCP socket transport configuration.
 * Used for orchestrator/external service connections.
 */
export const tcpTransportOptionsSchema = z.object({
  /**
   * Enable TCP socket transport.
   * Default: false (opt-in)
   */
  enabled: z.boolean().default(false),

  /**
   * Host to bind to.
   * Default: '127.0.0.1' (localhost only)
   */
  host: z.string().default('127.0.0.1'),

  /**
   * Port to listen on.
   * Default: 0 (auto-assign)
   */
  port: z.number().int().min(0).max(65535).default(0),
});

/**
 * WebSocket transport configuration.
 * Used for web dashboard connections.
 */
export const websocketTransportOptionsSchema = z.object({
  /**
   * Enable WebSocket transport.
   * Default: false (opt-in)
   */
  enabled: z.boolean().default(false),

  /**
   * Port to listen on.
   * Default: 0 (auto-assign)
   */
  port: z.number().int().min(0).max(65535).default(0),

  /**
   * WebSocket path.
   * Default: '/manager'
   */
  path: z.string().default('/manager'),

  /**
   * Host to bind to.
   * Default: '127.0.0.1'
   */
  host: z.string().default('127.0.0.1'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Manager Configuration Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ManagerService configuration options.
 * Controls how the manager captures events and exposes them via transports.
 */
export const managerOptionsSchema = z.object({
  /**
   * Enable manager service.
   * When true, the manager listens for client connections and streams events.
   * Default: auto-detect from FRONTMCP_MANAGER_ENABLED environment variable
   */
  enabled: z.boolean().optional(),

  /**
   * Transport configurations.
   * Unix transport is enabled by default when manager is enabled.
   */
  transports: z
    .object({
      unix: unixTransportOptionsSchema.optional(),
      tcp: tcpTransportOptionsSchema.optional(),
      websocket: websocketTransportOptionsSchema.optional(),
    })
    .default({ unix: { enabled: true, path: '/tmp/frontmcp-{pid}.sock' } }),

  /**
   * Maximum number of events to buffer for late subscribers.
   * Oldest events are dropped when buffer is full.
   * Default: 1000
   */
  bufferSize: z.number().int().positive().default(1000),

  /**
   * Include log messages at these levels in the event stream.
   * Default: ['info', 'warn', 'error']
   */
  includeLogLevels: z
    .array(z.enum(['verbose', 'debug', 'info', 'warn', 'error']))
    .default(['verbose', 'debug', 'info', 'warn', 'error']),

  /**
   * Capture request/response bodies in request events.
   * May contain sensitive data - disable for privacy.
   * Default: true
   */
  capturePayloads: z.boolean().default(true),

  /**
   * Sanitize headers by removing sensitive values.
   * Default: true
   */
  sanitizeHeaders: z.boolean().default(true),

  /**
   * Headers to redact (case-insensitive).
   * Default: ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token']
   */
  redactHeaders: z.array(z.string()).default(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token']),

  /**
   * Optional authentication token for client connections.
   * If set, clients must provide this token to connect.
   * Default: undefined (no auth)
   */
  authToken: z.string().optional(),

  /**
   * Maximum number of concurrent client connections.
   * Default: 10
   */
  maxClients: z.number().int().positive().default(10),

  /**
   * Heartbeat interval in milliseconds.
   * Sends ping to detect dead connections.
   * Default: 30000 (30 seconds)
   */
  heartbeatInterval: z.number().int().positive().default(30000),
});

export type ManagerOptions = z.infer<typeof managerOptionsSchema>;
export type ManagerOptionsInput = z.input<typeof managerOptionsSchema>;

export type UnixTransportOptions = z.infer<typeof unixTransportOptionsSchema>;
export type TcpTransportOptions = z.infer<typeof tcpTransportOptionsSchema>;
export type WebsocketTransportOptions = z.infer<typeof websocketTransportOptionsSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate Manager options with defaults.
 */
export function parseManagerOptions(input?: ManagerOptionsInput): ManagerOptions {
  return managerOptionsSchema.parse(input ?? {});
}

/**
 * Check if manager service should be enabled.
 * Returns true if:
 * 1. options.enabled is explicitly true, OR
 * 2. options.enabled is undefined AND FRONTMCP_MANAGER_ENABLED=true
 */
export function isManagerEnabled(options?: ManagerOptionsInput): boolean {
  if (options?.enabled !== undefined) {
    return options.enabled;
  }
  return process.env['FRONTMCP_MANAGER_ENABLED'] === 'true';
}

/**
 * Resolve Unix socket path with placeholders.
 * Checks FRONTMCP_MANAGER_UNIX_PATH environment variable first,
 * then falls back to template with {pid} placeholder.
 */
export function resolveSocketPath(pathTemplate: string): string {
  // Environment variable takes precedence (set by CLI for coordination)
  const envPath = process.env['FRONTMCP_MANAGER_UNIX_PATH'];
  if (envPath) {
    return envPath;
  }
  return pathTemplate.replace('{pid}', process.pid.toString());
}

/**
 * Default manager options for development mode.
 */
export const DEV_MANAGER_OPTIONS: ManagerOptionsInput = {
  enabled: true,
  transports: {
    unix: { enabled: true },
    tcp: { enabled: false },
    websocket: { enabled: false },
  },
  includeLogLevels: ['debug', 'info', 'warn', 'error'],
  capturePayloads: true,
};

/**
 * Production manager options (more restrictive).
 */
export const PROD_MANAGER_OPTIONS: ManagerOptionsInput = {
  enabled: false,
  transports: {
    unix: { enabled: false },
    tcp: { enabled: false },
    websocket: { enabled: false },
  },
  includeLogLevels: ['warn', 'error'],
  capturePayloads: false,
};
