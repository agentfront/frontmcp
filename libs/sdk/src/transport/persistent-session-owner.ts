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

/**
 * Where a persistent session's owner outlives the in-memory session: a Durable Object's storage,
 * so an instance rebuilt after eviction keeps refusing everyone but the caller that opened it.
 */
export interface PersistentSessionOwnerStore {
  /**
   * The owner recorded before this instance started (loaded before any request reaches it):
   * a caller key, `null` for a session opened by a caller with no identity, or `undefined` when
   * the session was never claimed.
   */
  readonly initial: string | null | undefined;
  /** Record the owner, once, when the first caller claims the session. */
  save(callerKey: string | null): Promise<void>;
}

/** The caller each persistent session belongs to; `null` for one opened by a caller with no identity. */
const owners = new WeakMap<object, string | null>();

/**
 * The identity a persistent session is bound to for this caller:
 *
 * - a signed-in (or static-key) caller: its verified issuer and subject (a
 *   subject is unique only within its issuer), which a token refresh keeps;
 * - an anonymous caller with a token (an anonymous grant): that token;
 * - an anonymous caller without one: `null`. It has no identity to bind, so,
 *   as for any anonymous session, the unguessable session id is the only
 *   credential.
 */
export function persistentSessionCallerKey(authorization: Authorization | undefined): string | null {
  const sub = authorization?.user?.sub;
  if (!isAnonymousSubject(sub)) {
    const iss = authorization?.user?.iss;
    return `sub:${sha256Hex(JSON.stringify([typeof iss === 'string' ? iss : '', sub]))}`;
  }
  if (authorization?.token) return `token:${sha256Hex(authorization.token)}`;
  return null;
}

/**
 * Claim a persistent session for a caller, or check the claim: the first
 * caller to reach the session owns it, and only that caller passes afterwards.
 * A session whose store names an owner already has it, whichever caller this
 * instance sees first. The decision is made here, synchronously, so two
 * requests racing for a fresh session can't both claim it.
 *
 * @param session - the persistent server + transport pair
 * @param callerKey - from {@link persistentSessionCallerKey}
 * @param store - the session's owner store, if it has one
 * @returns `'claimed'` for the caller that just took the session (record it in
 *   the store), `'owner'` for its owner, `'refused'` for anyone else
 */
export function claimPersistentSession(
  session: object,
  callerKey: string | null,
  store?: PersistentSessionOwnerStore,
): 'claimed' | 'owner' | 'refused' {
  if (!owners.has(session) && store && store.initial !== undefined) {
    owners.set(session, store.initial);
  }
  if (!owners.has(session)) {
    owners.set(session, callerKey);
    return 'claimed';
  }
  return owners.get(session) === callerKey ? 'owner' : 'refused';
}
