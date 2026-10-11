import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { IsolatedApp } from './apps/isolated';
import { ParentApp } from './apps/parent';

const port = parseInt(process.env['PORT'] ?? '3114', 10);

@FrontMcp({
  info: { name: 'Demo E2E Registry', version: '0.1.0', websiteUrl: 'https://example.com/registry' },
  apps: [ParentApp, IsolatedApp],
  logging: { level: LogLevel.Warn },
  http: { port, entryPath: '/mcp' },
  auth: { mode: 'public' },
  registry: { name: 'com.example/registry-e2e', description: 'MCP Registry e2e fixture' },
})
export default class Server {}
