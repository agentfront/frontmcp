/**
 * usePublishEvent — a function that publishes an MCP Event on the provider's server, as `this.events.publish` does
 * in a tool. Typed by the event: `publish(orderPlaced, data)` checks `data` against its payload schema's type.
 *
 * @example
 * ```tsx
 * const publish = usePublishEvent();
 * <button onClick={() => publish(cartUpdated, { items: cart.length })}>Save</button>
 * ```
 */

import { useCallback } from 'react';

import type { EventPublisher } from '@frontmcp/sdk';

import { useResolvedServer } from './useResolvedServer';

/** Publish on the provider's server, or on the server `serverName` names. */
export function usePublishEvent(serverName?: string): EventPublisher['publish'] {
  const { entry, name } = useResolvedServer(serverName);
  const server = entry?.server;

  return useCallback(
    ((event: string, data: Record<string, unknown>, options?: Parameters<EventPublisher['publish']>[2]) => {
      if (!server) return Promise.reject(new Error(`FrontMCP server "${name}" is not registered`));
      return server.events.publish(event, data, options);
    }) as EventPublisher['publish'],
    [server, name],
  );
}
