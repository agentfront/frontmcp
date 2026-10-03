import type { HaDeploymentConfig } from './frontmcp-config.types';

/**
 * `FRONTMCP_HA_*` variables for the `ha` block of a distributed deployment.
 *
 * The generated setup file sets them (unless the platform already did), and the
 * SDK reads them when it starts the HA manager (`resolveHaConfigFromEnv` in
 * `@frontmcp/sdk`) — so the `ha` settings in `frontmcp.config` reach the running pods.
 */
export function haEnv(ha: HaDeploymentConfig | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  if (!ha) return env;
  if (ha.heartbeatIntervalMs !== undefined) env['FRONTMCP_HA_HEARTBEAT_INTERVAL_MS'] = String(ha.heartbeatIntervalMs);
  if (ha.heartbeatTtlMs !== undefined) env['FRONTMCP_HA_HEARTBEAT_TTL_MS'] = String(ha.heartbeatTtlMs);
  if (ha.takeoverGracePeriodMs !== undefined) env['FRONTMCP_HA_TAKEOVER_GRACE_MS'] = String(ha.takeoverGracePeriodMs);
  if (ha.redisKeyPrefix !== undefined) env['FRONTMCP_HA_KEY_PREFIX'] = ha.redisKeyPrefix;
  return env;
}
