import {
  AsyncProvider,
  EVENT_PUBLISHER,
  Worker,
  type EventPublisher,
  type WorkerInterface,
  type WorkerRunContext,
} from '@frontmcp/sdk';

import { clockTicked } from '../events/clock-ticked.event';

const TICK_MS = 250;

/** Resolves after one tick, or at once when the worker is stopped. */
function nextTick(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, TICK_MS);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Publishes clock.ticked on a timer. */
@Worker({ name: 'clock', scope: 'process' })
class ClockWorker implements WorkerInterface {
  constructor(private readonly events: EventPublisher) {}

  async run({ signal }: WorkerRunContext): Promise<void> {
    let tick = 0;
    while (!signal.aborted) {
      await this.events.publish(clockTicked, { source: 'worker', tick });
      tick += 1;
      await nextTick(signal);
    }
  }
}

/** The worker, built with the publisher behind the EVENT_PUBLISHER token: tsx emits no constructor types to inject by. */
export const clockWorker = AsyncProvider({
  provide: ClockWorker,
  name: 'clock-worker',
  inject: () => [EVENT_PUBLISHER] as const,
  useFactory: (events) => new ClockWorker(events),
});
