// file: libs/sdk/src/channel/reply/channel-reply.tool.ts

/**
 * ChannelReplyTool — auto-registered system tool for two-way channel communication.
 *
 * When a channel is declared with `twoWay: true`, this tool is dynamically
 * registered so Claude Code can send replies back through the channel.
 *
 * Pattern follows SendElicitationResultTool — system tool registered dynamically.
 */

import type { CallToolResult } from '@frontmcp/protocol';

import { Tool, ToolContext } from '../../common';
import type ChannelRegistry from '../channel.registry';
import { channelReplyInputSchema, type ChannelReplyInput } from './reply.types';

@Tool({
  name: 'channel-reply',
  description:
    'Reply to a notification channel. Use this to send a message back through a two-way channel ' +
    '(e.g., chat bridge, messaging service). Specify the channel_name and the text to send.',
  inputSchema: channelReplyInputSchema,
  annotations: {
    title: 'Channel Reply',
    openWorldHint: true,
  },
})
export class ChannelReplyTool extends ToolContext {
  async execute(input: ChannelReplyInput): Promise<CallToolResult> {
    const { channel_name, text, meta } = input;

    this.logger.info('channel-reply: processing', { channel_name, textLength: text.length });

    // Resolve the channel registry from scope (same casting pattern as job tools)
    const scope = this.scope as unknown as { channels?: ChannelRegistry };
    const channelRegistry = scope.channels;
    if (!channelRegistry) {
      this.logger.error('channel-reply: channel registry not available');
      return {
        content: [{ type: 'text', text: 'Error: Channel system is not enabled on this server.' }],
        isError: true,
      };
    }

    // Find the target channel
    const channel = channelRegistry.findByName(channel_name);
    if (!channel) {
      this.logger.warn(`channel-reply: channel "${channel_name}" not found`);
      return {
        content: [
          {
            type: 'text',
            text: `Error: Channel "${channel_name}" not found. Available channels: ${channelRegistry
              .getChannelInstances()
              .filter((c) => c.twoWay)
              .map((c) => c.name)
              .join(', ')}`,
          },
        ],
        isError: true,
      };
    }

    if (!channel.twoWay) {
      this.logger.warn(`channel-reply: channel "${channel_name}" is not two-way`);
      return {
        content: [{ type: 'text', text: `Error: Channel "${channel_name}" does not support replies (one-way only).` }],
        isError: true,
      };
    }

    try {
      await channel.handleReply(text, meta);
      this.logger.info(`channel-reply: reply sent to channel "${channel_name}"`);
      return {
        content: [{ type: 'text', text: `Reply sent to channel "${channel_name}" successfully.` }],
      };
    } catch (err) {
      this.logger.error(`channel-reply: failed to send reply to channel "${channel_name}"`, { error: err });
      return {
        content: [
          {
            type: 'text',
            text: `Error: Failed to send reply to channel "${channel_name}": ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }
}
