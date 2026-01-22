import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { LocalTestApp } from './apps/local-test';

const port = parseInt(process.env['PORT'] ?? '3108', 10);

@FrontMcp({
  info: { name: 'Local Test MCP', version: '0.1.0' },
  apps: [LocalTestApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: {
      sse: true,
      streamable: true,
      json: true,
      stateless: false,
      legacy: true,
      strictSession: false,
    },
  },
})
export default class LocalTestMcpServer {}
