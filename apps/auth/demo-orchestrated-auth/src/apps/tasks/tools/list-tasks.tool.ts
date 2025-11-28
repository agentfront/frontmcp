import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'list-tasks',
  description: 'List all tasks',
  inputSchema: {
    status: z.enum(['all', 'pending', 'completed']).optional().describe('Filter by status (default: all)'),
    priority: z.enum(['low', 'medium', 'high']).optional().describe('Filter by priority'),
  },
  outputSchema: {
    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        priority: z.enum(['low', 'medium', 'high']),
        completed: z.boolean(),
      }),
    ),
    total: z.number(),
  },
})
export default class ListTasksTool extends ToolContext {
  async execute(input: { status?: 'all' | 'pending' | 'completed'; priority?: 'low' | 'medium' | 'high' }) {
    const mockTasks = [
      { id: 'task-1', title: 'Review PR', priority: 'high' as const, completed: false },
      { id: 'task-2', title: 'Write tests', priority: 'medium' as const, completed: true },
    ];
    let filtered = mockTasks;
    if (input.status === 'pending') filtered = filtered.filter((t) => !t.completed);
    if (input.status === 'completed') filtered = filtered.filter((t) => t.completed);
    if (input.priority) filtered = filtered.filter((t) => t.priority === input.priority);
    return { tasks: filtered, total: filtered.length };
  }
}
