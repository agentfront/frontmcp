import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { notificationLogStore } from '../data/notification-log.store';

const inputSchema = z
  .object({
    level: z.enum(['debug', 'info', 'notice', 'warning', 'error']).optional().default('info').describe('Log level'),
    message: z.string().describe('Progress message'),
    data: z.record(z.string(), z.unknown()).optional().describe('Additional data'),
  })
  .strict();

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  logId: z.string(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'trigger-progress',
  description: 'Send a progress/log notification to the client',
  inputSchema,
  outputSchema,
})
export default class TriggerProgressTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    // Send log message notification
    this.scope.notifications.sendLogMessage(input.level ?? 'info', 'notify-app', {
      message: input.message,
      ...(input.data ?? {}),
    });

    // Log the notification locally
    const entry = notificationLogStore.log('progress', {
      level: input.level,
      message: input.message,
      data: input.data ?? {},
    });

    return {
      success: true,
      message: `Progress notification sent: ${input.message}`,
      logId: entry.id,
    };
  }
}
