import { Prompt, PromptContext } from '@frontmcp/sdk';

@Prompt({
  name: 'prioritize-tasks',
  description: 'Help prioritize pending tasks',
  arguments: [
    {
      name: 'criteria',
      description: 'Prioritization criteria (deadline, importance, or effort)',
      required: false,
    },
  ],
})
export default class PrioritizeTasksPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    const { criteria } = args;

    return {
      description: `Task prioritization by ${criteria ?? 'importance'}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please help me prioritize my pending tasks based on ${
              criteria ?? 'importance'
            }. Consider the task titles and priorities.`,
          },
        },
      ],
    };
  }
}
