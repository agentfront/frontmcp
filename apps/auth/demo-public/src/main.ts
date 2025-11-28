import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';

// Get port from env variable (set by test runner) or default to 3003
const port = parseInt(process.env['PORT'] ?? '3003', 10);

@FrontMcp({
  info: { name: 'Demo Public', version: '0.1.0' },
  apps: [NotesApp, TasksApp],
  logging: { level: LogLevel.VERBOSE },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
    transport: {
      enableStatefulHttp: true,
      enableStreamableHttp: true,
      enableStatelessHttp: false,
      requireSessionForStreamable: false,
    },
  },
})
export default class Server {}
