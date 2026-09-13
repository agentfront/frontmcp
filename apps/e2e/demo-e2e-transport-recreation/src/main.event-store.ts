/**
 * Server with SSE resumability (the memory EventStore) explicitly enabled.
 *
 * The store is shared by every session on the scope, which is what made
 * GHSA-84j6-jc92-77jm possible: a client could present another session's
 * `Last-Event-ID` and be handed that session's backlog.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { TransportTestApp } from './apps/transport-test';

const portEnv = process.env['PORT'] ?? '3104';
const port = parseInt(portEnv, 10);
if (isNaN(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT environment variable: "${portEnv}". Must be a number between 1 and 65535.`);
}

@FrontMcp({
  info: { name: 'Demo E2E Event Store', version: '0.1.0' },
  apps: [TransportTestApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  transport: {
    sessionMode: 'stateful',
    eventStore: { enabled: true, provider: 'memory' },
  },
})
export default class Server {}
