import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'complete-task',
  description: 'Mark a task as completed',
  inputSchema: {
    taskId: z.string().describe('Task ID to complete'),
  },
  outputSchema: {
    id: z.string(),
    completed: z.boolean(),
    completedAt: z.string(),
  },
})
export default class CompleteTaskTool extends ToolContext {
  async execute(input: { taskId: string }) {
    return {
      id: input.taskId,
      completed: true,
      completedAt: new Date().toISOString(),
    };
  }
}
