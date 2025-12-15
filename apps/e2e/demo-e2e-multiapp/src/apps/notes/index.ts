import { App } from '@frontmcp/sdk';

import CreateNoteTool from './tools/create-note.tool';
import ListNotesTool from './tools/list-notes.tool';

import NotesAllResource from './resources/notes-all.resource';

import SummarizeNotesPrompt from './prompts/summarize-notes.prompt';

@App({
  name: 'notes',
  description: 'Notes management app',
  tools: [CreateNoteTool, ListNotesTool],
  resources: [NotesAllResource],
  prompts: [SummarizeNotesPrompt],
})
export class NotesApp {}
