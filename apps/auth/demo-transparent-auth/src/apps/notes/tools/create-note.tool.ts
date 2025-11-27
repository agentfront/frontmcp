import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'create-note',
  description: 'Create a new note',
  inputSchema: {
    title: z.string().min(1).describe('Note title'),
    content: z.string().describe('Note content'),
    tags: z.array(z.string()).optional().describe('Tags for the note'),
  },
  outputSchema: {
    id: z.string(),
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    createdAt: z.string(),
  },
})
export default class CreateNoteTool extends ToolContext {
  async execute(input: { title: string; content: string; tags?: string[] }) {
    const note = {
      id: `note-${Date.now()}`,
      title: input.title,
      content: input.content,
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
    };
    return note;
  }
}
