import { Channel, ChannelContext } from '@frontmcp/sdk';
import type { ChannelNotification } from '@frontmcp/sdk';

/** Store for replies received via the channel-reply tool (for testing) */
export const replyLog: Array<{ reply: string; meta?: Record<string, string> }> = [];

@Channel({
  name: 'chat-bridge',
  description: 'Two-way chat bridge (simulated messaging service)',
  source: { type: 'webhook', path: '/hooks/chat' },
  twoWay: true,
  meta: { platform: 'test_chat' },
})
export class ChatBridgeChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body } = payload as { body: Record<string, unknown> };
    const data = body as { sender: string; text: string; chatId: string };
    return {
      content: `${data.sender}: ${data.text}`,
      meta: {
        chat_id: data.chatId,
        sender: data.sender,
      },
    };
  }

  async onReply(reply: string, meta?: Record<string, string>): Promise<void> {
    replyLog.push({ reply, meta });
    this.logger.info(`Chat bridge reply to ${meta?.chat_id}: ${reply}`);
  }
}
