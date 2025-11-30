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
      enableLegacySSE: true, // Enable legacy SSE endpoint (/sse)
      enableSseListener: true, // Enable SSE listener for modern SSE with session
    },
  },
})
export default class Server {}
