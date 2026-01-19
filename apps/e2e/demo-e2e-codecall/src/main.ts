import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { CrmApp } from './apps/crm';

const port = parseInt(process.env['PORT'] ?? '3105', 10);

@FrontMcp({
  info: { name: 'Demo E2E CodeCall', version: '0.1.0' },
  apps: [CrmApp],
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
