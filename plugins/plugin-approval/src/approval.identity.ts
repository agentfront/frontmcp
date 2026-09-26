/**
 * Who a call's approvals belong to.
 *
 * @module @frontmcp/plugin-approval
 */

import { STATELESS_SESSION_ID, type FrontMcpContext } from '@frontmcp/sdk';
import { randomUUID } from '@frontmcp/utils';

export interface ApprovalIdentity {
  /** Key for session-scoped approvals. */
  sessionId: string;
  /** Key for user-scoped approvals, when the call has an authenticated principal. */
  userId: string | undefined;
}

type ApprovalCallerContext = Pick<FrontMcpContext, 'sessionId' | 'authInfo'>;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The session and user that a call's approvals are read from and granted to.
 *
 * The stateless transport gives every request the same session id, so keying session
 * approvals on it let one caller's approval admit every other stateless caller. A stateless
 * call is keyed by its authenticated principal instead, and a call with neither a session nor
 * a principal gets a key of its own that no other call can match.
 */
export function resolveApprovalIdentity(ctx: ApprovalCallerContext | undefined): ApprovalIdentity {
  const extra = ctx?.authInfo?.extra;
  const userId =
    nonEmptyString(extra?.['userId']) ?? nonEmptyString(extra?.['sub']) ?? nonEmptyString(ctx?.authInfo?.clientId);
  const sessionId = nonEmptyString(ctx?.sessionId);

  if (sessionId && sessionId !== STATELESS_SESSION_ID) {
    return { sessionId, userId };
  }

  return { sessionId: userId ? `stateless-user:${userId}` : `unidentified:${randomUUID()}`, userId };
}
