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

function needsObservability({ decoratorConfig, keysSeenInSource }: EntryDecoratorInfo): boolean {
  if (!decoratorConfig) return keysSeenInSource.includes('metrics') || keysSeenInSource.includes('observability');
  const metrics = decoratorConfig['metrics'];
  return (isObject(metrics) && metrics['enabled'] === true) || Boolean(decoratorConfig['observability']);
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
 * Optional peers the SDK loads with `require()` that this entry's config turns
 * on (`metrics.enabled`, `observability` → `@frontmcp/observability`).
 */
export function detectOptionalPeers(entryInfo: EntryDecoratorInfo, cwd: string): OptionalPeerDetection {
  const needed = needsObservability(entryInfo) ? [OBSERVABILITY_PEER] : [];
  return {
    installed: needed.filter((moduleName) => isResolvable(moduleName, cwd)),
    missing: needed.filter((moduleName) => !isResolvable(moduleName, cwd)),
  };
}
