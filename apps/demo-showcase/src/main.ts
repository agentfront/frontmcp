import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import NotesApp from './apps/notes';

// Get port from env variable (set by test runner) or default to 3010
const port = parseInt(process.env['PORT'] ?? '3010', 10);

@FrontMcp({
  info: { name: 'Demo Showcase', version: '1.0.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Info },
  http: { port },
  auth: {
    // Public mode for E2E tests and demos - no Authorization header required
    // Sessions are stateful with short TTL, suitable for CI/CD pipelines
    mode: 'public',
    issuer: 'demo-showcase',
    sessionTtl: 300, // 5 minute sessions for demo/testing
    anonymousScopes: ['read', 'write'],
    // Transport config: enable stateless HTTP for public access without session ID
    transport: {
      enableStatefulHttp: false,
      enableStreamableHttp: true,
      enableStatelessHttp: true, // Enable stateless HTTP for anonymous requests
      requireSessionForStreamable: false, // Don't require session for streamable HTTP
      enableLegacySSE: false,
      enableSseListener: true,
    },
  },
})
export default class Server {}
