import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { tasksStore } from '../data/tasks.store';

const inputSchema = {
  title: z.string().describe('Title of the task'),
  description: z.string().describe('Description of the task'),
  priority: z.enum(['low', 'medium', 'high']).optional().describe('Task priority'),
};

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  completed: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
});

type CreateTaskInput = z.input<z.ZodObject<typeof inputSchema>>;
type CreateTaskOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'create-task',
  description: 'Create a new task',
  inputSchema,
  outputSchema,
})
export default class CreateTaskTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: CreateTaskInput): Promise<CreateTaskOutput> {
    const authInfo = this.getAuthInfo();
    const userId = authInfo?.user?.sub || 'anonymous';

    const task = {
      id: `task-${Date.now()}`,
      title: input.title,
      description: input.description,
      priority: input.priority || 'medium',
      completed: false,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };

    tasksStore.add(task);

    return task;
  }
}
