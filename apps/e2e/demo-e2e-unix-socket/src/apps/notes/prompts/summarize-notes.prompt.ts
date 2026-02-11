import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { notesStore } from '../data/notes.store';

@Prompt({
  name: 'summarize-notes',
  description: 'Generate a summary prompt for all notes',
  arguments: [{ name: 'format', description: 'Summary format (brief or detailed)', required: false }],
})
export default class SummarizeNotesPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const notes = notesStore.getAll();
    const format = args['format'] || 'brief';

    const notesList =
      notes.length > 0 ? notes.map((n) => `- ${n.title}: ${n.content}`).join('\n') : 'No notes available.';

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please summarize the following notes:\n\n${notesList}`,
          },
        },
      ],
      description: `Summarize ${notes.length} notes in ${format} format`,
    };
  }
}
