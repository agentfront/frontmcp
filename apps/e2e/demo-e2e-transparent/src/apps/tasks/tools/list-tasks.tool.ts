import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { tasksStore } from '../data/tasks.store';

const inputSchema = {
  onlyMine: z.boolean().optional().describe('Only show tasks created by current user'),
};

const outputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      priority: z.enum(['low', 'medium', 'high']),
      completed: z.boolean(),
      createdBy: z.string(),
      createdAt: z.string(),
    }),
  ),
  count: z.number(),
});

type ListTasksInput = z.infer<z.ZodObject<typeof inputSchema>>;
type ListTasksOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'list-tasks',
  description: 'List all tasks or tasks created by the current user',
  inputSchema,
  outputSchema,
})
export default class ListTasksTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: ListTasksInput): Promise<ListTasksOutput> {
    const authInfo = this.authInfo;
    const userId = authInfo?.user?.sub || 'anonymous';

    let tasks = tasksStore.getAll();

    if (input.onlyMine) {
      tasks = tasksStore.getByUser(userId);
    }

    return {
      tasks,
      count: tasks.length,
    };
  }
}
