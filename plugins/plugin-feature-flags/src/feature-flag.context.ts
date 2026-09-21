import type { FrontMcpContext } from '@frontmcp/sdk';

import type { FeatureFlagContext, FeatureFlagPluginOptions } from './feature-flag.types';

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
    sessionId: ctx.sessionId,
    attributes: config.attributesResolver ? config.attributesResolver(ctx) : {},
  };
}
