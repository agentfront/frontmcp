import { sha256Hex } from '@frontmcp/utils';

/** A short hash that tells sessions apart in logs without carrying the session ID, which can resume the session. */
export function sessionIdHash(sessionId: string): string {
  return sha256Hex(sessionId).slice(0, 12);
}
