import { App } from '@frontmcp/sdk';
import CreateNoteTool from './tools/create-note.tool';
import ListNotesTool from './tools/list-notes.tool';
import NotesListResource from './resources/notes-list.resource';
import NoteResourceTemplate from './resources/note.resource-template';
import SummarizeNotesPrompt from './prompts/summarize-notes.prompt';

@App({
  name: 'Notes',
  description: 'Note-taking application',
  tools: [CreateNoteTool, ListNotesTool],
  resources: [NotesListResource, NoteResourceTemplate],
  prompts: [SummarizeNotesPrompt],
})
export class NotesApp {}
