import { App } from '@frontmcp/sdk';

import SummarizeNotesPrompt from './prompts/summarize-notes.prompt';
import NotesListResource from './resources/notes-list.resource';
import ClearNotesTool from './tools/clear-notes.tool';
import CreateNoteTool from './tools/create-note.tool';
import ListNotesTool from './tools/list-notes.tool';

@App({
  name: 'Notes',
  description: 'Note-taking application for stdio transport E2E testing',
  tools: [CreateNoteTool, ListNotesTool, ClearNotesTool],
  resources: [NotesListResource],
  prompts: [SummarizeNotesPrompt],
})
export class NotesApp {}
