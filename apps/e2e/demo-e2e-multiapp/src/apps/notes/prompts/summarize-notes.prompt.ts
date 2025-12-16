import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { noteStore } from '../data/note.store';

@Prompt({
  name: 'summarize-notes',
  description: 'Generate a summary of all notes',
  arguments: [],
})
export default class SummarizeNotesPrompt extends PromptContext {
  async execute(_args: Record<string, string>): Promise<GetPromptResult> {
    const store = noteStore;
    const notes = store.getAll();

    let content: string;

    if (notes.length === 0) {
      content = `# Notes Summary

No notes found. Create some notes using the \`create-note\` tool.`;
    } else {
      const notesList = notes
        .map((n) => `## ${n.title}\n${n.content}\n*Created: ${new Date(n.createdAt).toISOString()}*`)
        .join('\n\n');

      content = `# Notes Summary

**Total Notes**: ${notes.length}
**App**: notes

${notesList}`;
    }

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: content,
          },
        },
      ],
      description: `Notes summary (${notes.length} notes)`,
    };
  }
}
