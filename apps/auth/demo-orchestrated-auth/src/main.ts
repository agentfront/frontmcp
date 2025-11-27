import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';

@FrontMcp({
  info: { name: 'Demo Orchestrated Auth', version: '0.1.0' },
  apps: [NotesApp, TasksApp],
  logging: { level: LogLevel.VERBOSE },
  http: { port: 3005 },
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
  },
})
export default class Server {}
