import { Prompt, PromptContext } from '@frontmcp/sdk';

@Prompt({
  name: 'code-review',
  description: 'Generate a code review prompt for a given language',
  arguments: [
    {
      name: 'language',
      description: 'Programming language to review',
      required: true,
    },
    {
      name: 'style',
      description: 'Review style (e.g., thorough, quick)',
      required: false,
    },
  ],
})
export default class CodeReviewPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    const { language, style } = args;
    const styleNote = style ? ` with a ${style} review style` : '';

    return {
      description: `Code review for ${language}${styleNote}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please review the following ${language} code${styleNote}. Focus on best practices, potential bugs, and performance improvements.`,
          },
        },
      ],
    };
  }
}
