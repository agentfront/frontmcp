/**
 * HA configuration from the environment.
 *
 * `frontmcp build --target distributed` writes the `ha` block of the
 * deployment in `frontmcp.config` to these variables in the generated setup
 * file; they can also be set directly on the pod.
 */

import { getEnv } from '@frontmcp/utils';

import type { HaConfig } from './ha.types';

/** Environment variables read by {@link resolveHaConfigFromEnv}. */
export const HA_ENV = {
  heartbeatIntervalMs: 'FRONTMCP_HA_HEARTBEAT_INTERVAL_MS',
  heartbeatTtlMs: 'FRONTMCP_HA_HEARTBEAT_TTL_MS',
  takeoverGracePeriodMs: 'FRONTMCP_HA_TAKEOVER_GRACE_MS',
  redisKeyPrefix: 'FRONTMCP_HA_KEY_PREFIX',
} as const;

function positiveInt(name: string): number | undefined {
  const raw = getEnv(name);
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * HA overrides set in the environment. Missing or invalid values are left out,
 * so the defaults apply to them.
 */
export function resolveHaConfigFromEnv(): Partial<HaConfig> {
  const config: Partial<HaConfig> = {};
  const heartbeatIntervalMs = positiveInt(HA_ENV.heartbeatIntervalMs);
  if (heartbeatIntervalMs !== undefined) config.heartbeatIntervalMs = heartbeatIntervalMs;
  const heartbeatTtlMs = positiveInt(HA_ENV.heartbeatTtlMs);
  if (heartbeatTtlMs !== undefined) config.heartbeatTtlMs = heartbeatTtlMs;
  const takeoverGracePeriodMs = positiveInt(HA_ENV.takeoverGracePeriodMs);
  if (takeoverGracePeriodMs !== undefined) config.takeoverGracePeriodMs = takeoverGracePeriodMs;
  const redisKeyPrefix = getEnv(HA_ENV.redisKeyPrefix)?.trim();
  if (redisKeyPrefix) config.redisKeyPrefix = redisKeyPrefix;
  return config;
}
