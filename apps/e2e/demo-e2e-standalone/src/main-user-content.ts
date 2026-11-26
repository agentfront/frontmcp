import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ParentApp } from './apps/parent';

const port = parseInt(process.env['PORT'] ?? '3114', 10);

/**
 * E2E fixture for the user-content listener (#1364): MCP on `PORT`, static files from `USER_CONTENT_ROOT` on
 * `USER_CONTENT_PORT`, with their own headers and content security policy.
 */
@FrontMcp({
  info: { name: 'Demo E2E User Content', version: '0.1.0' },
  apps: [ParentApp],
  logging: { level: LogLevel.Warn },
  auth: { mode: 'public' },
  http: {
    port,
    entryPath: '/mcp',
    userContent: {
      port: parseInt(process.env['USER_CONTENT_PORT'] ?? '3115', 10),
      root: process.env['USER_CONTENT_ROOT'] ?? './user-content',
      headers: { 'Cross-Origin-Resource-Policy': 'cross-origin' },
      csp: { directives: { 'default-src': "'none'", 'img-src': "'self'", sandbox: 'allow-scripts' } },
    },
  },
})
export default class Server {}
