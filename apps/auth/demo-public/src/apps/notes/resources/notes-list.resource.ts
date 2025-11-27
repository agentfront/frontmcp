import { Resource, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

@Resource({
  name: 'notes-list',
  uri: 'notes://all',
  description: 'List of all notes',
  mimeType: 'application/json',
})
export default class NotesListResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    const data = {
      notes: [
        { id: 'note-1', title: 'Meeting Notes', tags: ['work'] },
        { id: 'note-2', title: 'Shopping List', tags: ['personal'] },
      ],
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
}
