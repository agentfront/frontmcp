import { Prompt, PromptContext } from '@frontmcp/sdk';

@Prompt({
  name: 'summarize-notes',
  description: 'Generate a summary of notes',
  arguments: [
    {
      name: 'tag',
      description: 'Filter notes by tag',
      required: false,
    },
    {
      name: 'format',
      description: 'Summary format (brief or detailed)',
      required: false,
    },
  ],
})
export default class SummarizeNotesPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    const { tag, format } = args;

    return {
      description: `Summary of notes${tag ? ` tagged with "${tag}"` : ''}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please summarize the following notes${tag ? ` tagged with "${tag}"` : ''}. Format: ${
              format ?? 'brief'
            }.`,
          },
        },
      ],
    };
  }
}
