import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { tasksStore } from '../data/tasks.store';

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
  totalCount: z.number(),
});

type TasksListOutput = z.infer<typeof outputSchema>;

@Resource({
  uri: 'tasks://all',
  name: 'All Tasks',
  description: 'List of all tasks in the system',
  mimeType: 'application/json',
})
export default class TasksListResource extends ResourceContext<Record<string, never>, TasksListOutput> {
  async execute(): Promise<TasksListOutput> {
    const tasks = tasksStore.getAll();
    return {
      tasks,
      totalCount: tasks.length,
    };
  }
}
