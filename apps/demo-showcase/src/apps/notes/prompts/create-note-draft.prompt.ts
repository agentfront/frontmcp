import { Prompt, PromptContext } from '@frontmcp/sdk';

@Prompt({
  name: 'create-note-draft',
  description: 'Help draft a new note based on a topic and style',
  arguments: [
    {
      name: 'topic',
      description: 'The topic or subject of the note',
      required: true,
    },
    {
      name: 'style',
      description: 'Writing style: formal, casual, technical, or creative',
      required: false,
    },
  ],
})
export default class CreateNoteDraftPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    const { topic, style = 'casual' } = args;

    return {
      description: `Draft a note about "${topic}"`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please help me draft a note about "${topic}" in a ${style} style.

Include:
1. A clear, descriptive title
2. Well-organized content with main points
3. Suggested tags for categorization
4. Any relevant action items or next steps

Format your response as:
Title: [suggested title]
Tags: [comma-separated tags]
Content:
[the note content]`,
          },
        },
      ],
    };
  }
}
