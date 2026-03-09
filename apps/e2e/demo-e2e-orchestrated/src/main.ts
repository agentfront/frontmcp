import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';

// Get port from env variable (set by test runner) or default to 3121
const port = parseInt(process.env['PORT'] ?? '3121', 10);

@FrontMcp({
  info: { name: 'Demo Orchestrated Auth', version: '0.1.0' },
  apps: [NotesApp, TasksApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    consent: {
      enabled: true,
      groupByApp: true,
      showDescriptions: true,
      allowSelectAll: true,
      requireSelection: true,
      rememberConsent: true,
    },
    tokenStorage: 'memory', // Use { redis: ... } in production
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    sessionMode: 'stateful',
    protocol: {
      sse: true,
      streamable: true,
      json: true,
      stateless: false,
      legacy: false,
      strictSession: false,
    },
  },
})
export default class Server {}
