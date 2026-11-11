import { loadCounterFactory } from '../../answer/answer-meter';
import type { MetricsOptionsInterface } from '../../common/types/options/metrics';

/** The `/metrics` counters of event publishing and delivery, labelled `event`. */
export const EVENT_COUNTERS = {
  published: 'frontmcp_events_published_total',
  matched: 'frontmcp_events_matched_total',
  delivered: 'frontmcp_events_delivered_total',
  retried: 'frontmcp_events_retried_total',
  abandoned: 'frontmcp_events_abandoned_total',
  dropped: 'frontmcp_events_dropped_total',
  suspended: 'frontmcp_events_suspended_total',
  terminated: 'frontmcp_events_terminated_total',
  notified: 'frontmcp_events_channel_notified_total',
} as const;

export type EventCounter = keyof typeof EVENT_COUNTERS;

const COUNTER_DESCRIPTIONS: Record<EventCounter, string> = {
  published: 'Events published',
  matched: 'Deliveries queued for the subscriptions an event matched',
  delivered: 'Deliveries a callback acknowledged with 2xx',
  retried: 'Delivery attempts that failed and are retried',
  abandoned: 'Deliveries given up after the last attempt or the retry window',
  dropped:
    'Deliveries not retried: the callback answered 410 or 413, the body was too large, or the subscription is gone',
  suspended: 'Subscriptions suspended after repeated delivery failures',
  terminated: 'Subscriptions the server ended',
  notified: 'Channel notifications sent to Claude Code sessions for events with the channel option',
};

type CounterFactory = (
  name: string,
  description?: string,
) => { inc(by?: number, attributes?: Record<string, string>): void };

/** Counts what happens to published events. */
export interface EventMetrics {
  count(counter: EventCounter, eventName: string, by?: number): void;
}

/** The event counters of a server: recorded when `/metrics` is on, otherwise ignored. */
export function createEventMetrics(
  metrics: Pick<MetricsOptionsInterface, 'enabled'> | undefined,
  loadFactory: () => CounterFactory = loadCounterFactory,
): EventMetrics {
  if (metrics?.enabled !== true) return { count: () => undefined };
  const createCounter = loadFactory();
  return {
    count: (counter, eventName, by = 1) => {
      createCounter(EVENT_COUNTERS[counter], COUNTER_DESCRIPTIONS[counter]).inc(by, { event: eventName });
    },
  };
}
