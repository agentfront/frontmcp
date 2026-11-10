import { AsyncProvider, Duty, EVENT_PUBLISHER, type DutyInterface, type EventPublisher } from '@frontmcp/sdk';

import { clockTicked } from '../events/clock-ticked.event';

/** Publishes clock.ticked every second, in the one process that holds the duty's lease. */
@Duty({ name: 'heartbeat', every: '1s', scope: 'machine' })
class HeartbeatDuty implements DutyInterface {
  private tick = 0;

  constructor(private readonly events: EventPublisher) {}

  async run(): Promise<void> {
    await this.events.publish(clockTicked, { source: 'duty', tick: this.tick });
    this.tick += 1;
  }
}

/** The duty, built with the publisher behind the EVENT_PUBLISHER token. */
export const heartbeatDuty = AsyncProvider({
  provide: HeartbeatDuty,
  name: 'heartbeat-duty',
  inject: () => [EVENT_PUBLISHER] as const,
  useFactory: (events) => new HeartbeatDuty(events),
});
