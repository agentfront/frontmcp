/**
 * Who a call's approvals belong to.
 *
 * @module @frontmcp/plugin-approval
 */

import { type FrontMcpContext } from '@frontmcp/sdk';
import { randomUUID } from '@frontmcp/utils';

export interface ApprovalIdentity {
  /** Key for session-scoped approvals. */
  sessionId: string;
  /** Key for user-scoped approvals, when the call has an authenticated principal. */
  userId: string | undefined;
}

type ApprovalCallerContext = Pick<FrontMcpContext, 'verifiedSessionId' | 'authInfo'>;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The session and user that a call's approvals are read from and granted to.
 *
 * Only a verified session keys session approvals; a stateless call (shared or per-request session
 * id) is keyed by its principal, and a call with neither gets a key no other call can match.
 */
export function resolveApprovalIdentity(ctx: ApprovalCallerContext | undefined): ApprovalIdentity {
  const extra = ctx?.authInfo?.extra;
  const userId =
    nonEmptyString(extra?.['userId']) ?? nonEmptyString(extra?.['sub']) ?? nonEmptyString(ctx?.authInfo?.clientId);
  const sessionId = nonEmptyString(ctx?.verifiedSessionId);

  if (sessionId) {
    return { sessionId, userId };
  }

  return { sessionId: userId ? `stateless-user:${userId}` : `unidentified:${randomUUID()}`, userId };
}
