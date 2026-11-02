import { getEnv } from '@frontmcp/utils';

import { type PluginType } from '../common';
import { normalizePlugin } from '../plugin/plugin.utils';

/**
 * The `observability` config a server without one gets under `frontmcp dev`, which names an events file
 * (`FRONTMCP_DEV_EVENTS_FILE`) or an IPC channel (`FRONTMCP_DEV_EVENTS_IPC`): dev events only. None when
 * the server or one of its apps installs ObservabilityPlugin itself, as that plugin writes the events.
 */
export function devEventsObservabilityConfig(
  installedPlugins: Iterable<PluginType>,
): { tracing: false; logging: false } | undefined {
  const underFrontmcpDev = !!getEnv('FRONTMCP_DEV_EVENTS_FILE') || getEnv('FRONTMCP_DEV_EVENTS_IPC') === '1';
  if (!underFrontmcpDev) return undefined;
  for (const plugin of installedPlugins) {
    if (normalizePlugin(plugin).metadata.name === 'observability') return undefined;
  }
  return { tracing: false, logging: false };
}
