import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { taskStore } from '../data/task.store';

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
  byPriority: z.object({
    high: z.number(),
    medium: z.number(),
    low: z.number(),
  }),
  app: z.string(),
});

type Output = z.infer<typeof outputSchema>;

@Resource({
  uri: 'tasks://all',
  name: 'All Tasks',
  description: 'All tasks in the system',
  mimeType: 'application/json',
})
export default class TasksAllResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    const store = taskStore;
    const tasks = store.getAll();

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
      byPriority: {
        high: store.getByPriority('high').length,
        medium: store.getByPriority('medium').length,
        low: store.getByPriority('low').length,
      },
      app: 'tasks',
    };
  }
}
