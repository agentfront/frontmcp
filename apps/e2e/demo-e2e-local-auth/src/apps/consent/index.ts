import { App } from '@frontmcp/sdk';

import CreateNoteTool from '../notes/tools/create-note.tool';
import ListNotesTool from '../notes/tools/list-notes.tool';
import PingTool from './tools/ping.tool';

/**
 * App used by the consent-mode E2E. Three tools:
 * - `create-note` and `list-notes` are offered on the consent screen,
 * - `ping` is configured as an `excludedTools` member (always available).
 */
@App({
  name: 'ConsentNotes',
  description: 'Notes app variant for consent-mode E2E testing',
  tools: [CreateNoteTool, ListNotesTool, PingTool],
})
export class ConsentNotesApp {}
