/**
 * useDomEventSource — publish an MCP Event when a DOM element fires an event. It listens on the target it is given
 * only: there are no global listeners.
 *
 * @example
 * ```tsx
 * const form = useRef<HTMLFormElement>(null);
 * useDomEventSource(form, 'submit', () => ({ name: 'checkout.submitted', data: {} }));
 * ```
 */

import { useEffect, useRef, type RefObject } from 'react';

import type { EventPublishOptions } from '@frontmcp/sdk';

import { useIsomorphicLayoutEffect } from '../utils/useIsomorphicLayoutEffect';
import { usePublishEvent } from './usePublishEvent';

/** The event to publish for a DOM event, or nothing to skip it. */
export interface DomEventSourceEvent {
  name: string;
  data: Record<string, unknown>;
  options?: EventPublishOptions;
}

export interface UseDomEventSourceOptions {
  /** The server to publish on; the provider's by default. */
  server?: string;
  /** Told when a publish fails; a warning is logged otherwise. */
  onError?: (error: Error) => void;
}

/** Listen for `type` on `target` (an element, a ref to one, or any `EventTarget`) and publish what `toEvent` maps it to. */
export function useDomEventSource<DomEvent extends Event = Event>(
  target: EventTarget | RefObject<EventTarget | null> | null | undefined,
  type: string,
  toEvent: (domEvent: DomEvent) => DomEventSourceEvent | undefined,
  options: UseDomEventSourceOptions = {},
): void {
  const publish = usePublishEvent(options.server);
  const callbacksRef = useRef({ toEvent, onError: options.onError });

  useIsomorphicLayoutEffect(() => {
    callbacksRef.current = { toEvent, onError: options.onError };
  });

  useEffect(() => {
    const element = target && 'current' in target ? target.current : target;
    if (!element) return;
    const listener = (domEvent: Event) => {
      const published = callbacksRef.current.toEvent(domEvent as DomEvent);
      if (!published) return;
      publish(published.name, published.data, published.options).catch((caught: unknown) => {
        const error = caught instanceof Error ? caught : new Error(String(caught));
        const report = callbacksRef.current.onError;
        if (report) report(error);
        else console.warn(`[frontmcp] event "${published.name}" was not published: ${error.message}`);
      });
    };
    element.addEventListener(type, listener);
    return () => element.removeEventListener(type, listener);
  }, [target, type, publish]);
}
