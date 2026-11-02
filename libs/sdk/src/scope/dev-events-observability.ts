import { getEnv } from '@frontmcp/utils';

/**
 * The `observability` config a server without one gets under `frontmcp dev`, which names an events file
 * (`FRONTMCP_DEV_EVENTS_FILE`) or an IPC channel (`FRONTMCP_DEV_EVENTS_IPC`): dev events only.
 */
export function devEventsObservabilityConfig(): { tracing: false; logging: false } | undefined {
  const underFrontmcpDev = !!getEnv('FRONTMCP_DEV_EVENTS_FILE') || getEnv('FRONTMCP_DEV_EVENTS_IPC') === '1';
  return underFrontmcpDev ? { tracing: false, logging: false } : undefined;
}
