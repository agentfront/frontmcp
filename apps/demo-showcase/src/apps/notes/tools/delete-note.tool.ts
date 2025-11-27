import { Tool, ToolContext } from '@frontmcp/sdk';
import z from 'zod';
import { notesStore } from '../data/store';

@Tool({
  name: 'delete-note',
  description: 'Delete a note by its ID',
  inputSchema: {
    id: z.string().min(1).describe('The ID of the note to delete'),
  },
  outputSchema: {
    success: z.boolean(),
    message: z.string(),
  },
})
export default class DeleteNoteTool extends ToolContext {
  async execute(input: { id: string }) {
    const deleted = notesStore.delete(input.id);
    if (!deleted) {
      throw new Error(`Note with ID "${input.id}" not found`);
    }
    return {
      success: true,
      message: `Note "${input.id}" deleted successfully`,
    };
  }
}
