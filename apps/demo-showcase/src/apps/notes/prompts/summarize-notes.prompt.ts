import { Prompt, PromptContext } from '@frontmcp/sdk';
import { notesStore } from '../data/store';

@Prompt({
  name: 'summarize-notes',
  description: 'Generate a summary of all notes, optionally filtered by tag',
  arguments: [
    {
      name: 'tag',
      description: 'Optional tag to filter notes for summarization',
      required: false,
    },
    {
      name: 'format',
      description: 'Output format: brief, detailed, or bullet-points',
      required: false,
    },
  ],
})
export default class SummarizeNotesPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    const { tag, format = 'detailed' } = args;
    const notes = notesStore.list(tag);

    const tagFilter = tag ? ` with tag "${tag}"` : '';
    const notesList = notes
      .map((n) => `- ${n.title}: ${n.content.substring(0, 100)}${n.content.length > 100 ? '...' : ''}`)
      .join('\n');

    return {
      description: `Summary of ${notes.length} notes${tagFilter}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please summarize the following ${notes.length} notes${tagFilter} in ${format} format.

Notes:
${notesList || 'No notes found.'}

Provide:
1. Overall theme or common topics
2. Key points from each note
3. Any actionable items or important dates mentioned
4. Suggestions for organization or follow-up`,
          },
        },
      ],
    };
  }
}
