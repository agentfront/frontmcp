import { App } from '@frontmcp/sdk';

import { FlowAccessPlugin } from '../flow-access/flow-access.plugin';
import SummarizeNotesPrompt from './prompts/summarize-notes.prompt';
import NotesListResource from './resources/notes-list.resource';
import CreateNoteTool from './tools/create-note.tool';
import ListNotesTool from './tools/list-notes.tool';
import NotesResetTool from './tools/notes-reset.tool';

@App({
  name: 'Notes',
  description: 'Note-taking application for E2E testing',
  tools: [CreateNoteTool, ListNotesTool, NotesResetTool],
  resources: [NotesListResource],
  prompts: [SummarizeNotesPrompt],
  plugins: [FlowAccessPlugin],
})
export class NotesApp {}
