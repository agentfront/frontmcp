import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';

// Get port from env variable (set by test runner) or default to 3004
const port = parseInt(process.env['PORT'] ?? '3004', 10);

@FrontMcp({
  info: { name: 'Demo Transparent Auth', version: '0.1.0' },
  apps: [NotesApp, TasksApp],
  logging: { level: LogLevel.VERBOSE },
  http: { port },
  auth: {
    mode: 'transparent',
    remote: {
      provider: process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com',
      dcrEnabled: false,
    },
    expectedAudience: process.env['IDP_EXPECTED_AUDIENCE'] || 'https://sample-app.frontegg.com',
    requiredScopes: [],
    allowAnonymous: false,
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
