import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import type { ChannelRegistry } from '@frontmcp/sdk';

const getBufferSchema = {
  channelName: z.string().describe('Channel name to get buffer for'),
};

@Tool({
  name: 'get-replay-buffer',
  description: 'Get the replay buffer contents for a channel',
  inputSchema: getBufferSchema,
})
export class GetReplayBufferTool extends ToolContext<typeof getBufferSchema> {
  async execute(input: { channelName: string }) {
    const scope = this.scope as unknown as { channels?: ChannelRegistry };
    const registry = scope.channels;
    if (!registry) return { error: 'Channel system not available' };

    const channel = registry.findByName(input.channelName);
    if (!channel) return { error: `Channel "${input.channelName}" not found` };

    return {
      channelName: input.channelName,
      replayEnabled: channel.replayEnabled,
      bufferSize: channel.replayBuffer.length,
      events: channel.replayBuffer.map((n) => ({ content: n.content, meta: n.meta })),
    };
  }
}

const clearBufferSchema = {
  channelName: z.string().describe('Channel name to clear buffer for'),
};

@Tool({
  name: 'clear-replay-buffer',
  description: 'Clear the replay buffer for a channel',
  inputSchema: clearBufferSchema,
})
export class ClearReplayBufferTool extends ToolContext<typeof clearBufferSchema> {
  async execute(input: { channelName: string }) {
    const scope = this.scope as unknown as { channels?: ChannelRegistry };
    const registry = scope.channels;
    if (!registry) return { error: 'Channel system not available' };

    const channel = registry.findByName(input.channelName);
    if (!channel) return { error: `Channel "${input.channelName}" not found` };

    channel.clearReplayBuffer();
    return { cleared: true, channelName: input.channelName };
  }
}
