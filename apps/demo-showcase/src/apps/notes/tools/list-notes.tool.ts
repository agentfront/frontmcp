import { Tool, ToolContext } from '@frontmcp/sdk';
import z from 'zod';
import { notesStore } from '../data/store';

@Tool({
  name: 'list-notes',
  description: 'List all notes, optionally filtered by tag',
  inputSchema: {
    tag: z.string().optional().describe('Optional tag to filter notes'),
  },
  outputSchema: {
    notes: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
        tags: z.array(z.string()),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ),
    count: z.number(),
  },
})
export default class ListNotesTool extends ToolContext {
  async execute(input: { tag?: string }) {
    const notes = notesStore.list(input.tag);
    return {
      notes,
      count: notes.length,
    };
  }
}
