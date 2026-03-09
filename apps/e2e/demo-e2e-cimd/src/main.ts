import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';

// Get port from env variable (set by test runner) or default to 3150
const parsedPort = parseInt(process.env['PORT'] ?? '3150', 10);
const port = Number.isNaN(parsedPort) ? 3150 : parsedPort;

/**
 * Demo server for CIMD (Client ID Metadata Documents) E2E testing.
 *
 * This server is configured with:
 * - CIMD enabled with allowInsecureForTesting for HTTP localhost URLs
 * - Local auth mode (signs its own tokens)
 * - allowDefaultPublic: false (requires authentication)
 */
@FrontMcp({
  info: { name: 'Demo CIMD E2E', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    cimd: {
      enabled: true,
      security: {
        blockPrivateIPs: false, // Allow localhost
        allowInsecureForTesting: true, // Allow HTTP for localhost
      },
    },
    tokenStorage: 'memory',
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
