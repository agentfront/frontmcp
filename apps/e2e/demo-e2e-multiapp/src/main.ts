import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';
import { CalendarApp } from './apps/calendar';

const port = parseInt(process.env['PORT'] ?? '3104', 10);

@FrontMcp({
  info: { name: 'Demo E2E MultiApp', version: '0.1.0' },
  apps: [NotesApp, TasksApp, CalendarApp],
  logging: { level: LogLevel.Verbose },
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
