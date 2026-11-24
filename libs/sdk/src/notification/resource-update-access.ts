// file: libs/sdk/src/notification/resource-update-access.ts
import { runRequestExclusive } from '@frontmcp/utils';

import type { Scope } from '../scope';
import { mcpRequestSurface } from '../transport/mcp-handlers/mcp-surface';
import type { SessionCaller } from './notification.service';

/**
 * Whether `resources:subscribe` still admits the session's caller for `uri`: a check-only request of its own, as the
 * session, that subscribes nothing. It takes a request turn, so overlapping checks never share a request context.
 */
export async function callerMayStillRead(
  scope: Scope,
  sessionId: string,
  caller: SessionCaller | undefined,
  uri: string,
): Promise<boolean> {
  const request = { method: 'resources/subscribe' as const, params: { uri } };
  const authInfo = { ...caller, sessionId };
  const ctx = { authInfo, surface: mcpRequestSurface(scope), ownRequest: true, checkOnly: true };
  return runRequestExclusive(() => scope.runFlow('resources:subscribe', { request, ctx })).then(
    () => true,
    () => false,
  );
}
