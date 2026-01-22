import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { MockMintlifyApp } from './apps/mock-mintlify';

const port = parseInt(process.env['PORT'] ?? '3097', 10);

@FrontMcp({
  info: { name: 'Mock Mintlify MCP', version: '0.1.0' },
  apps: [MockMintlifyApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  transport: {
    protocol: {
      sse: true,
      streamable: true,
      json: true,
      legacy: true,
      strictSession: false,
    },
  },
})
export default class MockMintlifyMcpServer {}
