import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

type NoteParams = {
  noteId: string;
};

@ResourceTemplate({
  name: 'note-by-id',
  uriTemplate: 'notes://note/{noteId}',
  description: 'Get a specific note by ID',
  mimeType: 'application/json',
})
export default class NoteResourceTemplate extends ResourceContext<NoteParams> {
  async execute(uri: string, params: NoteParams): Promise<ReadResourceResult> {
    const { noteId } = params;
    const data = {
      id: noteId,
      title: `Note ${noteId}`,
      content: 'Sample content',
      tags: ['sample'],
      createdAt: new Date().toISOString(),
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
