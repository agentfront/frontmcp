import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { taskStore, TaskPriority } from '../data/task.store';

const inputSchema = z
  .object({
    priority: z.enum(['low', 'medium', 'high', 'all']).default('all').describe('Filter by priority'),
  })
  .strict();

const outputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      priority: z.enum(['low', 'medium', 'high']),
      status: z.enum(['pending', 'in_progress', 'completed']),
      createdAt: z.number(),
    }),
  ),
  count: z.number(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'list-tasks',
  description: 'List all tasks',
  inputSchema,
  outputSchema,
})
export default class ListTasksTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const tasks =
      input.priority === 'all' ? taskStore.getAll() : taskStore.getByPriority(input.priority as TaskPriority);

    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt,
      })),
      count: tasks.length,
    };
  }
}
