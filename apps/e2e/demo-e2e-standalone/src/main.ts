import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { IsolatedApp } from './apps/isolated';
import { ParentApp } from './apps/parent';

const port = parseInt(process.env['PORT'] ?? '3103', 10);

/**
 * E2E Test Server for Standalone Apps
 *
 * This server has:
 * - ParentApp: Non-standalone app in root scope (accessible at /)
 * - IsolatedApp: Standalone app with isolated scope (accessible at /isolated)
 *
 * Expected behavior:
 * - Root scope SSE at /sse → only has parent-hello tool
 * - Isolated scope SSE at /isolated/sse → only has isolated-hello tool
 * - Root scope message at /message → works with root session
 * - Isolated scope message at /isolated/message → works with isolated session
 */
@FrontMcp({
  info: { name: 'Demo E2E Standalone', version: '0.1.0' },
  apps: [ParentApp, IsolatedApp],
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
