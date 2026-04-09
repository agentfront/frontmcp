import { DEFAULT_FRONTMCP_MACHINE_ID_HEADER, DEFAULT_FRONTMCP_NODE_COOKIE } from './ha.constants';

/**
 * HA (High Availability) Configuration Types
 *
 * Used by the distributed deployment mode (`frontmcp build -t distributed`)
 * to configure heartbeat, session takeover, and notification relay.
 */

/**
 * Configuration for HA services.
 * All values have sensible defaults — only override when tuning.
 */
export interface HaConfig {
  /** How often the pod writes a heartbeat to Redis (ms). Default: 10_000 (10s). */
  heartbeatIntervalMs: number;
  /** TTL for the heartbeat key in Redis (ms). Should be 2-3x intervalMs. Default: 30_000 (30s). */
  heartbeatTtlMs: number;
  /** Grace period after heartbeat expiry before claiming sessions (ms). Default: 5_000 (5s). */
  takeoverGracePeriodMs: number;
  /** Redis key prefix for all HA keys. Default: 'mcp:ha:'. */
  redisKeyPrefix: string;
  /** Cookie name for LB session affinity. Configurable via frontmcp.config. Default: '__frontmcp_node'. */
  affinityCookieName: string;
  /** Response header for machine ID. Configurable via frontmcp.config. Default: 'X-FrontMCP-Machine-Id'. */
  machineIdHeader: string;
}

/** Default HA configuration values. */
export const DEFAULT_HA_CONFIG: Readonly<HaConfig> = {
  heartbeatIntervalMs: 10_000,
  heartbeatTtlMs: 30_000,
  takeoverGracePeriodMs: 5_000,
  redisKeyPrefix: 'mcp:ha:',
  affinityCookieName: DEFAULT_FRONTMCP_NODE_COOKIE,
  machineIdHeader: DEFAULT_FRONTMCP_MACHINE_ID_HEADER,
};

/** Deployment modes set by `frontmcp build -t {target}`. */
export type DeploymentMode = 'distributed' | 'serverless' | 'standalone' | 'browser';

/** Heartbeat value stored in Redis. */
export interface HeartbeatValue {
  nodeId: string;
  startedAt: number;
  lastBeat: number;
  sessionCount: number;
}

/** Result of a session takeover attempt. */
export interface TakeoverResult {
  claimed: boolean;
  sessionId: string;
  previousNodeId?: string;
}
