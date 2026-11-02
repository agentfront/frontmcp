import { App } from '@frontmcp/sdk';

import SummarizeNotesPrompt from './prompts/summarize-notes.prompt';
import { notesArchiveProvider } from './providers/notes-archive.provider';
import NotesListResource from './resources/notes-list.resource';
import CreateNoteTool from './tools/create-note.tool';
import GetAuthInfoTool from './tools/get-auth-info.tool';
import ListNotesTool from './tools/list-notes.tool';

@App({
  name: 'Notes',
  description: 'Note-taking application for E2E testing',
  providers: [notesArchiveProvider],
  tools: [CreateNoteTool, ListNotesTool, GetAuthInfoTool],
  resources: [NotesListResource],
  prompts: [SummarizeNotesPrompt],
})
export class NotesApp {}
