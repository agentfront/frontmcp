import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ReportsApp } from './apps/reports';
import { ResultsApp } from './apps/results';

const port = parseInt(process.env['PORT'] ?? '3210', 10);

@FrontMcp({
  info: { name: 'Demo E2E Answer Shaping', version: '0.1.0' },
  apps: [ReportsApp, ResultsApp],
  logging: { level: LogLevel.Warn },
  http: { port, forwardHeaders: ['x-acme-*'] },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
  output: { budget: { maxBytes: 64 * 1024 } },
  clients: {
    'summary-agent*': { structured: 'only' },
    'text-agent*': { structured: 'text' },
  },
  metrics: { enabled: true },
})
export default class Server {}
