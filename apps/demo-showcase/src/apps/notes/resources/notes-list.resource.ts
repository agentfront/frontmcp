import { Resource, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { notesStore } from '../data/store';

@Resource({
  name: 'notes-list',
  uri: 'notes://all',
  description: 'List of all notes in the system',
  mimeType: 'application/json',
})
export default class NotesListResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    const notes = notesStore.list();
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              notes,
              count: notes.length,
              fetchedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
