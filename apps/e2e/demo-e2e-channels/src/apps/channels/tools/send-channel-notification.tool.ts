import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  channelName: z.string().describe('Channel name to send notification through'),
  content: z.string().describe('Notification content'),
  meta: z.record(z.string(), z.string()).optional().describe('Optional metadata'),
};

@Tool({
  name: 'send-channel-notification',
  description: 'Manually send a notification through the channel system',
  inputSchema,
})
export default class SendChannelNotificationTool extends ToolContext<typeof inputSchema> {
  async execute(input: { channelName: string; content: string; meta?: Record<string, string> }) {
    const scope = this.scope as unknown as {
      channelNotifications?: { send: (name: string, content: string, meta?: Record<string, string>) => void };
    };
    const channelNotifications = scope.channelNotifications;

    if (!channelNotifications) {
      return { sent: false, reason: 'ChannelNotificationService not available' };
    }

    channelNotifications.send(input.channelName, input.content, input.meta);
    return { sent: true, channelName: input.channelName };
  }
}
