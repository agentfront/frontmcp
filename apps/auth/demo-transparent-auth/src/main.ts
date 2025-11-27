import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';

@FrontMcp({
  info: { name: 'Demo Transparent Auth', version: '0.1.0' },
  apps: [NotesApp, TasksApp],
  logging: { level: LogLevel.VERBOSE },
  http: { port: 3004 },
  auth: {
    mode: 'transparent',
    remote: {
      provider: process.env.IDP_PROVIDER_URL || 'https://auth.example.com',
      dcrEnabled: false,
    },
    expectedAudience: process.env.IDP_EXPECTED_AUDIENCE || 'https://api.example.com',
    requiredScopes: [],
    allowAnonymous: false,
    anonymousScopes: ['anonymous'],
  },
})
export default class Server {}
