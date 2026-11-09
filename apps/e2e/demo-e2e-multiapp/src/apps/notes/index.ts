import { App } from '@frontmcp/sdk';

import SummarizeNotesPrompt from './prompts/summarize-notes.prompt';
import NotesAllResource from './resources/notes-all.resource';
import CreateNoteTool from './tools/create-note.tool';
import ListNotesTool from './tools/list-notes.tool';

@App({
  name: 'notes',
  description: 'Notes management app',
  tools: [CreateNoteTool, ListNotesTool],
  resources: [NotesAllResource],
  prompts: [SummarizeNotesPrompt],
})
export class NotesApp {}
