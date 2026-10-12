import { type FrontMcpConfigType } from '../common';

/** Set by `createDirect()` and `connect()`: their scopes are served in process only, never over HTTP. */
export const DIRECT_ONLY_FLAG = '__directOnly' as const;

export function markDirectOnly(config: FrontMcpConfigType): void {
  (config as Record<string, unknown>)[DIRECT_ONLY_FLAG] = true;
}

export function isDirectOnly(metadata: object): boolean {
  return (metadata as Record<string, unknown>)[DIRECT_ONLY_FLAG] === true;
}
