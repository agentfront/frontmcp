// file: libs/sdk/src/notification/resource-update-access.ts
import type { Scope } from '../scope';
import { mcpRequestSurface } from '../transport/mcp-handlers/mcp-surface';
import type { SessionCaller } from './notification.service';

/** Whether `resources:subscribe` still admits the caller for `uri`, in a request of its own that subscribes nothing. */
export async function callerMayStillRead(
  scope: Scope,
  caller: SessionCaller | undefined,
  uri: string,
): Promise<boolean> {
  const request = { method: 'resources/subscribe' as const, params: { uri } };
  const ctx = { authInfo: caller ?? {}, surface: mcpRequestSurface(scope), ownRequest: true };
  return scope.runFlow('resources:subscribe', { request, ctx }).then(
    () => true,
    () => false,
  );
}
