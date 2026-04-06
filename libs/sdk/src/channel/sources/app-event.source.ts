// file: libs/sdk/src/channel/sources/app-event.source.ts

import type { FrontMcpLogger } from '../../common';
import type { ChannelInstance } from '../channel.instance';

type EventHandler = (payload: unknown) => void;

/**
 * In-process event bus for app-event channel sources.
 *
 * Applications can emit events to this bus, and channels subscribed
 * to matching event names will receive them and push notifications.
 *
 * @example
 * ```typescript
 * // In your application code:
 * const eventBus = scope.channelEventBus;
 * eventBus.emit('error', { message: 'Connection failed', level: 'critical' });
 * eventBus.emit('deploy', { version: '1.2.3', status: 'success' });
 * ```
 */
export class ChannelEventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly logger: FrontMcpLogger;

  constructor(logger: FrontMcpLogger) {
    this.logger = logger.child('ChannelEventBus');
  }

  /**
   * Subscribe to events of a specific name.
   *
   * @param event - The event name to subscribe to
   * @param handler - The handler function called with the event payload
   * @returns Unsubscribe function
   */
  on(event: string, handler: EventHandler): () => void {
    let handlers = this.handlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(event, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.handlers.delete(event);
      }
    };
  }

  /**
   * Emit an event to all subscribed handlers.
   *
   * @param event - The event name
   * @param payload - The event payload
   */
  emit(event: string, payload: unknown): void {
    const handlers = this.handlers.get(event);
    if (!handlers || handlers.size === 0) {
      this.logger.verbose(`No handlers for event "${event}"`);
      return;
    }

    this.logger.verbose(`Emitting event "${event}" to ${handlers.size} handler(s)`);

    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (err) {
        this.logger.error(`Handler error for event "${event}"`, { error: err });
      }
    }
  }

  /**
   * Remove all handlers.
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get the number of registered event types.
   */
  get eventCount(): number {
    return this.handlers.size;
  }
}

/**
 * Wires an app-event channel source to the ChannelEventBus.
 *
 * @param channel - The channel instance to push notifications to
 * @param eventName - The event name to subscribe to
 * @param eventBus - The event bus instance
 * @param logger - Logger instance
 * @returns Unsubscribe function
 */
export function wireAppEventSource(
  channel: ChannelInstance,
  eventName: string,
  eventBus: ChannelEventBus,
  logger: FrontMcpLogger,
): () => void {
  return eventBus.on(eventName, (payload) => {
    logger.verbose(`App event "${eventName}" received for channel "${channel.name}"`);

    channel.handleEvent(payload).catch((err) => {
      logger.error(`Failed to handle app event "${eventName}" in channel "${channel.name}"`, { error: err });
    });
  });
}
