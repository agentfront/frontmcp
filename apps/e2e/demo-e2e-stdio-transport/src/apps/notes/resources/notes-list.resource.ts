import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { notesStore } from '../data/notes.store';

const outputSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      createdAt: z.string(),
    }),
  ),
  totalCount: z.number(),
});

type NotesListOutput = z.infer<typeof outputSchema>;

@Resource({
  uri: 'notes://all',
  name: 'All Notes',
  description: 'List of all notes in the system',
  mimeType: 'application/json',
})
export default class NotesListResource extends ResourceContext<Record<string, never>, NotesListOutput> {
  async execute(): Promise<NotesListOutput> {
    const notes = notesStore.getAll();
    return {
      notes,
      totalCount: notes.length,
    };
  }
}
