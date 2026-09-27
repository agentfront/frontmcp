import { SubscribeRequestSchema, type EmptyResult, type SubscribeRequest } from '@frontmcp/protocol';

import { loadRemoteAppCapabilities } from '../../app/remote-capabilities.utils';
import { availabilityForCall, entryUnavailableError } from '../../common/availability';
import { ResourceNotFoundError } from '../../errors';
import { isUIResourceUri } from '../../tool/ui';
import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { mcpRequestSurface } from './mcp-surface';

/**
 * Handler for the resources/subscribe MCP request.
 * Per MCP 2025-11-25 spec, this allows clients to subscribe to receive
 * notifications when a specific resource changes.
 */
export default function SubscribeRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: SubscribeRequestSchema,
    handler: async (request: SubscribeRequest, ctx): Promise<EmptyResult> => {
      const { uri } = request.params;

      // Refuse what resources/read refuses, with the same error: an unknown URI, a resource whose
      // `availableWhen.surface` isn't offered on this request's surface (answered like an unknown URI),
      // or one a process-wide `availableWhen` axis excludes.
      await assertSubscribable(scope, uri);

      // Get session ID from auth context
      const sessionId = ctx.authInfo?.sessionId;
      if (!sessionId) {
        scope.logger.warn('resources/subscribe: No session ID found in request context');
        return {};
      }

      // Subscribe the session to the resource
      const isNew = scope.notifications.subscribeResource(sessionId, uri);

      if (isNew) {
        scope.logger.info(`resources/subscribe: Session ${sessionId.slice(0, 20)}... subscribed to ${uri}`);
      } else {
        scope.logger.debug(`resources/subscribe: Session ${sessionId.slice(0, 20)}... already subscribed to ${uri}`);
      }

      // Per MCP spec, return empty result
      return {};
    },
  } satisfies McpHandler<SubscribeRequest, EmptyResult>;
}

/** Throw, as the MCP error resources/read answers with, unless `uri` names a resource this request may read. */
async function assertSubscribable(scope: McpHandlerOptions['scope'], uri: string): Promise<void> {
  // `ui://` widget URIs are served from the tool UI registry, not the resource registry, and carry no
  // `availableWhen` of their own; subscribing to them is left as it was.
  if (isUIResourceUri(uri)) return;

  let match = scope.resources.findResourceForUri(uri);
  if (!match) {
    // Remote apps list their resources lazily, as resources/read accounts for.
    await loadRemoteAppCapabilities(scope);
    match = scope.resources.findResourceForUri(uri);
  }
  if (!match) throw toSdkMcpError(new ResourceNotFoundError(uri));

  const { availableWhen } = match.instance.metadata;
  const surface = mcpRequestSurface(scope);
  const availability = availabilityForCall(availableWhen, surface);
  if (availability === 'not-offered') throw toSdkMcpError(new ResourceNotFoundError(uri));
  if (availability === 'unavailable') {
    throw toSdkMcpError(
      entryUnavailableError(match.instance.isTemplate ? 'ResourceTemplate' : 'Resource', uri, availableWhen, surface),
    );
  }
}
