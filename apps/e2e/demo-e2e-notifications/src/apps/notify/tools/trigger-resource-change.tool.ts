import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { notificationLogStore } from '../data/notification-log.store';

const inputSchema = {
  uri: z.string().optional().describe('Resource URI that changed'),
};

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  logId: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'trigger-resource-change',
  description: 'Trigger a resource list changed notification',
  inputSchema,
  outputSchema,
})
export default class TriggerResourceChangeTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    // Broadcast resource list changed notification
    this.scope.notifications.broadcastNotification('notifications/resources/list_changed');

    // Log the notification
    const entry = notificationLogStore.log('resource_change', {
      uri: input.uri ?? 'all-resources',
      action: 'list_changed',
    });

    return {
      success: true,
      message: `Resource change notification sent for: ${input.uri ?? 'all resources'}`,
      logId: entry.id,
    };
  }
}
