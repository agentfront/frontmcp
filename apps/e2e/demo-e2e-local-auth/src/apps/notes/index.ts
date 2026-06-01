import { App } from '@frontmcp/sdk';

import CreateNoteTool from './tools/create-note.tool';
import ListNotesTool from './tools/list-notes.tool';

@App({
  name: 'Notes',
  description: 'Simple note-taking application for LOCAL-mode auth E2E testing',
  tools: [CreateNoteTool, ListNotesTool],
})
export class NotesApp {}
