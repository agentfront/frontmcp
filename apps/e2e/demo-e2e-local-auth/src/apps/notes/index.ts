import { App } from '@frontmcp/sdk';

import { FlowAccessPlugin } from '../flow-access/flow-access.plugin';
import CreateNoteTool from './tools/create-note.tool';
import ListNotesTool from './tools/list-notes.tool';

@App({
  name: 'Notes',
  description: 'Simple note-taking application for LOCAL-mode auth E2E testing',
  tools: [CreateNoteTool, ListNotesTool],
  plugins: [FlowAccessPlugin],
})
export class NotesApp {}
