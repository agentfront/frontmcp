import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    message: z.string().describe('The message to send'),
    useObject: z.boolean().optional().describe('If true, send structured object instead of string'),
    level: z.enum(['debug', 'info', 'warning', 'error']).optional().describe('Log level for the notification'),
  })
  .strict();

const outputSchema = z.object({
  success: z.boolean(),
  notificationSent: z.boolean(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Tool that tests the this.notify() method on ToolContext.
 * This calls the context's notify() method which sends notifications
 * to the current session only.
 */
@Tool({
  name: 'test-notify-method',
  description: 'Tests the this.notify() method for sending notifications to the current session',
  inputSchema,
  outputSchema,
})
export default class TestNotifyMethodTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    let sent: boolean;

    if (input.useObject) {
      // Send structured object notification
      sent = await this.notify(
        {
          message: input.message,
          timestamp: Date.now(),
          source: 'test-notify-method',
        },
        input.level ?? 'info',
      );
    } else {
      // Send string notification
      sent = await this.notify(input.message, input.level ?? 'info');
    }

    return {
      success: true,
      notificationSent: sent,
    };
  }
}
