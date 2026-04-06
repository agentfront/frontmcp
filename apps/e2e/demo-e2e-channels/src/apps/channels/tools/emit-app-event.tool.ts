import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  event: z.string().describe('Event name to emit (e.g., "app:error")'),
  payload: z.record(z.string(), z.unknown()).describe('Event payload'),
};

@Tool({
  name: 'emit-app-event',
  description: 'Emit an app event to the ChannelEventBus for testing channel sources',
  inputSchema,
})
export default class EmitAppEventTool extends ToolContext<typeof inputSchema> {
  async execute(input: { event: string; payload: Record<string, unknown> }) {
    const scope = this.scope as unknown as { channelEventBus?: { emit: (event: string, payload: unknown) => void } };
    const eventBus = scope.channelEventBus;

    if (!eventBus) {
      return { emitted: false, reason: 'ChannelEventBus not available' };
    }

    eventBus.emit(input.event, input.payload);
    return { emitted: true, event: input.event };
  }
}
