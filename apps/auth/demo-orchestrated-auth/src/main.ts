import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';

// Get port from env variable (set by test runner) or default to 3005
const port = parseInt(process.env['PORT'] ?? '3005', 10);

@FrontMcp({
  info: { name: 'Demo Orchestrated Auth', version: '0.1.0' },
  apps: [NotesApp, TasksApp],
  logging: { level: LogLevel.VERBOSE },
  http: { port },
  auth: {
    mode: 'orchestrated',
    type: 'local',
    consent: {
      enabled: true,
      groupByApp: true,
      showDescriptions: true,
      allowSelectAll: true,
      requireSelection: true,
      rememberConsent: true,
    },
    sessionMode: 'stateful',
    tokenStorage: {
      type: 'memory', // Use 'redis' in production
    },
    allowDefaultPublic: false,
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
