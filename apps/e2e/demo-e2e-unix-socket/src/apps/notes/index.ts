import { App } from '@frontmcp/sdk';
import CreateNoteTool from './tools/create-note.tool';
import ListNotesTool from './tools/list-notes.tool';
import GetAuthInfoTool from './tools/get-auth-info.tool';
import NotesListResource from './resources/notes-list.resource';
import SummarizeNotesPrompt from './prompts/summarize-notes.prompt';

@App({
  name: 'Notes',
  description: 'Note-taking application for E2E testing',
  tools: [CreateNoteTool, ListNotesTool, GetAuthInfoTool],
  resources: [NotesListResource],
  prompts: [SummarizeNotesPrompt],
})
export class NotesApp {}
