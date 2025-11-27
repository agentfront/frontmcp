import { App } from '@frontmcp/sdk';
// TODO: OpenAPI adapter disabled due to SDK hook validation bug
// import { OpenapiAdapter } from '@frontmcp/adapters';

// Tools
import { CreateNoteTool, ListNotesTool, GetNoteTool, DeleteNoteTool } from './tools';

// Resources
import { NotesListResource, NoteByIdResource } from './resources';

// Prompts
import { SummarizeNotesPrompt, CreateNoteDraftPrompt } from './prompts';

@App({
  id: 'notes',
  name: 'Notes App',
  // TODO: OpenAPI adapter disabled due to SDK hook validation bug
  // adapters: [
  //   OpenapiAdapter.init({
  //     name: 'backend:api',
  //     url: 'https://frontmcp-test.proxy.beeceptor.com/openapi.json',
  //     baseUrl: 'https://frontmcp-test.proxy.beeceptor.com',
  //   }),
  // ],
  tools: [CreateNoteTool, ListNotesTool, GetNoteTool, DeleteNoteTool],
  resources: [NotesListResource, NoteByIdResource],
  prompts: [SummarizeNotesPrompt, CreateNoteDraftPrompt],
})
export default class NotesApp {}
