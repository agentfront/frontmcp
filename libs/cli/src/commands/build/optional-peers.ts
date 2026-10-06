import { createRequire } from 'module';
import * as path from 'path';

import type { EntryDecoratorInfo } from './load-entry-config';

const OBSERVABILITY_PEER = '@frontmcp/observability';

export interface OptionalPeerDetection {
  /** Peers the config needs that resolve from the project. */
  installed: string[];
  /** Peers the config needs that are not installed. */
  missing: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The config, as evaluated at build time, turns metrics or observability on. */
function enablesObservability({ decoratorConfig, keysSeenInSource }: EntryDecoratorInfo): boolean {
  if (!decoratorConfig) return namesObservability(keysSeenInSource);
  const metrics = decoratorConfig['metrics'];
  return (isObject(metrics) && metrics['enabled'] === true) || Boolean(decoratorConfig['observability']);
}

/** The source names metrics or observability, possibly behind an env check that was off at build time. */
function namesObservability(keysSeenInSource: string[]): boolean {
  return keysSeenInSource.includes('metrics') || keysSeenInSource.includes('observability');
}

function isResolvable(moduleName: string, cwd: string): boolean {
  try {
    createRequire(path.join(cwd, 'package.json')).resolve(moduleName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Optional peers the SDK loads with `require()` that this entry's config may turn
 * on (`metrics`, `observability` → `@frontmcp/observability`). An installed peer
 * is bundled whenever the source names the option, since an env-gated block can be
 * off at build time and on in the deployment; it is reported missing only when
 * the config is known to enable it.
 */
export function detectOptionalPeers(entryInfo: EntryDecoratorInfo, cwd: string): OptionalPeerDetection {
  const enabled = enablesObservability(entryInfo);
  const named = enabled || namesObservability(entryInfo.keysSeenInSource);
  if (!named) return { installed: [], missing: [] };
  if (isResolvable(OBSERVABILITY_PEER, cwd)) return { installed: [OBSERVABILITY_PEER], missing: [] };
  return { installed: [], missing: enabled ? [OBSERVABILITY_PEER] : [] };
}
