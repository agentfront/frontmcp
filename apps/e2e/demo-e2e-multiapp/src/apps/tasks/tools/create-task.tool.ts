import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { taskStore, TaskPriority } from '../data/task.store';

const inputSchema = {
  title: z.string().min(1).describe('Task title'),
  description: z.string().optional().default('').describe('Task description'),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium').describe('Task priority'),
};

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  status: z.enum(['pending', 'in_progress', 'completed']),
  createdAt: z.number(),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'create-task',
  description: 'Create a new task',
  inputSchema,
  outputSchema,
})
export default class CreateTaskTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const store = taskStore;
    const task = store.create(input.title, input.description, input.priority as TaskPriority);

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      createdAt: task.createdAt,
    };
  }
}
