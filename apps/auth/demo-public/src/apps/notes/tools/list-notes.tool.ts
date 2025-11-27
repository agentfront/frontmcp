import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'list-notes',
  description: 'List all notes, optionally filtered by tag',
  inputSchema: {
    tag: z.string().optional().describe('Filter by tag'),
    limit: z.number().int().positive().optional().describe('Max notes to return (default: 10)'),
  },
  outputSchema: {
    notes: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        tags: z.array(z.string()),
        createdAt: z.string(),
      }),
    ),
    total: z.number(),
  },
})
export default class ListNotesTool extends ToolContext {
  async execute(input: { tag?: string; limit?: number }) {
    const { tag, limit } = input;

    // Mock data
    const mockNotes = [
      { id: 'note-1', title: 'Meeting Notes', tags: ['work'], createdAt: '2024-01-15T10:00:00Z' },
      { id: 'note-2', title: 'Shopping List', tags: ['personal'], createdAt: '2024-01-14T15:30:00Z' },
    ];
    const filtered = tag ? mockNotes.filter((n) => n.tags.includes(tag)) : mockNotes;

    return { notes: filtered.slice(0, limit ?? 10), total: filtered.length };
  }
}
