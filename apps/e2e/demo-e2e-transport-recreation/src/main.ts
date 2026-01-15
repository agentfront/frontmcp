import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { TransportTestApp } from './apps/transport-test';

const portEnv = process.env['PORT'] ?? '3102';
const port = parseInt(portEnv, 10);
if (isNaN(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT environment variable: "${portEnv}". Must be a number between 1 and 65535.`);
}

@FrontMcp({
  info: { name: 'Demo E2E Transport Recreation', version: '0.1.0' },
  apps: [TransportTestApp],
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
