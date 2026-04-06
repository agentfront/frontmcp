import { Channel, ChannelContext } from '@frontmcp/sdk';
import type { ChannelNotification } from '@frontmcp/sdk';

@Channel({
  name: 'replay-alerts',
  description: 'Channel with replay buffer for testing event persistence',
  source: { type: 'app-event', event: 'replay:test' },
  replay: {
    enabled: true,
    maxEvents: 5,
  },
})
export class ReplayAlertChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const data = payload as { index: number; message: string };
    return {
      content: `Event #${data.index}: ${data.message}`,
      meta: { index: String(data.index) },
    };
  }
}
