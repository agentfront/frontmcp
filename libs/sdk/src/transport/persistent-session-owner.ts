/**
 * Who a persistent MCP session belongs to.
 *
 * A Durable Object (edge `createEdgeSessionDurableObject`) holds one persistent
 * server + transport per `mcp-session-id`. The id is chosen by the worker's
 * router (a plain id, not one `session:verify` can check against the caller's
 * token), so presenting it proves nothing about who is asking. The session
 * therefore belongs to the caller that first reached it, and the `http:request`
 * flow refuses anyone else (`checkPersistentSessionOwner`).
 */
import { isAnonymousSubject } from '@frontmcp/auth';
import { sha256Hex } from '@frontmcp/utils';

import { type Authorization } from '../common/types/auth/session.types';

/** The caller each persistent session belongs to; `null` for one opened by a caller with no identity. */
const owners = new WeakMap<object, string | null>();

/**
 * The identity a persistent session is bound to for this caller:
 *
 * - a signed-in (or static-key) caller: its verified subject, which a token
 *   refresh keeps;
 * - an anonymous caller with a token (an anonymous grant): that token;
 * - an anonymous caller without one: `null`. It has no identity to bind, so,
 *   as for any anonymous session, the unguessable session id is the only
 *   credential.
 */
export function persistentSessionCallerKey(authorization: Authorization | undefined): string | null {
  const sub = authorization?.user?.sub;
  if (!isAnonymousSubject(sub)) return `sub:${sub}`;
  if (authorization?.token) return `token:${sha256Hex(authorization.token)}`;
  return null;
}

/**
 * Claim a persistent session for a caller, or check the claim: the first
 * caller to reach the session owns it, and only that caller passes afterwards.
 *
 * @param session - the persistent server + transport pair
 * @param callerKey - from {@link persistentSessionCallerKey}
 * @returns whether the caller may use the session
 */
export function claimPersistentSession(session: object, callerKey: string | null): boolean {
  if (!owners.has(session)) {
    owners.set(session, callerKey);
    return true;
  }
  return owners.get(session) === callerKey;
}
