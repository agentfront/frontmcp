import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { notificationLogStore } from '../data/notification-log.store';

const inputSchema = z
  .object({
    steps: z.number().int().min(1).max(10).default(5).describe('Number of steps to simulate'),
    delayMs: z.number().int().min(10).max(1000).default(100).describe('Delay between steps in milliseconds'),
  })
  .strict();

const outputSchema = z.object({
  success: z.boolean(),
  totalSteps: z.number(),
  completedAt: z.string(),
  progressLogs: z.array(z.string()),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'long-running-task',
  description: 'Simulates a long-running task with progress notifications',
  inputSchema,
  outputSchema,
})
export default class LongRunningTaskTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const progressLogs: string[] = [];

    // Send starting notification
    this.scope.notifications.sendLogMessage('info', 'long-running-task', {
      message: `Starting task with ${input.steps} steps`,
      step: 0,
      total: input.steps,
    });

    notificationLogStore.log('progress', { step: 0, total: input.steps, status: 'started' });
    progressLogs.push(`Step 0/${input.steps}: Started`);

    // Process each step
    for (let step = 1; step <= input.steps; step++) {
      // Simulate work
      await this.delay(input.delayMs);

      // Calculate progress percentage
      const progress = Math.round((step / input.steps) * 100);

      // Send progress notification
      this.scope.notifications.sendLogMessage('info', 'long-running-task', {
        message: `Processing step ${step}/${input.steps}`,
        step,
        total: input.steps,
        progress,
      });

      notificationLogStore.log('progress', { step, total: input.steps, progress });
      progressLogs.push(`Step ${step}/${input.steps}: ${progress}% complete`);
    }

    // Send completion notification
    this.scope.notifications.sendLogMessage('info', 'long-running-task', {
      message: `Task completed successfully`,
      step: input.steps,
      total: input.steps,
      progress: 100,
    });

    notificationLogStore.log('progress', { step: input.steps, total: input.steps, status: 'completed' });
    progressLogs.push(`Completed all ${input.steps} steps`);

    return {
      success: true,
      totalSteps: input.steps,
      completedAt: new Date().toISOString(),
      progressLogs,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
