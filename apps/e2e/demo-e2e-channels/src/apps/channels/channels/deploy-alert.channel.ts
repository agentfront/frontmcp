import { Channel, ChannelContext } from '@frontmcp/sdk';
import type { ChannelNotification } from '@frontmcp/sdk';

@Channel({
  name: 'deploy-alerts',
  description: 'CI/CD deployment status notifications',
  source: { type: 'webhook', path: '/hooks/deploy' },
  meta: { team: 'platform' },
})
export class DeployAlertChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body } = payload as { body: Record<string, unknown> };
    const data = body as { status: string; version: string; env?: string };
    return {
      content: `Deploy ${data.status}: ${data.version}`,
      meta: {
        status: data.status,
        version: data.version,
        ...(data.env ? { env: data.env } : {}),
      },
    };
  }
}
