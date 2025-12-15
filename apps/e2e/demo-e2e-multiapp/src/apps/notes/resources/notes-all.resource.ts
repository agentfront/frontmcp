import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { noteStore } from '../data/note.store';

const outputSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
  ),
  count: z.number(),
  app: z.string(),
});

type Output = z.infer<typeof outputSchema>;

@Resource({
  uri: 'notes://all',
  name: 'All Notes',
  description: 'All notes in the system',
  mimeType: 'application/json',
})
export default class NotesAllResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    const store = noteStore;
    const notes = store.getAll();

    return {
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      count: notes.length,
      app: 'notes',
    };
  }
}
