import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'create-task',
  description: 'Create a new task',
  inputSchema: {
    title: z.string().min(1).describe('Task title'),
    description: z.string().optional().describe('Task description'),
    priority: z.enum(['low', 'medium', 'high']).optional().describe('Task priority (default: medium)'),
    dueDate: z.string().optional().describe('Due date (ISO format)'),
  },
  outputSchema: {
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    priority: z.enum(['low', 'medium', 'high']),
    dueDate: z.string().nullable(),
    completed: z.boolean(),
    createdAt: z.string(),
  },
})
export default class CreateTaskTool extends ToolContext {
  async execute(input: {
    title: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high';
    dueDate?: string;
  }) {
    return {
      id: `task-${Date.now()}`,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'medium',
      dueDate: input.dueDate ?? null,
      completed: false,
      createdAt: new Date().toISOString(),
    };
  }
}
