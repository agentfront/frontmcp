import { STATELESS_SESSION_ID, type FrontMcpContext } from '@frontmcp/sdk';

import type { FeatureFlagContext, FeatureFlagPluginOptions } from './feature-flag.types';

/**
 * The session id the server verified for this request, or `undefined` for a caller without one.
 *
 * Not `ctx.sessionId`: under MCP 2026-07-28 that is whatever `mcp-session-id` the caller sent (or
 * a per-request placeholder), and adapters target by session id (LaunchDarkly and Split.io use it
 * as the key when there is no user), so a caller could name the session a rollout targets. The
 * verified id is the one the server's session check put in `authInfo`, the same rule the SDK uses
 * to share `CONTEXT` providers across a session's requests.
 */
function verifiedSessionId(ctx: FrontMcpContext): string | undefined {
  const verified = ctx.authInfo?.sessionId ?? ctx.authInfo?.extra?.['sessionId'];
  return typeof verified === 'string' && verified.length > 0 && verified !== STATELESS_SESSION_ID
    ? verified
    : undefined;
}

/**
 * Build the adapter evaluation context for the current caller.
 *
 * Shared by the context-scoped accessor and by the plugin's list/gate hooks. Those hooks used
 * to pass `{}`, which asks a targeted adapter "is this flag on for nobody in particular" — a
 * question it can answer differently from "is it on for THIS caller", letting a gate allow
 * access the caller should not have.
 */
export function buildFeatureFlagContext(
  ctx: FrontMcpContext | undefined,
  config: Pick<FeatureFlagPluginOptions, 'userIdResolver' | 'attributesResolver'>,
): FeatureFlagContext {
  if (!ctx) return {};

  const userId = config.userIdResolver
    ? config.userIdResolver(ctx)
    : ((ctx.authInfo?.extra?.['sub'] as string | undefined) ??
      (ctx.authInfo?.extra?.['userId'] as string | undefined) ??
      ctx.authInfo?.clientId);

  return {
    userId: userId ?? undefined,
    sessionId: verifiedSessionId(ctx),
    attributes: config.attributesResolver ? config.attributesResolver(ctx) : {},
  };
}
