import { Channel, ChannelContext } from '@frontmcp/sdk';
import type { ChannelNotification } from '@frontmcp/sdk';

@Channel({
  name: 'error-alerts',
  description: 'Application error notifications',
  source: { type: 'app-event', event: 'app:error' },
})
export class ErrorAlertChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const raw = payload as Record<string, unknown> | undefined;
    const level = typeof raw?.['level'] === 'string' ? raw['level'] : 'unknown';
    const message = typeof raw?.['message'] === 'string' ? raw['message'] : 'No message';
    const code = typeof raw?.['code'] === 'string' ? raw['code'] : undefined;
    return {
      content: `[${level.toUpperCase()}] ${message}`,
      meta: {
        severity: level,
        ...(code ? { code } : {}),
      },
    };
  }
}
