import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { CalendarApp } from './apps/calendar';
import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';
import ServerInfoTool from './shared/server-info.tool';
import ServerStatusResource from './shared/server-status.resource';

const port = parseInt(process.env['PORT'] ?? '3104', 10);

@FrontMcp({
  info: { name: 'Demo E2E MultiApp', version: '0.1.0' },
  apps: [NotesApp, TasksApp, CalendarApp],
  tools: [ServerInfoTool],
  resources: [ServerStatusResource],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
