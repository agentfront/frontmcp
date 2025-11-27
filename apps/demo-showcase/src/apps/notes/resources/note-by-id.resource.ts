import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { notesStore } from '../data/store';

type NoteParams = {
  noteId: string;
};

@ResourceTemplate({
  name: 'note-by-id',
  uriTemplate: 'notes://note/{noteId}',
  description: 'Get a specific note by its ID',
  mimeType: 'application/json',
})
export default class NoteByIdResource extends ResourceContext<NoteParams> {
  async execute(uri: string, params: NoteParams): Promise<ReadResourceResult> {
    const { noteId } = params;
    const note = notesStore.get(noteId);

    if (!note) {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                error: 'Note not found',
                noteId,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(note, null, 2),
        },
      ],
    };
  }
}
