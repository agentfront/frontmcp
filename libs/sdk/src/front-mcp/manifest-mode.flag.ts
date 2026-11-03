import { type FrontMcpConfigType } from '../common';

/** Set by `createForManifest()`: the server boots only to be read, so its lazy apps are imported at startup. */
const MANIFEST_MODE_FLAG = '__manifestMode' as const;

export function markManifestMode(config: FrontMcpConfigType): void {
  (config as Record<string, unknown>)[MANIFEST_MODE_FLAG] = true;
}

export function isManifestMode(metadata: object): boolean {
  return (metadata as Record<string, unknown>)[MANIFEST_MODE_FLAG] === true;
}
