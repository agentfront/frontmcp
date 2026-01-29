import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { notesStore } from '../data/notes.store';

const inputSchema = z.object({}).strict();
const outputSchema = z.object({ success: z.boolean() });

@Tool({
  name: 'notes-reset',
  description: 'Clear all notes from the store (for testing)',
  inputSchema,
  outputSchema,
})
export default class NotesResetTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    notesStore.clear();
    return { success: true };
  }
}
