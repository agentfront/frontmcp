/**
 * useEventSubscription — subscribe to an MCP Event of the provider's server through its in-process client, and run
 * a handler for each occurrence. Delivery stays in the page: push over the in-memory connection, or poll.
 *
 * @example
 * ```tsx
 * const { status } = useEventSubscription('order.created', { status: 'paid' }, (occurrence) => {
 *   toast(`Order ${occurrence.data.orderId}`);
 * });
 * ```
 */

import { useEffect, useRef, useState } from 'react';

import type { EventDeliveryMode, EventOccurrence, EventSubscription } from '@frontmcp/sdk';

import { useIsomorphicLayoutEffect } from '../utils/useIsomorphicLayoutEffect';
import { useResolvedServer } from './useResolvedServer';

export interface UseEventSubscriptionOptions {
  /** Runs for each occurrence. */
  onEvent: (occurrence: EventOccurrence) => void;
  /** Told when the subscription is refused or ended by the server. */
  onError?: (error: Error) => void;
  /** The server to subscribe on; the provider's by default. */
  server?: string;
  /** Force a delivery mode instead of letting the client choose. */
  delivery?: EventDeliveryMode;
  /** `false` holds no subscription. @default true */
  enabled?: boolean;
}

export type EventSubscriptionStatus = 'idle' | 'subscribing' | 'active' | 'ended' | 'error';

export interface UseEventSubscriptionResult {
  status: EventSubscriptionStatus;
  /** The delivery mode in use, once subscribed. */
  mode?: EventDeliveryMode;
  error?: Error;
}

/** The error a rejection carries. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Subscribe while the component is mounted and the server's client is connected; unsubscribe on unmount. */
export function useEventSubscription(
  name: string,
  args: Record<string, unknown> | undefined,
  handlerOrOptions: UseEventSubscriptionOptions['onEvent'] | UseEventSubscriptionOptions,
): UseEventSubscriptionResult {
  const options = typeof handlerOrOptions === 'function' ? { onEvent: handlerOrOptions } : handlerOrOptions;
  const { entry } = useResolvedServer(options.server);
  const client = entry?.client;
  const argsKey = JSON.stringify(args ?? {});
  const enabled = options.enabled !== false;
  const { delivery } = options;
  const optionsRef = useRef(options);
  const [state, setState] = useState<UseEventSubscriptionResult>({ status: 'idle' });

  useIsomorphicLayoutEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!client || !enabled) return;
    let unmounted = false;
    let subscription: EventSubscription | undefined;

    const run = async () => {
      setState({ status: 'subscribing' });
      try {
        subscription = await client.events.subscribe(name, JSON.parse(argsKey), { delivery });
        if (unmounted) return void (await subscription.cancel());
        const { mode } = subscription;
        setState({ status: 'active', mode });
        for await (const occurrence of subscription) optionsRef.current.onEvent(occurrence);
        if (!unmounted) setState({ status: 'ended', mode });
      } catch (caught) {
        if (unmounted) return;
        const error = toError(caught);
        setState({ status: 'error', mode: subscription?.mode, error });
        optionsRef.current.onError?.(error);
      }
    };
    void run();

    return () => {
      unmounted = true;
      void subscription?.cancel();
    };
  }, [client, name, argsKey, enabled, delivery]);

  return state;
}
