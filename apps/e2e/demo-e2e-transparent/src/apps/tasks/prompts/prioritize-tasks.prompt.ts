import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { z } from 'zod';
import { tasksStore } from '../data/tasks.store';

@Prompt({
  name: 'prioritize-tasks',
  description: 'Generate a prompt to help prioritize tasks',
  arguments: [
    {
      name: 'criteria',
      description: 'Prioritization criteria',
      required: false,
    },
  ],
})
export default class PrioritizeTasksPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const tasks = tasksStore.getAll();
    const criteria = args.criteria || 'importance';

    const tasksList =
      tasks.length > 0
        ? tasks.map((t) => `- [${t.priority}] ${t.title}: ${t.description}`).join('\n')
        : 'No tasks available.';

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please help me prioritize the following tasks based on ${criteria}:\n\n${tasksList}`,
          },
        },
      ],
      description: `Prioritize ${tasks.length} tasks by ${criteria}`,
    };
  }
}
